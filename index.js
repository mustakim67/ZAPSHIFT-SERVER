const { MongoClient, ServerApiVersion } = require('mongodb');
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
        console.log("Incoming parcel data:", req.body);  // Debug log
        const newParcel = req.body;

        if (!newParcel || Object.keys(newParcel).length === 0) {
          return res.status(400).send({ error: "Parcel data is missing" });
        }

        const result = await parcelCollection.insertOne(newParcel);
        res.status(201).send(result);
      } catch (error) {
        console.error("Error inserting parcel:", error);
        res.status(500).send({ error: 'Failed to add parcel', message: error.message });
      }
    });

    // GET route to fetch parcels
    // app.get('/parcels', async (req, res) => {
    //   try {
    //     const parcels = await parcelCollection.find().toArray();
    //     res.send(parcels);
    //   } catch (error) {
    //     console.error("Error fetching parcels:", error);
    //     res.status(500).send({ error: 'Failed to get parcels', message: error.message });
    //   }
    // });
    // get parcels sorted by creation_date (latest first)
    app.get('/parcels', async (req, res) => {
      const email = req.query.email;
      try {
        const query = email ? { created_by: email } : {};
        const parcels = await parcelCollection
          .find(query)
          .sort({ creation_date: -1 })  // Sort descending by creation_date (latest first)
          .toArray();
        res.send(parcels);
      } catch (error) {
        res.status(500).send({ error: 'Failed to fetch parcels' });
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
