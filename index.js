const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const admin = require("firebase-admin");
require("dotenv").config();

const port = process.env.PORT || 3000;

const decoded = Buffer.from(
  process.env.FB_SERVICE_KEY || "",
  "base64"
).toString("utf-8");
let serviceAccount;
try {
  serviceAccount = JSON.parse(decoded);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
} catch (err) {
  console.log("Firebase not initialized: ", err.message);
}

const app = express();

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

const uri =
  "mongodb+srv://ticketBari:1To1GZSZqRIxo11a@cluster0.jj9ycrc.mongodb.net/ticketBariDB?retryWrites=true&w=majority";
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

// Verify
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

    // Add
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

    // Email
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

    // Add Ticket
    app.post("/tickets", verifyToken, async (req, res) => {
      try {
        const {
          title,
          price,
          quantity,
          transportType,
          perks,
          from,
          to,
          vendor,
          image,
        } = req.body;
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
          sold: 0, 
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

    // All Tickets
    app.get("/tickets", async (req, res) => {
      try {
        const tickets = await ticketsCollection
          .find({ verificationStatus: "approved" })
          .sort({ createdAt: -1 })
          .toArray();
        res.send(tickets);
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Failed to fetch tickets" });
      }
    });

    // Tickets By Seller
    app.get("/tickets/seller/:email", async (req, res) => {
      try {
        const email = req.params.email.toLowerCase();
        const tickets = await ticketsCollection
          .find({ "vendor.email": email })
          .toArray();
        res.send(tickets);
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Failed to fetch tickets" });
      }
    });

    //Update
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

    //Delete
    app.delete("/tickets/:id", verifyToken, async (req, res) => {
      try {
        const result = await ticketsCollection.deleteOne({
          _id: new ObjectId(req.params.id),
        });
        res.send(result);
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Failed to delete ticket" });
      }
    });

    // Vendor Revenue
    app.get("/vendor/revenue/:email", async (req, res) => {
      try {
        const email = req.params.email.toLowerCase();
        const tickets = await ticketsCollection
          .find({ "vendor.email": email })
          .toArray();

        const totalTicketsAdded = tickets.length;
        const totalTicketsSold = tickets.reduce(
          (sum, t) => sum + (t.sold || 0),
          0
        );
        const totalRevenue = tickets.reduce(
          (sum, t) => sum + t.price * (t.sold || 0),
          0
        );

        res.json({ totalRevenue, totalTicketsSold, totalTicketsAdded });
      } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Failed to load revenue data" });
      }
    });

    // Add booking
    app.post("/bookings", async (req, res) => {
      try {
        const booking = {
          ...req.body,
          status: "pending",
          createdAt: new Date(),
        };
        const result = await db.collection("bookings").insertOne(booking);
        res.json(result);
      } catch (error) {
        res.status(500).json({ message: "Failed to add booking" });
      }
    });

    // Get bookings for vendor
    app.get("/bookings/vendor/:email", async (req, res) => {
      try {
        const bookings = await db
          .collection("bookings")
          .find({
            vendorEmail: req.params.email.toLowerCase(),
            status: "pending",
          })
          .toArray();
        res.json(bookings);
      } catch (error) {
        res.status(500).json({ message: "Failed to fetch bookings" });
      }
    });

    // Update booking status
    app.put("/bookings/:id", async (req, res) => {
      try {
        const { status } = req.body;
        const result = await db
          .collection("bookings")
          .updateOne(
            { _id: new ObjectId(req.params.id) },
            { $set: { status } }
          );
        res.json(result);
      } catch (error) {
        res.status(500).json({ message: "Failed to update booking" });
      }
    });

    // Approve Ticket
    app.put("/admin/tickets/approve/:id", verifyToken, async (req, res) => {
      try {
        const ticketId = req.params.id;
        const result = await ticketsCollection.updateOne(
          { _id: new ObjectId(ticketId) },
          { $set: { verificationStatus: "approved" } }
        );
        res.json({ success: true, message: "Ticket approved", result });
      } catch (error) {
        res.status(500).json({ message: "Failed to approve ticket" });
      }
    });

    // Reject Ticket
    app.put("/admin/tickets/reject/:id", verifyToken, async (req, res) => {
      try {
        const ticketId = req.params.id;
        const result = await ticketsCollection.updateOne(
          { _id: new ObjectId(ticketId) },
          { $set: { verificationStatus: "rejected" } }
        );
        res.json({ success: true, message: "Ticket rejected", result });
      } catch (error) {
        res.status(500).json({ message: "Failed to reject ticket" });
      }
    });

    // Get All Tickets
    app.get("/admin/tickets", async (req, res) => {
      try {
        const tickets = await ticketsCollection.find({}).toArray();
        res.json(tickets);
      } catch (error) {
        res.status(500).json({ message: "Failed to fetch tickets" });
      }
    });

    // User Admin
    app.put("/admin/users/make-admin/:id", async (req, res) => {
      try {
        const userId = req.params.id;
        const result = await usersCollection.updateOne(
          { _id: new ObjectId(userId) },
          { $set: { role: "admin" } }
        );
        res.json({ success: true, message: "User promoted to admin", result });
      } catch (error) {
        res.status(500).json({ message: "Failed to make admin" });
      }
    });

    // User Vendor
    app.put("/admin/users/make-vendor/:id", async (req, res) => {
      try {
        const userId = req.params.id;
        const result = await usersCollection.updateOne(
          { _id: new ObjectId(userId) },
          { $set: { role: "vendor" } }
        );
        res.json({ success: true, message: "User promoted to vendor", result });
      } catch (error) {
        res.status(500).json({ message: "Failed to make vendor" });
      }
    });

    // Fraud
    app.put("/admin/users/mark-fraud/:id", async (req, res) => {
      try {
        const userId = req.params.id;
        const user = await usersCollection.findOne({
          _id: new ObjectId(userId),
        });

        if (!user || user.role !== "vendor")
          return res.status(400).json({ message: "User is not a vendor" });

        // Mark as fraud
        await usersCollection.updateOne(
          { _id: new ObjectId(userId) },
          { $set: { isFraud: true } }
        );

        // Hide all tickets
        await ticketsCollection.updateMany(
          { "vendor.email": user.email },
          { $set: { hidden: true } }
        );

        res.json({ success: true, message: "Vendor marked as fraud" });
      } catch (error) {
        res.status(500).json({ message: "Failed to mark fraud" });
      }
    });

    //Get All Users
    app.get("/admin/users", async (req, res) => {
      try {
        const users = await usersCollection.find({}).toArray();
        res.json(users);
      } catch (error) {
        res.status(500).json({ message: "Failed to fetch users" });
      }
    });

    // All Approved Tickets
    app.get("/admin/tickets", async (req, res) => {
      try {
        const tickets = await ticketsCollection
          .find({ verificationStatus: "approved" })
          .toArray();
        res.json(tickets);
      } catch (error) {
        res.status(500).json({ message: "Failed to fetch tickets" });
      }
    });

    // Admin toggle 
    app.put("/admin/tickets/advertise/:id", async (req, res) => {
      try {
        const ticketId = req.params.id;

        const ticket = await ticketsCollection.findOne({
          _id: new ObjectId(ticketId),
        });
        if (!ticket)
          return res
            .status(404)
            .json({ success: false, message: "Ticket not found" });

        if (!ticket.advertised) {
          const count = await ticketsCollection.countDocuments({
            advertised: true,
          });
          if (count >= 6) {
            return res
              .status(400)
              .json({
                success: false,
                message: "Cannot advertise more than 6 tickets",
              });
          }
        }

        // Toggle advertise
        await ticketsCollection.updateOne(
          { _id: new ObjectId(ticketId) },
          { $set: { advertised: !ticket.advertised } }
        );

        res.json({ success: true, advertised: !ticket.advertised });
      } catch (err) {
        console.error(err);
        res
          .status(500)
          .json({ success: false, message: "Failed to toggle advertise" });
      }
    });

    // Transactions
app.get("/transactions/user/:email", async (req, res) => {
  try {
    const email = req.params.email.toLowerCase();
    const transactions = await client
      .db("ticketBariDB")
      .collection("transactions")
      .find({ userEmail: email })
      .sort({ paymentDate: -1 }) // latest first
      .toArray();
    res.json(transactions);
  } catch (error) {
    console.error("Failed to fetch transactions:", error);
    res.status(500).json({ message: "Failed to load transactions" });
  }
});

// BOOKING 
app.post("/bookings", async (req, res) => {
  try {
    const db = client.db("ticketBariDB");
    const bookingsCollection = db.collection("bookings");

    const booking = req.body;
    await bookingsCollection.insertOne(booking);

    res.json({ success: true, message: "Booking saved successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Failed to save booking" });
  }
});


    app.get("/", (req, res) => {
      res.send("TicketBari Server Running");
    });
  } catch (err) {
    console.error(err);
  }
}

run().catch(console.dir);

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
