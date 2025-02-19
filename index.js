require("dotenv").config();
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const express = require("express");
const app = express();
const cors = require("cors");
const jwt = require("jsonwebtoken");
const port = process.env.PORT || 5000;

const corsOptions = {
  origin: [
    "http://localhost:5173",
    "http://localhost:5174",
    "https://building-management-7130f.web.app",
  ],
  credentials: true,
  optionSuccessStatus: 200,
};

app.use(express.json());
app.use(cors(corsOptions));

const { MongoClient, ServerApiVersion, ObjectId, Code } = require("mongodb");
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
    // await client.connect();

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
    const paymentCollection = client.db("managementDb").collection("payments");
    const couponsCollection = client.db("managementDb").collection("coupons");

    app.post("/coupons", async (req, res) => {
      const data = req.body;
      data.status = "active";

      const result = await couponsCollection.insertOne(data);
      res.send(result);
    });
    app.get("/coupons", async (req, res) => {
      const coupons = await couponsCollection.find().toArray();
      res.send(coupons);
    });
    app.get("/coupons/:id", async (req, res) => {
      const id = req.params.id;
      const coupon = await couponsCollection.findOne({ _id: new ObjectId(id) });
      if (!coupon) {
        return res.status(404).send({ message: "Coupon not found" });
      }
      res.send(coupon);
    });

    app.patch("/coupons/:id", async (req, res) => {
      const id = req.params.id;

      try {
        // Retrieve the current status of the coupon
        const coupon = await couponsCollection.findOne({
          _id: new ObjectId(id),
        });

        if (!coupon) {
          return res.status(404).send({ message: "Coupon not found" });
        }

        // Toggle the status between 'active' and 'expired'
        const newStatus = coupon.status === "active" ? "expired" : "active";

        // Update the coupon's status
        const result = await couponsCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { status: newStatus } }
        );

        if (result.modifiedCount > 0) {
          res.send({
            message: `Coupon status updated to ${newStatus} successfully`,
          });
        } else {
          res.status(400).send({ message: "Failed to update coupon status" });
        }
      } catch (error) {
        res.status(500).send({ message: "Failed to update coupon status" });
      }
    });

    // jwt related api
    app.post("/jwt", async (req, res) => {
      const user = req.body;
      if (!user.email) {
        return res
          .status(400)
          .send({ message: "Email is required to generate token" });
      }
      const token = jwt.sign(
        { email: user.email },
        process.env.ACCESS_TOKEN_SECRET,
        {
          expiresIn: "2h",
        }
      );
      res.send({ token });
    });

    // middlewares
    const verifyToken = (req, res, next) => {
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
      const isAdmin = user?.role === "admin";

      if (!isAdmin) {
        return res.status(403).send({ message: "forbidden access" });
      }
      next();
    };
    const verifyMember = async (req, res, next) => {
      const email = req.decoded.email;
      const query = { email: email };
      const user = await userCollection.findOne(query);
      const isMember = user?.role === "member";

      if (!isMember) {
        return res.status(403).send({ message: "Forbidden access" });
      }
      next();
    };

    // payment api
    app.post(
      "/create-payment-intent",
      verifyToken,
      verifyMember,
      async (req, res) => {
        const { email, couponCode } = req.body;
        const apartment = await applyApartmentCollection.findOne({
          email: email,
        });

        if (!apartment) {
          return res.status(400).send({ message: "Apartment not found" });
        }

        const amount = apartment.rent;
        if (isNaN(amount) || amount <= 0) {
          return res.status(400).send({ message: "Invalid rent amount" });
        }

        const coupon = await couponsCollection.findOne({ code: couponCode });
        console.log(amount, "coupon", coupon);

        const discount = parseFloat(coupon.percent_off);
        if (isNaN(discount)) {
          return res.status(400).send({ message: "Invalid coupon discount" });
        }

        const discountedAmount = amount * (1 - discount / 100);
        const finalAmount = Math.round(discountedAmount * 100); // Stripe expects amount in cents

        if (isNaN(finalAmount)) {
          return res.status(400).send({ message: "Invalid final amount" });
        }

        try {
          const paymentIntent = await stripe.paymentIntents.create({
            amount: finalAmount,
            currency: "usd",
            payment_method_types: ["card"],
          });

          res.send({ clientSecret: paymentIntent.client_secret });
        } catch (error) {
          console.error("Error creating payment intent:", error);
          res.status(500).send({ message: "Internal Server Error" });
        }
      }
    );

    app.get("/payments/:email", verifyToken, verifyMember, async (req, res) => {
      const email = req.params.email;
      const query = { email: email };

      const result = await paymentCollection.find(query).toArray();
      res.send(result);
    });

    app.post("/payments", async (req, res) => {
      const paymentInfo = req.body;

      const paymentResult = await paymentCollection.insertOne(paymentInfo);
      res.send(paymentResult);
    });

    app.get(
      "/users/admin/:email",
      verifyToken,

      async (req, res) => {
        const email = req.params.email;

        const query = { email: email };
        const adminInfo = await userCollection.findOne(query);

        let admin = false;
        if (adminInfo) {
          admin = adminInfo?.role === "admin";
        }

        res.send({ admin, adminInfo });
      }
    );

    app.get("/users", verifyToken, verifyAdmin, async (req, res) => {
      const result = await userCollection.find().toArray();
      res.send(result);
    });

    app.patch(
      "/users/admin/:id",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;
        const filter = { _id: new ObjectId(id) };
        const updatedDoc = {
          $set: {
            role: "admin",
          },
        };
        const result = await userCollection.updateOne(filter, updatedDoc);
        res.send(result);
      }
    );

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
      const page = parseInt(req.query.page);
      const size = parseInt(req.query.size);
      const minRent = parseInt(req.query.minRent);
      const maxRent = parseInt(req.query.maxRent);
      let query = {};
      if (minRent || maxRent) {
        query = {
          rent: { $gte: minRent, $lte: maxRent },
        };
      }
      const skip = page * size;

      const apartments = await apartmentCollection
        .find(query)
        .skip(skip)
        .limit(size)
        .toArray();

      const count = await apartmentCollection.countDocuments(query);

      res.json({ apartments, count });
    });

    app.get("/user/:email", async (req, res) => {
      const email = req.query.email;
      const query = { email: email };
      const result = await userCollection.findOne(query);
      res.send(result);
    });

    app.get(
      "/member/apartments",
      verifyToken,
      verifyMember,
      async (req, res) => {
        const email = req.query?.email;

        const query = { email: email };
        const result = await applyApartmentCollection.findOne(query);

        res.send(result);
      }
    );

    app.get("/admin/apartments", verifyToken, verifyAdmin, async (req, res) => {
      const totalRooms = await apartmentCollection.countDocuments();

      const unavailableRooms = await applyApartmentCollection.countDocuments({
        status: "checked",
      });

      const availableRooms = totalRooms - unavailableRooms;
      const availablePercentage = ((availableRooms / totalRooms) * 100).toFixed(
        2
      );

      const unavailablePercentage = (
        (unavailableRooms / totalRooms) *
        100
      ).toFixed(2);

      const totalUsers = await userCollection.countDocuments();

      const totalMembers = await userCollection.countDocuments({
        role: "member",
      });

      const statistics = {
        totalRooms,
        availableRooms,
        unavailableRooms,
        availablePercentage,
        unavailablePercentage,
        totalUsers,
        totalMembers,
      };

      res.send(statistics);
    });
    // announcements api
    app.get("/announcements", async (req, res) => {
      const results = await announcementsCollection.find().toArray();
      res.send(results);
    });
    // apply api
    app.get("/agreement-request", async (req, res) => {
      const filter = { status: "pending" };
      const results = await applyApartmentCollection.find(filter).toArray();
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
        date,
      } = req.body;

      const existingApplicant = await applyApartmentCollection.findOne({
        email,
      });
      const existingApplication = await applyApartmentCollection.findOne({
        apartmentId,
      });

      if (existingApplicant) {
        return res.json({
          message: "You have already applied for a apartment.",
        });
      }
      if (existingApplication) {
        return res.json({
          message: "Apartment is already booked",
        });
      }

      const application = {
        apartmentId,
        email,
        name,
        floorNo,
        blockName,
        apartmentNo,
        rent,
        date,
        status: "pending",
      };

      const result = await applyApartmentCollection.insertOne(application);
      res.json({ insertedId: result.insertedId });
    });

    app.patch(
      "/agreement-request/accept/:id",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;

        const filter = { _id: new ObjectId(id) };
        const updateDoc = { $set: { status: "checked" } };

        const updateResult = await applyApartmentCollection.updateOne(
          filter,
          updateDoc
        );

        const request = await applyApartmentCollection.findOne(filter);

        const userFilter = { email: request.email };
        const updateUserDoc = { $set: { role: "member" } };
        await userCollection.updateOne(userFilter, updateUserDoc);

        res.send({ updateResult });
      }
    );
    // get members

    app.get("/members", verifyToken, async (req, res) => {
      const filter = { role: "member" };

      const members = await userCollection.find(filter).toArray();

      if (members.length === 0) {
        return res.json({ message: "No members found" });
      }

      res.send(members);
    });

    app.get(
      "/users/member/:email",
      verifyToken,

      async (req, res) => {
        const email = req.params.email;

        const query = { email: email };
        const user = await userCollection.findOne(query);
        let member = false;
        if (user) {
          member = user?.role === "member";
        }

        res.send({ member });
      }
    );

    //remove members
    app.patch(
      "/users/remove-role",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        try {
          const result = await userCollection.updateMany(
            {},
            { $unset: { role: "" } }
          );
          res.send({
            message: `${result.modifiedCount} users' roles removed successfully.`,
          });
        } catch (error) {
          res.status(500).send({ message: "Error removing roles", error });
        }
      }
    );

    // Reject an agreement request
    app.patch(
      "/agreement-request/reject/:id",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;

        const filter = { _id: new ObjectId(id) };
        const updateDoc = { $set: { status: "checked" } };

        // Update the agreement request status
        const updateResult = await applyApartmentCollection.updateOne(
          filter,
          updateDoc
        );

        // Delete the agreement request from the collection
        const deleteResult = await applyApartmentCollection.deleteOne(filter);

        res.send({ updateResult, deleteResult });
      }
    );
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
