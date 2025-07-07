const { MongoClient, ServerApiVersion,ObjectId } = require('mongodb');
const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
dotenv.config();

const app = express();

// Middleware — must be before routes to parse JSON bodies
app.use(cors());
app.use(express.json());

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
