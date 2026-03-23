import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";
import dotenv from "dotenv";
import admin from "firebase-admin";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const server = http.createServer(app);


// CORS configuration
const corsOptions = {
  origin: ["http://localhost:5173", "http://192.168.29.92:5173"], // Add your frontend URLs
  credentials: true,
  optionsSuccessStatus: 200,
};

app.use(cors(corsOptions));
const cors = require("cors");

// ✅ CORS FIX
app.use(
  cors({
    origin: "https://real-time-chat-application-sand-three.vercel.app",
    methods: ["GET", "POST"],
    credentials: true
  })
);

app.use(express.json());

// Initialize Firebase Admin (only if credentials exist)
let firebaseInitialized = false;
let db = null;

try {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
    console.log("✅ Firebase Admin initialized successfully");
    firebaseInitialized = true;
    db = admin.firestore();
  } else {
    console.log("⚠️ FIREBASE_SERVICE_ACCOUNT not found, using mock data");
    // Don't try to initialize Firebase
    firebaseInitialized = false;
    db = null;
  }
} catch (error) {
  console.error("❌ Firebase initialization error:", error);
  console.log("⚠️ Continuing with mock data mode");
  firebaseInitialized = false;
  db = null;
}

// Socket.io setup
const io = new Server(server, {
  cors: {
    origin: "https://real-time-chat-application-sand-three.vercel.app",
    methods: ["GET", "POST"],
    credentials: true,
  },
});

// Store online users
const onlineUsers = new Map(); // userId -> socketId
const userSockets = new Map(); // socketId -> userId
const userNames = new Map(); // userId -> username

// Socket.io connection handling
io.on("connection", (socket) => {
  console.log("🟢 New client connected:", socket.id);

  // Handle user registration
  socket.on("register", (userId, username) => {
    if (userId) {
      onlineUsers.set(userId, socket.id);
      userSockets.set(socket.id, userId);
      if (username) {
        userNames.set(userId, username);
      }
      console.log(
        `👤 User ${userId} (${username || "Unknown"}) registered with socket ${socket.id}`,
      );

      // Broadcast updated online users list
      const onlineUsersList = Array.from(onlineUsers.entries()).map(
        ([userId, socketId]) => ({
          userId,
          username: userNames.get(userId) || `User ${userId}`,
          socketId,
        }),
      );
      io.emit("onlineUsers", onlineUsersList);
    }
  });

  // Handle private messages
  socket.on("private-message", (data) => {
    console.log("📨 Received private message:", data);

    const { toUserId, fromUserId, fromUsername, text, timestamp, id } = data;

    // Find receiver's socket
    const receiverSocketId = onlineUsers.get(toUserId);

    if (receiverSocketId) {
      // Send to specific user
      io.to(receiverSocketId).emit("private-message", {
        id,
        fromUserId,
        fromUsername,
        toUserId,
        text,
        timestamp,
        type: "private",
      });
      console.log(`✅ Message sent to user ${toUserId}`);
    } else {
      console.log(`❌ User ${toUserId} is offline`);
    }

    // Also send back to sender for confirmation
    socket.emit("private-message", {
      id,
      fromUserId,
      fromUsername,
      toUserId,
      text,
      timestamp,
      type: "private",
    });
  });

  // Handle private messages (alternative event name)
  socket.on("privateMessage", (data) => {
    console.log("📨 Received private message (alt):", data);

    const { toUserId, fromUserId, fromUsername, text, timestamp, id } = data;

    // Find receiver's socket
    const receiverSocketId = onlineUsers.get(toUserId);

    if (receiverSocketId) {
      io.to(receiverSocketId).emit("privateMessage", {
        id,
        fromUserId,
        fromUsername,
        toUserId,
        text,
        timestamp,
        type: "private",
      });
      console.log(`✅ Message sent to user ${toUserId} (alt event)`);
    }

    socket.emit("privateMessage", {
      id,
      fromUserId,
      fromUsername,
      toUserId,
      text,
      timestamp,
      type: "private",
    });
  });

  // Handle typing indicators
  socket.on("typing", ({ username, isTyping, toUserId }) => {
    const receiverSocketId = onlineUsers.get(toUserId);
    if (receiverSocketId) {
      io.to(receiverSocketId).emit("typing", {
        username,
        isTyping,
        fromUserId: userSockets.get(socket.id),
      });
    }
  });

  // Handle get users request
  socket.on("getUsers", () => {
    // Send list of online users
    const usersList = Array.from(onlineUsers.entries()).map(
      ([userId, socketId]) => ({
        id: userId,
        username: userNames.get(userId) || `User ${userId}`,
        isOnline: true,
      }),
    );
    socket.emit("users", usersList);
  });

  // Handle disconnection
  socket.on("disconnect", () => {
    console.log("🔴 Client disconnected:", socket.id);

    const userId = userSockets.get(socket.id);
    if (userId) {
      onlineUsers.delete(userId);
      userSockets.delete(socket.id);
      userNames.delete(userId);

      // Broadcast updated online users list
      const onlineUsersList = Array.from(onlineUsers.entries()).map(
        ([userId, socketId]) => ({
          userId,
          username: userNames.get(userId) || `User ${userId}`,
          socketId,
        }),
      );
      io.emit("onlineUsers", onlineUsersList);
    }
  });
});

// ✅ Register user API
app.post("/api/register", (req, res) => {
  try {
    const { username } = req.body;

    if (!username) {
      return res.status(400).json({
        message: "Username required",
      });
    }

    console.log("✅ User registered:", username);

    // Mock response (abhi database nahi hai)
    res.json({
      success: true,
      user: {
        id: Date.now(),
        username: username,
      },
    });
  } catch (error) {
    console.error("Register error:", error);

    res.status(500).json({
      message: "Register failed",
    });
  }
});

// REST API endpoints
app.get("/", (req, res) => {
  res.json({
    message: "Chat App Backend is running!",
    mode: firebaseInitialized ? "Firebase" : "Mock Data",
    timestamp: new Date().toISOString(),
  });
});

app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    firebase: firebaseInitialized
      ? "connected"
      : "not connected (using mock data)",
    onlineUsers: onlineUsers.size,
  });
});

// Get private messages between two users
app.get("/api/private-messages", async (req, res) => {
  try {
    const { userId, otherUserId } = req.query;

    if (!userId || !otherUserId) {
      return res.status(400).json({ error: "Missing userId or otherUserId" });
    }

    // If Firebase is not initialized, return mock data
    if (!firebaseInitialized || !db) {
      console.log("Using mock messages data");
      // Generate some mock messages
      const mockMessages = [];
      return res.json({ messages: mockMessages });
    }

    // Query messages from Firebase (only if initialized)
    const messagesRef = db.collection("privateMessages");
    const snapshot = await messagesRef
      .where("participants", "array-contains", userId)
      .get();

    const messages = [];
    snapshot.forEach((doc) => {
      const data = doc.data();
      if (
        (data.fromUserId === userId && data.toUserId === otherUserId) ||
        (data.fromUserId === otherUserId && data.toUserId === userId)
      ) {
        messages.push({ id: doc.id, ...data });
      }
    });

    // Sort by timestamp
    messages.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    res.json({ messages });
  } catch (error) {
    console.error("Error fetching private messages:", error);
    res.status(500).json({ error: "Failed to fetch messages" });
  }
});

// Save a new message
app.post("/api/private-messages", async (req, res) => {
  try {
    const message = req.body;

    if (!firebaseInitialized || !db) {
      console.log("Mock saving message:", message);
      return res.json({ success: true, message });
    }

    // Add participants array for easier querying
    message.participants = [message.fromUserId, message.toUserId];

    const docRef = await db.collection("privateMessages").add(message);

    res.json({ success: true, id: docRef.id, message });
  } catch (error) {
    console.error("Error saving message:", error);
    res.status(500).json({ error: "Failed to save message" });
  }
});

// Get all users
app.get("/api/users", (req, res) => {
  const usersList = Array.from(onlineUsers.entries()).map(
    ([userId, socketId]) => ({
      id: userId,
      username: userNames.get(userId) || `User ${userId}`,
      isOnline: true,
    }),
  );
  res.json(usersList);
});

// Start server
const PORT = process.env.PORT || 5000;
server.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📡 WebSocket server ready`);
  console.log(`🌐 CORS enabled for: ${corsOptions.origin.join(", ")}`);
  console.log(
    `📝 Mode: ${firebaseInitialized ? "Firebase Database" : "Mock Data (no Firebase)"}`,
  );
});
