// backend/server.js
const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const admin = require("firebase-admin");
require("dotenv").config();

const port = process.env.PORT || 3000;

// ---------- FIREBASE ADMIN ----------
const decoded = Buffer.from(process.env.FB_SERVICE_KEY || "", "base64").toString("utf-8");
let serviceAccount;
try {
  serviceAccount = JSON.parse(decoded);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
} catch (err) {
  console.log("Firebase not initialized: ", err.message);
}

// ---------- EXPRESS APP ----------
const app = express();

// ---------- MIDDLEWARE ----------
app.use(
  cors({
    origin: [
      "http://localhost:5173",
      "http://localhost:5174",
      "http://localhost:5175",
    ],
    methods: ["GET", "POST", "PUT", "DELETE"],
    credentials: true,
  })
);
app.use(express.json());

// ---------- MONGODB CONNECTION ----------
const uri =
  "mongodb+srv://ticketBari:1To1GZSZqRIxo11a@cluster0.jj9ycrc.mongodb.net/ticketBariDB?retryWrites=true&w=majority";
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

// ---------- OPTIONAL VERIFY TOKEN ----------
const verifyToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return next(); // skip if testing without Firebase

  const token = authHeader.split(" ")[1];
  try {
    const decodedUser = await admin.auth().verifyIdToken(token);
    req.decoded = decodedUser;
    next();
  } catch (error) {
    console.log("Invalid token, skipping verification:", error.message);
    next();
  }
};

async function run() {
  try {
    await client.connect();
    console.log("Connected to MongoDB successfully");

    const db = client.db("ticketBariDB");
    const ticketsCollection = db.collection("tickets");
    const usersCollection = db.collection("users");

    // ---------- ADD USER ----------
    app.post("/users", async (req, res) => {
      try {
        let { uid, name, email, role } = req.body;
        email = email.toLowerCase();
        role = role.toLowerCase();

        const existingUser = await usersCollection.findOne({ uid });
        if (existingUser) return res.send(existingUser);

        const newUser = {
          uid,
          name,
          email,
          role,
          createdAt: new Date(),
        };

        await usersCollection.insertOne(newUser);
        res.send({
          name: newUser.name,
          email: newUser.email,
          role: newUser.role,
        });
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Failed to add user" });
      }
    });

    // ---------- GET USER BY EMAIL ----------
    app.get("/users/:email", async (req, res) => {
      try {
        const email = req.params.email.toLowerCase();
        const user = await usersCollection.findOne({ email });
        if (!user) return res.status(404).json({ message: "User not found" });

        res.json({
          name: user.name,
          email: user.email,
          role: user.role.toLowerCase(),
        });
      } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Failed to get user" });
      }
    });

    // ---------- ADD TICKET ----------
    app.post("/tickets", verifyToken, async (req, res) => {
      try {
        const { title, price, quantity, transportType, perks, from, to, vendor, image } = req.body;
        const ticket = {
          title,
          price,
          quantity,
          transportType,
          perks,
          from,
          to,
          image,
          verificationStatus: "pending",
          advertised: false,
          sold: 0, // default sold tickets
          vendor: {
            name: vendor.name,
            email: vendor.email.toLowerCase(),
          },
          createdAt: new Date(),
        };

        const result = await ticketsCollection.insertOne(ticket);
        res.send(result);
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Failed to add ticket" });
      }
    });

    // ---------- GET ALL TICKETS ----------
    app.get("/tickets", async (req, res) => {
      try {
        const tickets = await ticketsCollection.find({ verificationStatus: "approved" }).sort({ createdAt: -1 }).toArray();
        res.send(tickets);
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Failed to fetch tickets" });
      }
    });

    // ---------- GET TICKETS BY SELLER ----------
    app.get("/tickets/seller/:email", async (req, res) => {
      try {
        const email = req.params.email.toLowerCase();
        const tickets = await ticketsCollection.find({ "vendor.email": email }).toArray();
        res.send(tickets);
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Failed to fetch tickets" });
      }
    });

    // ---------- UPDATE TICKET ----------
    app.put("/tickets/:id", verifyToken, async (req, res) => {
      try {
        const result = await ticketsCollection.updateOne(
          { _id: new ObjectId(req.params.id) },
          { $set: req.body }
        );
        res.send(result);
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Failed to update ticket" });
      }
    });

    // ---------- DELETE TICKET ----------
    app.delete("/tickets/:id", verifyToken, async (req, res) => {
      try {
        const result = await ticketsCollection.deleteOne({ _id: new ObjectId(req.params.id) });
        res.send(result);
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Failed to delete ticket" });
      }
    });

    // ---------- VENDOR REVENUE OVERVIEW ----------
    app.get("/vendor/revenue/:email", async (req, res) => {
      try {
        const email = req.params.email.toLowerCase();
        const tickets = await ticketsCollection.find({ "vendor.email": email }).toArray();

        const totalTicketsAdded = tickets.length;
        const totalTicketsSold = tickets.reduce((sum, t) => sum + (t.sold || 0), 0);
        const totalRevenue = tickets.reduce((sum, t) => sum + t.price * (t.sold || 0), 0);

        res.json({ totalRevenue, totalTicketsSold, totalTicketsAdded });
      } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Failed to load revenue data" });
      }
    });

    // ---------- TEST ----------
    app.get("/", (req, res) => {
      res.send("TicketBari Server Running");
    });

  } catch (err) {
    console.error(err);
  }
}

run().catch(console.dir);

// ---------- START SERVER ----------
app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});