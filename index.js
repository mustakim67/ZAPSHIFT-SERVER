const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const express = require('express');
const cors = require('cors');

//require stripe
const Stripe = require('stripe');

//require donenv and config
const dotenv = require('dotenv');
dotenv.config();

const app = express();

// Middleware — must be before routes to parse JSON bodies
app.use(cors());
app.use(express.json());

//stripe secret key
const stripe = Stripe(process.env.PAYMENT_GATEWAY_KEY);

// MongoDB connection URI
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.xqfap2z.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with options
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

async function run() {
  try {
    await client.connect();
    const parcelDB = client.db("parcelDB");
    const parcelCollection = parcelDB.collection("parcels");

    // POST route to add parcel
    app.post('/parcels', async (req, res) => {
      try {
        const newParcel = req.body;

        // Ensure creation_date is a valid Date
        if (newParcel.creation_date) {
          newParcel.creation_date = new Date(newParcel.creation_date);
        }

        const result = await parcelCollection.insertOne(newParcel);
        res.status(201).send(result);
      } catch (error) {
        console.error("Error inserting parcel:", error);
        res.status(500).send({ error: 'Failed to add parcel', message: error.message });
      }
    });

    // GET route to fetch parcels
    app.get('/parcels', async (req, res) => {
      try {
        const parcels = await parcelCollection.find().toArray();
        res.send(parcels);
      } catch (error) {
        console.error("Error fetching parcels:", error);
        res.status(500).send({ error: 'Failed to get parcels', message: error.message });
      }
    });

    //Delete a particular parcel by user
    app.delete('/parcels/:id', async (req, res) => {
      const id = req.params.id;
      try {
        const result = await parcelCollection.deleteOne({ _id: new ObjectId(id) });
        res.send(result);
      } catch (error) {
        res.status(500).send({ error: 'Failed to delete parcel', message: error.message });
      }
    });

    // GET parcel by ID
    app.get('/parcels/:id', async (req, res) => {
      const { id } = req.params;
      try {
        const parcel = await parcelCollection.findOne({ _id: new ObjectId(id) });

        if (!parcel) {
          return res.status(404).send({ error: 'Parcel not found' });
        }

        res.send(parcel);
      } catch (error) {
        console.error('Error fetching parcel by ID:', error);
        res.status(500).send({ error: 'Failed to get parcel', message: error.message });
      }
    });
    // get parcels sorted by creation_date (latest first) and with particular email
    app.get('/myparcels', async (req, res) => {
      const email = req.query.email;
      console.log(email)
      try {
        const query = { created_by: email }; //Only fetch parcels created by this user
        const myparcels = await parcelCollection.find(query).sort({ creation_date: -1 }).toArray();
        res.send(myparcels);
        console.log(myparcels)
      }
      catch (error) {
        console.error("Error fetching parcels:", error);
        res.status(500).send({ error: 'Failed to fetch parcels', message: error.message });
      }
    });

    // POST: Create Payment Intent
    app.post('/create-payment-intent', async (req, res) => {
      try {
        const { amount } = req.body;

        if (!amount || amount <= 0) {
          return res.status(400).send({ error: 'Invalid amount' });
        }

        const paymentIntent = await stripe.paymentIntents.create({
          amount: amount * 100, // Stripe expects amount in cents
          currency: 'usd',
          payment_method_types: ['card'],
        });

        res.send({
          clientSecret: paymentIntent.client_secret,
        });
      } catch (error) {
        console.error('Error creating payment intent:', error);
        res.status(500).send({
          error: 'Failed to create payment intent',
          message: error.message,
        });
      }
    });


    //update payment status and det payment history
    const paymentsCollection = parcelDB.collection("paymentsCollection");

    app.post('/payments', async (req, res) => {
      try {
        const {
          parcelId,
          amount,
          transactionId,
          email,
          title,
          payment_method,
          payment_time
        } = req.body;

        if (!parcelId || !amount || !email || !transactionId || !title || !payment_method) {
          return res.status(400).send({ error: 'Missing required payment info' });
        }

        const paymentDoc = {
          parcelId: new ObjectId(parcelId),
          amount,
          transactionId,
          email,
          title,
          payment_method, // ✅ New field
          payment_time: payment_time ? new Date(payment_time) : new Date()
        };

        const insertResult = await paymentsCollection.insertOne(paymentDoc);

        const updateResult = await parcelCollection.updateOne(
          { _id: new ObjectId(parcelId) },
          { $set: { payment_status: 'paid' } }
        );

        res.send({
          success: true,
          message: 'Payment recorded and parcel updated',
          insertedId: insertResult.insertedId,
          updated: updateResult.modifiedCount
        });
      } catch (error) {
        console.error('Error saving payment:', error);
        res.status(500).send({
          error: 'Failed to process payment',
          message: error.message
        });
      }
    });

    //get payment history
    app.get('/payments', async (req, res) => {
      try {
        const payments = await parcelDB.collection('payments')
          .find()
          .sort({ payment_time: -1 })
          .toArray();
        res.send(payments);
      } catch (error) {
        console.error('Error fetching payment history:', error);
        res.status(500).send({ error: 'Failed to fetch payment history' });
      }
    });

    //get payment history fro a particular user
    app.get('/payments-history', async (req, res) => {
      try {
        const email = req.query.email;
        const query = email ? { email } : {};
        const payments = await paymentsCollection
          .find(query)
          .sort({ payment_time: -1 })
          .toArray();
        res.send(payments);
      } catch (error) {
        res.status(500).send({ error: 'Failed to fetch payment history', message: error.message });
      }
    });
    // Test route
    app.get('/', (req, res) => {
      res.send('Parcel Management Server is running');
    });

    console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } catch (error) {
    console.error("MongoDB connection error:", error);
  }
}

run().catch(console.dir);

const port = process.env.PORT || 5000;
app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
