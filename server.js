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

// ✅ CORS configuration - SINGLE CONFIGURATION
const allowedOrigins = [
  "http://localhost:5173",
  "http://localhost:3000",
  "http://127.0.0.1:5173",
  "http://192.168.29.92:5173",
  "https://real-time-chat-application-sand-three.vercel.app"
];

const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.indexOf(origin) !== -1 || process.env.NODE_ENV !== 'production') {
      callback(null, true);
    } else {
      console.log('Origin not allowed:', origin);
      callback(null, true); // Allow all in development
    }
  },
  credentials: true,
  optionsSuccessStatus: 200,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
};

// Apply CORS middleware - ONLY ONCE
app.use(cors(corsOptions));

// Parse JSON bodies
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
    origin: allowedOrigins,
    methods: ["GET", "POST"],
    credentials: true,
  },
});

// Store online users
const onlineUsers = new Map(); // userId -> socketId
const userSockets = new Map(); // socketId -> userId
const userNames = new Map(); // userId -> username

// Store messages in memory (for mock mode)
const mockMessages = new Map(); // key: `${userId}_${otherUserId}` -> array of messages

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
      
      // Send current online users to the new user
      socket.emit("onlineUsers", onlineUsersList);
    }
  });

  // Handle private messages
  socket.on("private-message", (data) => {
    console.log("📨 Received private message:", data);

    const { toUserId, fromUserId, fromUsername, text, timestamp, id } = data;

    // Store message in mock database if Firebase not available
    if (!firebaseInitialized) {
      const key = [fromUserId, toUserId].sort().join('_');
      if (!mockMessages.has(key)) {
        mockMessages.set(key, []);
      }
      mockMessages.get(key).push(data);
      console.log(`💾 Message stored in mock database for key: ${key}`);
    }

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

    // Store message in mock database if Firebase not available
    if (!firebaseInitialized) {
      const key = [fromUserId, toUserId].sort().join('_');
      if (!mockMessages.has(key)) {
        mockMessages.set(key, []);
      }
      mockMessages.get(key).push(data);
    }

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
      // Keep userNames for reconnection

      // Broadcast updated online users list
      const onlineUsersList = Array.from(onlineUsers.entries()).map(
        ([userId, socketId]) => ({
          userId,
          username: userNames.get(userId) || `User ${userId}`,
          socketId,
        }),
      );
      io.emit("onlineUsers", onlineUsersList);
      console.log(`👤 User ${userId} went offline`);
    }
  });
});

// ✅ Register user API
app.post("/api/register", (req, res) => {
  try {
    const { username } = req.body;

    if (!username) {
      return res.status(400).json({
        success: false,
        message: "Username required",
      });
    }

    // Check if username already exists (in mock mode)
    let existingUser = null;
    for (const [userId, storedUsername] of userNames.entries()) {
      if (storedUsername === username) {
        existingUser = { id: userId, username: storedUsername };
        break;
      }
    }

    if (existingUser) {
      console.log("✅ User already registered:", username);
      return res.json({
        success: true,
        user: existingUser,
        message: "User already exists",
      });
    }

    // Generate a unique ID
    const userId = Date.now().toString();
    
    // Store username (even if offline)
    userNames.set(userId, username);
    
    console.log("✅ New user registered:", username, "with ID:", userId);

    res.json({
      success: true,
      user: {
        id: userId,
        username: username,
      },
    });
  } catch (error) {
    console.error("Register error:", error);

    res.status(500).json({
      success: false,
      message: "Register failed",
      error: error.message,
    });
  }
});

// REST API endpoints
app.get("/", (req, res) => {
  res.json({
    message: "Chat App Backend is running!",
    mode: firebaseInitialized ? "Firebase" : "Mock Data",
    timestamp: new Date().toISOString(),
    onlineUsers: onlineUsers.size,
    registeredUsers: userNames.size,
    endpoints: {
      health: "/api/health",
      register: "/api/register",
      users: "/api/users",
      onlineUsers: "/api/online-users",
      messages: "/api/private-messages",
      debug: "/api/debug/messages",
      socket: "WebSocket connection available"
    }
  });
});

app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    firebase: firebaseInitialized ? "connected" : "not connected (using mock data)",
    onlineUsers: onlineUsers.size,
    registeredUsers: userNames.size,
    server: "running",
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    nodeVersion: process.version
  });
});

// Get private messages between two users
app.get("/api/private-messages", async (req, res) => {
  try {
    const { userId, otherUserId } = req.query;

    if (!userId || !otherUserId) {
      return res.status(400).json({ 
        error: "Missing userId or otherUserId",
        messages: [] 
      });
    }

    let messages = [];

    // If Firebase is not initialized, use mock data
    if (!firebaseInitialized || !db) {
      console.log("Using mock messages data for users:", userId, otherUserId);
      
      // Get messages from mock storage
      const key = [userId, otherUserId].sort().join('_');
      const storedMessages = mockMessages.get(key) || [];
      
      // Sort messages by timestamp
      messages = storedMessages.sort((a, b) => 
        new Date(a.timestamp) - new Date(b.timestamp)
      );
      
      console.log(`Found ${messages.length} mock messages`);
    } else {
      // Query messages from Firebase
      const messagesRef = db.collection("privateMessages");
      const snapshot = await messagesRef
        .where("participants", "array-contains", userId)
        .get();

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
    }

    res.json({ 
      success: true,
      messages,
      count: messages.length 
    });
  } catch (error) {
    console.error("Error fetching private messages:", error);
    res.status(500).json({ 
      error: "Failed to fetch messages",
      messages: [] 
    });
  }
});

// Save a new message
app.post("/api/private-messages", async (req, res) => {
  try {
    const message = req.body;

    if (!message.fromUserId || !message.toUserId || !message.text) {
      return res.status(400).json({ 
        error: "Missing required fields",
        success: false 
      });
    }

    // If Firebase is not initialized, save to mock storage
    if (!firebaseInitialized || !db) {
      console.log("Mock saving message:", message);
      
      // Generate ID if not provided
      if (!message.id) {
        message.id = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      }
      
      // Add timestamp if not provided
      if (!message.timestamp) {
        message.timestamp = new Date().toISOString();
      }
      
      // Store in mock messages
      const key = [message.fromUserId, message.toUserId].sort().join('_');
      if (!mockMessages.has(key)) {
        mockMessages.set(key, []);
      }
      mockMessages.get(key).push(message);
      
      return res.json({ 
        success: true, 
        id: message.id, 
        message 
      });
    }

    // Add participants array for easier querying
    message.participants = [message.fromUserId, message.toUserId];
    message.createdAt = new Date().toISOString();

    const docRef = await db.collection("privateMessages").add(message);

    res.json({ 
      success: true, 
      id: docRef.id, 
      message 
    });
  } catch (error) {
    console.error("Error saving message:", error);
    res.status(500).json({ 
      error: "Failed to save message",
      success: false 
    });
  }
});

// Get all registered users
app.get("/api/users", (req, res) => {
  const allUsers = Array.from(userNames.entries()).map(([userId, username]) => ({
    id: userId,
    username: username,
    isOnline: onlineUsers.has(userId),
  }));
  res.json(allUsers);
});

// Get online users only
app.get("/api/online-users", (req, res) => {
  const onlineUsersList = Array.from(onlineUsers.entries()).map(
    ([userId, socketId]) => ({
      id: userId,
      username: userNames.get(userId) || `User ${userId}`,
      isOnline: true,
    }),
  );
  res.json(onlineUsersList);
});

// Debug endpoint to see all stored mock messages
app.get("/api/debug/messages", (req, res) => {
  if (!firebaseInitialized) {
    const allMessages = {};
    for (const [key, messages] of mockMessages.entries()) {
      allMessages[key] = messages;
    }
    res.json({
      mode: "mock",
      messages: allMessages,
      totalConversations: mockMessages.size,
      totalMessages: Array.from(mockMessages.values()).reduce((sum, msgs) => sum + msgs.length, 0)
    });
  } else {
    res.json({
      mode: "firebase",
      message: "Using Firebase database"
    });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error("Error:", err);
  res.status(500).json({
    error: "Internal server error",
    message: err.message,
    success: false
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: "Not found",
    path: req.path,
    success: false
  });
});

// Start server
const PORT = process.env.PORT || 5000;
const HOST = "0.0.0.0";

server.listen(PORT, HOST, () => {
  console.log("\n" + "=".repeat(60));
  console.log(`🚀 Server running on http://${HOST}:${PORT}`);
  console.log(`📡 WebSocket server ready at ws://${HOST}:${PORT}`);
  console.log(`🌐 CORS enabled for origins:`);
  allowedOrigins.forEach(origin => {
    console.log(`   - ${origin}`);
  });
  console.log(`📝 Mode: ${firebaseInitialized ? "Firebase Database" : "Mock Data (in-memory)"}`);
  console.log(`👥 Registered users: ${userNames.size}`);
  console.log(`🔌 Online users: ${onlineUsers.size}`);
  console.log("=".repeat(60) + "\n");
});

// Handle graceful shutdown
process.on("SIGINT", () => {
  console.log("\n👋 Shutting down gracefully...");
  server.close(() => {
    console.log("✅ Server closed");
    process.exit(0);
  });
});

process.on("SIGTERM", () => {
  console.log("\n👋 Shutting down gracefully...");
  server.close(() => {
    console.log("✅ Server closed");
    process.exit(0);
  });
});