const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const express = require('express');
const cors = require('cors');
const admin = require("firebase-admin");


//require stripe
const Stripe = require('stripe');

//require donenv and config
const dotenv = require('dotenv');
dotenv.config();

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

//firebase sdk
const serviceAccount = require("./serviceAccountKey.json");
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});


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


    // Auth middleware
    const verifyFBToken = async (req, res, next) => {
      const authHeader = req.headers.authorization;
      console.log('authHeader', authHeader)
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).send({ message: 'Unauthorized Access' });
      }

      const token = authHeader.split(' ')[1];

      try {
        const decoded = await admin.auth().verifyIdToken(token);
        req.decoded = decoded;
        next();
      } catch (error) {
        return res.status(403).send({ message: 'Forbidden Access' });
      }
    };

    // POST route to add parcel
    app.post('/parcels', verifyFBToken, async (req, res) => {
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
    app.get('/parcels', verifyFBToken, async (req, res) => {
      try {
        const parcels = await parcelCollection.find().toArray();
        res.send(parcels);
      } catch (error) {
        console.error("Error fetching parcels:", error);
        res.status(500).send({ error: 'Failed to get parcels', message: error.message });
      }
    });

    //Delete a particular parcel by user
    app.delete('/parcels/:id', verifyFBToken, async (req, res) => {
      const id = req.params.id;
      try {
        const result = await parcelCollection.deleteOne({ _id: new ObjectId(id) });
        res.send(result);
      } catch (error) {
        res.status(500).send({ error: 'Failed to delete parcel', message: error.message });
      }
    });

    // GET parcel by ID
    app.get('/parcels/:id', verifyFBToken, async (req, res) => {
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
    app.get('/myparcels', verifyFBToken, async (req, res) => {
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




    //Track a parcel by id
    const tracklCollection = parcelDB.collection("trackedParcel");
    app.post("/track", async (req, res) => {
      const { tracking_id, parcel_id, status, message, updated_by = '' } = req.body;

      const log = {
        tracking_id,
        parcel_id: parcel_id ? new ObjectId(parcel_id) : undefined,
        status,
        message,
        time: new Date(),
        updated_by,
      };

      const result = await trackingCollection.insertOne(log);
      res.send({ success: true, insertedId: result.insertedId });
    });





    //Save user data to the datbase 
    const userCollection = parcelDB.collection("users");

    app.post('/users', async (req, res) => {
      const email = req.body.email;
      const userExist = await userCollection.findOne({ email });

      if (userExist) {
        // Update last_log_in for existing user
        await userCollection.updateOne(
          { email },
          { $set: { last_log_in: new Date() } }
        );
        return res.status(200).json({ message: 'User exists. Login time updated.' });
      }

      // Create new user with last_log_in
      const user = {
        ...req.body,
        created_at: new Date(),
        last_log_in: new Date(),
        role: req.body.role || 'user' // set default role if not given
      };

      const result = await userCollection.insertOne(user);
      res.status(201).json({ message: 'New user created', result });
    });




    // POST: Create Payment Intent
    app.post('/create-payment-intent', verifyFBToken, async (req, res) => {
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

    app.post('/payments', verifyFBToken, async (req, res) => {
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
          payment_method,
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
    app.get('/payments', verifyFBToken, async (req, res) => {
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
    app.get('/payments-history', verifyFBToken, async (req, res) => {
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



    const ridersCollection = parcelDB.collection("riders");

    // POST /riders - Apply as a rider
    app.post("/riders", async (req, res) => {
      try {
        const rider = req.body;
        console.log(rider)
        // Ensure email is unique (1 application per user)
        const existing = await ridersCollection.findOne({ email: rider.email });
        if (existing) {
          return res.status(409).send({ message: "Rider already applied" });
        }

        // Set default fields
        rider.status = "pending";
        rider.applied_at = new Date();

        const result = await ridersCollection.insertOne(rider);
        res.status(201).send({ insertedId: result.insertedId });
      } catch (error) {
        console.error("Failed to apply rider:", error);
        res.status(500).send({ error: "Failed to apply", message: error.message });
      }
    });


    // GET /riders/pending
    app.get('/riders/pending', async (req, res) => {
      try {
        const pendingRiders = await ridersCollection.find({ status: 'pending' }).toArray();
        res.json(pendingRiders);
      } catch (error) {
        console.error("Failed to get pending riders:", error);
        res.status(500).json({ message: "Internal server error" });
      }
    });

    //updae status 

    app.patch('/riders/update-status/:id', async (req, res) => {
      const riderId = req.params.id;
      const { status, email } = req.body;

      const allowedStatuses = ['accepted', 'rejected', 'active', 'deactivated'];

      if (!allowedStatuses.includes(status)) {
        return res.status(400).json({ error: 'Invalid status' });
      }

      try {
        const result = await ridersCollection.updateOne(
          { _id: new ObjectId(riderId) },
          { $set: { status } }
        );

        //updaqte user role for accepting rider
        if (status === 'active') {
          const userQuery = { email };
          const userUpdatedDoc = {
            $set: {
              role: 'rider'
            }
          }
          const roleResult = await userCollection.updateOne(userQuery, userUpdatedDoc)
        }





        if (result.modifiedCount === 0) {
          return res.status(404).json({ error: 'Rider not found or status unchanged' });
        }

        res.json({ message: `Rider status updated to ${status}` });
      } catch (error) {
        console.error('Failed to update rider status:', error);
        res.status(500).json({ error: 'Internal server error' });
      }
    });


    //GEt active Riders
    app.get('/riders/active', async (req, res) => {
      const search = req.query.search || '';
      const query = {
        status: { $in: ['accepted', 'active'] },
        name: { $regex: search, $options: 'i' },
      };

      try {
        const activeRiders = await ridersCollection.find(query).toArray();
        res.send(activeRiders);
      } catch (error) {
        res.status(500).send({ message: 'Error fetching riders' });
      }
    });



    //serach user by email to take admin action
    app.get('/users/search', async (req, res) => {
      const email = req.query.email;

      if (!email) {
        return res.status(400).send({ message: 'Email query is required' });
      }

      try {
        const users = await userCollection
          .find({ email: { $regex: email, $options: 'i' } }) // case-insensitive partial match
          .limit(10)
          .project({ email: 1, role: 1, created_at: 1, _id: 0 }) // only required fields
          .toArray();

        if (!users.length) {
          return res.status(404).send({ message: 'No users found' });
        }

        res.send(users);
      } catch (error) {
        console.error('Search error:', error);
        res.status(500).send({ message: 'Internal server error' });
      }
    });

    //update role foradmin
    app.patch('/users/role/:email', async (req, res) => {
      const email = req.params.email;
      const { role } = req.body;

      if (!['admin', 'user', 'rider'].includes(role)) {
        return res.status(400).send({ message: 'Invalid role' });
      }

      try {
        const user = await userCollection.findOne({ email });

        if (!user) {
          return res.status(404).send({ message: 'User not found' });
        }

        let updateDoc = {};

        if (role === 'admin') {
          // If current role is NOT admin, store it before promoting
          updateDoc = {
            $set: { role: 'admin' },
            ...(user.role !== 'admin' && user.role
              ? { $set: { role: 'admin', previous_role: user.role } }
              : {}),
          };
        } else {
          // Revert to previous_role if it exists
          const newRole = user.previous_role || 'user';

          updateDoc = {
            $set: { role: newRole },
            $unset: { previous_role: "" },
          };
        }

        const result = await userCollection.updateOne(
          { email },
          updateDoc
        );

        if (result.modifiedCount === 0) {
          return res.status(400).send({ message: 'Role not changed' });
        }

        res.send({ message: `User role updated to ${updateDoc.$set.role}` });
      } catch (error) {
        console.error('Role update error:', error);
        res.status(500).send({ message: 'Internal server error' });
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
