const express = require("express");
const app = express();
const cors = require("cors");
const jwt = require("jsonwebtoken");
require("dotenv").config();
const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.cd15p.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();
    // Send a ping to confirm a successful connection
    const userCollection = client.db("managementDb").collection("users");
    const apartmentCollection = client
      .db("managementDb")
      .collection("apartments");
    const announcementsCollection = client
      .db("managementDb")
      .collection("announcements");
    const applyApartmentCollection = client
      .db("managementDb")
      .collection("appliedApartment");

    // jwt related api
    app.post("/jwt", async (req, res) => {
      const user = req.body;
      if (!user.email) {
        return res.status(400).send({ message: "Email is required to generate token" });
      }
      const token = jwt.sign({ email: user.email }, process.env.ACCESS_TOKEN_SECRET, {
        expiresIn: "1h",
      });
      res.send({ token });
    });
    

    // middlewares
    const verifyToken = (req, res, next) => {
      // console.log('inside verify token', req.headers.authorization);
      if (!req.headers.authorization) {
        return res.status(401).send({ message: "unauthorized access" });
      }
      const token = req.headers.authorization.split(" ")[1];
      jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
        if (err) {
          return res.status(401).send({ message: "unauthorized access" });
        }
        req.decoded = decoded;
        next();
      });
    };

    // use verify admin after verifyToken
    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded.email;
      const query = { email: email };
      const user = await userCollection.findOne(query);
      const isAdmin = user?.role === "admin"||"Admin";
      console.log(isAdmin);
      console.log('user', user)
      if (!isAdmin) {
        return res.status(403).send({ message: "forbidden access" });
      }
      next();
    };


    app.get("/users/admin/:email", verifyToken, verifyAdmin, async (req, res) => {
      const email = req.params.email;
      if (email !== req.decoded.email) {
        return res.status(403).send({ message: "Forbidden access" });
      }
    
      const query = { email: email };
      const user = await userCollection.findOne(query);
      let admin = false;
      if (user) {
        admin = user?.role === 'admin';  
      }
      res.send({ admin });
    });
    

    app.get("/users", verifyToken,verifyAdmin, async (req, res) => {
      console.log(req.headers);
      const result = await userCollection.find().toArray();
      res.send(result);
    });

    app.patch("/users/admin/:id", async (req, res) => {
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) };
      const updatedDoc = {
        $set: {
          role: "admin",
        },
      };
      const result = await userCollection.updateOne(filter, updatedDoc);
      res.send(result);
    });

    app.post("/users", async (req, res) => {
      const user = req.body;
      const query = { email: user.email };
      const existingUser = await userCollection.findOne(query);
      if (existingUser) {
        return res.send({ message: "user already exists", insertedId: null });
      }
      const result = await userCollection.insertOne(user);
      res.send(result);
    });
    app.delete("/users/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await userCollection.deleteOne(query);
      res.send(result);
    });

    // announcement api
    app.post("/announcement", async (req, res) => {
      const announcement = req.body;
      const result = await announcementsCollection.insertOne(announcement);
      res.send(result);
    });

    app.get("/apartments", async (req, res) => {
      const page = parseInt(req.query.page) || 0;
      const size = parseInt(req.query.size) || 6;
      const minRent = parseInt(req.query.minRent) || 0;
      const maxRent = parseInt(req.query.maxRent) || Number.MAX_SAFE_INTEGER;

      const skip = page * size;
      const filter = { rent: { $gte: minRent, $lte: maxRent } };

      try {
        const apartments = await apartmentCollection
          .find(filter)
          .skip(skip)
          .limit(size)
          .toArray();

        const count = await apartmentCollection.countDocuments(filter); // Correctly calculate total count

        res.json({ apartments, count });
      } catch (error) {
        res.status(500).json({ message: "Failed to fetch apartments", error });
      }
    });

    // announcements api
    app.get("/announcements", async (req, res) => {
      const results = await announcementsCollection.find().toArray();
      res.send(results);
    });
    // apply api
    app.get("/apply", async (req, res) => {
      const results = await applyApartmentCollection.find().toArray();
      res.send(results);
    });
    app.post("/apply", async (req, res) => {
      const {
        apartmentId,
        email,
        name,
        floorNo,
        blockName,
        apartmentNo,
        rent,
      } = req.body;

      try {
        const existingApplication = await applyApartmentCollection.findOne({
          email,
          apartmentId,
        });

        if (existingApplication) {
          return res
            .status(400)
            .json({ message: "You have already applied for this apartment." });
        }

        const application = {
          apartmentId,
          email,
          name,
          floorNo,
          blockName,
          apartmentNo,
          rent,
          status: "pending",
        };

        const result = await applyApartmentCollection.insertOne(application);
        res.json({ insertedId: result.insertedId });
      } catch (error) {
        res
          .status(500)
          .json({ message: "Failed to submit application", error });
      }
    });

    await client.db("admin").command({ ping: 1 });
    // console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send(`app is running `);
});
app.listen(port, () => {
  console.log(`building management system is running in ${port}`);
});
