import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";
import dotenv from "dotenv";
import admin from "firebase-admin";
import { fileURLToPath } from "url";
import { dirname } from "path";

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const server = http.createServer(app);

// ✅ CORS configuration
const allowedOrigins = [
  "http://localhost:5173",
  "http://localhost:3000",
  "http://127.0.0.1:5173",
  "http://192.168.29.92:5173",
  "https://real-time-chat-application-sand-three.vercel.app",
  "https://chat-app-frontend-xi.vercel.app",
];

const corsOptions = {
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);

    if (
      allowedOrigins.indexOf(origin) !== -1 ||
      process.env.NODE_ENV !== "production"
    ) {
      callback(null, true);
    } else {
      console.log("⚠️ Origin not allowed:", origin);
      if (process.env.NODE_ENV !== "production") {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    }
  },
  credentials: true,
  optionsSuccessStatus: 200,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
};

app.use(cors(corsOptions));
app.use(express.json({ limit: "10mb" }));

// Initialize Firebase Admin
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
  }
} catch (error) {
  console.error("❌ Firebase initialization error:", error.message);
  console.log("⚠️ Continuing with mock data mode");
}

// Socket.io setup
const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST"],
    credentials: true,
  },
  transports: ["websocket", "polling"],
  pingTimeout: 60000,
  pingInterval: 25000,
});

// Store data using Map for better performance
const onlineUsers = new Map(); // userId -> socketId
const userSockets = new Map(); // socketId -> userId
const userNames = new Map(); // userId -> username
const mockMessages = new Map();

// Socket.io connection handling
io.on("connection", (socket) => {
  console.log(`🟢 New client connected: ${socket.id}`);

  // 🧠 Register user for chat
  socket.on("register", (userId, username) => {
    try {
      if (!userId) {
        console.log("❌ Invalid registration: missing userId");
        return;
      }

      if (onlineUsers.has(userId)) {
        const oldSocketId = onlineUsers.get(userId);
        if (oldSocketId !== socket.id) {
          console.log(`👤 User ${userId} reconnecting, cleaning old socket`);
          const oldSocket = io.sockets.sockets.get(oldSocketId);
          if (oldSocket) oldSocket.disconnect(true);
          onlineUsers.delete(userId);
          userSockets.delete(oldSocketId);
        }
      }

      onlineUsers.set(userId, socket.id);
      userSockets.set(socket.id, userId);
      if (username) userNames.set(userId, username);

      console.log(`👤 User ${userId} (${username || "Unknown"}) registered`);

      const onlineUsersList = Array.from(onlineUsers.entries()).map(
        ([userId, socketId]) => ({
          userId,
          username: userNames.get(userId) || `User ${userId}`,
          socketId,
        }),
      );

      io.emit("onlineUsers", onlineUsersList);
      socket.emit("onlineUsers", onlineUsersList);
      socket.emit("registered", { success: true, userId, username });
    } catch (error) {
      console.error("Error in register handler:", error);
      socket.emit("error", { message: "Registration failed" });
    }
  });

  // Alternative register event for video call (using object for consistency)
  socket.on("register-user", (data) => {
    // Handle both string and object formats
    const userId = typeof data === 'object' ? data.userId : data;
    const username = typeof data === 'object' ? data.username : null;
    
    console.log("👤 Registered user (video call):", userId);
    
    if (!userId) return;
    
    onlineUsers.set(userId, socket.id);
    userSockets.set(socket.id, userId);
    if (username) userNames.set(userId, username);
    
    const onlineUsersList = Array.from(onlineUsers.entries()).map(
      ([userId, socketId]) => ({
        userId,
        username: userNames.get(userId) || `User ${userId}`,
        socketId,
      }),
    );
    io.emit("onlineUsers", onlineUsersList);
    
    // Send confirmation back
    socket.emit("registered", { success: true, userId, username });
  });

  // 📞 CALL USER (Video/Audio Call)
  socket.on("call-user", (data) => {
    console.log("📞 Calling user:", data);
    
    const { to, from, offer, fromUsername } = data;
    const receiverSocketId = onlineUsers.get(to);

    if (receiverSocketId) {
      io.to(receiverSocketId).emit("incoming-call", {
        from,
        fromUsername: fromUsername || userNames.get(from) || "Unknown",
        offer,
      });
      console.log(`📞 Call initiated from ${from} to ${to}`);
      
      // Send confirmation to caller
      socket.emit("call-initiated", { to, success: true });
    } else {
      console.log(`❌ User ${to} is offline`);
      socket.emit("call-error", { message: "User is offline", to });
    }
  });

  // 📞 ANSWER CALL
  socket.on("answer-call", (data) => {
    console.log("📞 Answering call:", data);
    
    const { to, answer } = data;
    const receiverSocketId = onlineUsers.get(to);

    if (receiverSocketId) {
      io.to(receiverSocketId).emit("call-answered", {
        answer,
      });
      console.log(`📞 Call answered by ${to}`);
    } else {
      console.log(`❌ Cannot answer: User ${to} is offline`);
      socket.emit("call-error", { message: "User is offline" });
    }
  });

  // ❄ ICE CANDIDATE
  socket.on("ice-candidate", (data) => {
    console.log("❄ ICE candidate sent to:", data.to);
    
    const { to, candidate } = data;
    const receiverSocketId = onlineUsers.get(to);

    if (receiverSocketId) {
      io.to(receiverSocketId).emit("ice-candidate", {
        candidate,
      });
    }
  });

  // 📞 End Call
  socket.on("end-call", (data) => {
    console.log("🔴 Ending call:", data);
    
    const { to } = data;
    const receiverSocketId = onlineUsers.get(to);

    if (receiverSocketId) {
      io.to(receiverSocketId).emit("call-ended", {
        message: "Call ended",
      });
    }
  });

  // 📨 Private messages
  socket.on("private-message", (data) => {
    try {
      const { toUserId, fromUserId, fromUsername, text, timestamp, id } = data;

      if (!toUserId || !fromUserId || !text) return;

      if (!firebaseInitialized) {
        const key = [fromUserId, toUserId].sort().join("_");
        if (!mockMessages.has(key)) mockMessages.set(key, []);
        mockMessages.get(key).push(data);
      }

      const receiverSocketId = onlineUsers.get(toUserId);
      if (receiverSocketId) {
        io.to(receiverSocketId).emit("private-message", {
          id,
          fromUserId,
          fromUsername,
          toUserId,
          text,
          timestamp,
          type: "private",
        });
        console.log(`📨 Message sent to ${toUserId}`);
      } else {
        console.log(`📨 User ${toUserId} offline, message stored`);
        // Store offline message (optional)
        const offlineKey = `offline_${toUserId}`;
        const offlineMessages = mockMessages.get(offlineKey) || [];
        offlineMessages.push(data);
        mockMessages.set(offlineKey, offlineMessages);
      }

      socket.emit("message-sent", { id, success: true });
    } catch (error) {
      console.error("Error in private-message handler:", error);
      socket.emit("error", { message: "Failed to send message" });
    }
  });

  socket.on("privateMessage", (data) => {
    try {
      const { toUserId, fromUserId, fromUsername, text, timestamp, id } = data;

      if (!toUserId || !fromUserId || !text) return;

      if (!firebaseInitialized) {
        const key = [fromUserId, toUserId].sort().join("_");
        if (!mockMessages.has(key)) mockMessages.set(key, []);
        mockMessages.get(key).push(data);
      }

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
      }

      socket.emit("message-sent", { id, success: true });
    } catch (error) {
      console.error("Error in privateMessage handler:", error);
      socket.emit("error", { message: "Failed to send message" });
    }
  });

  // ⌨️ Typing indicators
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

  // 👥 Get users
  socket.on("getUsers", () => {
    const usersList = Array.from(onlineUsers.entries()).map(
      ([userId, socketId]) => ({
        id: userId,
        username: userNames.get(userId) || `User ${userId}`,
        isOnline: true,
      }),
    );
    socket.emit("users", usersList);
  });

  // 🔴 Disconnect
  socket.on("disconnect", (reason) => {
    console.log(`🔴 Client disconnected: ${socket.id}, reason: ${reason}`);

    const userId = userSockets.get(socket.id);
    if (userId) {
      onlineUsers.delete(userId);
      userSockets.delete(socket.id);
      // Keep userNames for reconnection

      const onlineUsersList = Array.from(onlineUsers.entries()).map(
        ([userId, socketId]) => ({
          userId,
          username: userNames.get(userId) || `User ${userId}`,
          socketId,
        }),
      );
      io.emit("onlineUsers", onlineUsersList);
      console.log(`👤 User ${userId} went offline (${reason})`);
    }
  });
});

// ✅ API Endpoints (Same as before - keeping them unchanged)

// Login endpoint
app.post("/api/login", (req, res) => {
  try {
    const { username } = req.body;

    if (!username || typeof username !== "string") {
      return res.status(400).json({
        success: false,
        message: "Valid username required",
      });
    }

    const trimmedUsername = username.trim();
    if (trimmedUsername.length < 2) {
      return res.status(400).json({
        success: false,
        message: "Username must be at least 2 characters",
      });
    }

    let existingUser = null;
    for (const [userId, storedUsername] of userNames.entries()) {
      if (storedUsername.toLowerCase() === trimmedUsername.toLowerCase()) {
        existingUser = { id: userId, username: storedUsername };
        break;
      }
    }

    if (existingUser) {
      console.log("✅ User logged in:", trimmedUsername);
      return res.json({
        success: true,
        user: existingUser,
        message: "Login successful!",
      });
    }

    const userId = Date.now().toString() + Math.random().toString(36).substr(2, 5);
    userNames.set(userId, trimmedUsername);

    console.log("✅ New user auto-registered:", trimmedUsername, "with ID:", userId);

    res.json({
      success: true,
      user: {
        id: userId,
        username: trimmedUsername,
      },
      message: "User created and logged in successfully!",
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({
      success: false,
      message: "Login failed",
    });
  }
});

// Register endpoint
app.post("/api/register", (req, res) => {
  try {
    const { username } = req.body;

    if (!username || typeof username !== "string") {
      return res.status(400).json({
        success: false,
        message: "Valid username required",
      });
    }

    const trimmedUsername = username.trim();
    if (trimmedUsername.length < 2) {
      return res.status(400).json({
        success: false,
        message: "Username must be at least 2 characters",
      });
    }

    let existingUser = null;
    for (const [userId, storedUsername] of userNames.entries()) {
      if (storedUsername.toLowerCase() === trimmedUsername.toLowerCase()) {
        existingUser = { id: userId, username: storedUsername };
        break;
      }
    }

    if (existingUser) {
      console.log("✅ User already exists:", trimmedUsername);
      return res.json({
        success: true,
        user: existingUser,
        message: "User already exists. Please login.",
      });
    }

    const userId = Date.now().toString() + Math.random().toString(36).substr(2, 5);
    userNames.set(userId, trimmedUsername);

    console.log("✅ New user registered:", trimmedUsername, "with ID:", userId);

    res.json({
      success: true,
      user: {
        id: userId,
        username: trimmedUsername,
      },
      message: "Registration successful!",
    });
  } catch (error) {
    console.error("Register error:", error);
    res.status(500).json({
      success: false,
      message: "Registration failed",
    });
  }
});

// Save FCM Token
app.post("/api/save-fcm-token", (req, res) => {
  try {
    const { userId, token } = req.body;
    console.log(`📱 FCM Token saved for user ${userId}:`, token);
    res.json({ success: true, message: "Token saved" });
  } catch (error) {
    console.error("Error saving FCM token:", error);
    res.status(500).json({ success: false, message: "Failed to save token" });
  }
});

// Home endpoint
app.get("/", (req, res) => {
  res.json({
    message: "Chat App Backend is running!",
    mode: firebaseInitialized ? "Firebase" : "Mock Data",
    version: "1.0.0",
    timestamp: new Date().toISOString(),
    endpoints: {
      login: "/api/login (POST)",
      register: "/api/register (POST)",
      saveFCMToken: "/api/save-fcm-token (POST)",
      health: "/api/health (GET)",
      users: "/api/users (GET)",
      onlineUsers: "/api/online-users (GET)",
      messages: "/api/private-messages (GET)",
      debug: "/api/debug (GET)",
    },
  });
});

// Health check endpoint
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    firebase: firebaseInitialized ? "connected" : "mock data",
    onlineUsers: onlineUsers.size,
    registeredUsers: userNames.size,
    uptime: process.uptime(),
  });
});

// Get private messages
app.get("/api/private-messages", async (req, res) => {
  try {
    const { userId, otherUserId } = req.query;

    if (!userId || !otherUserId) {
      return res.status(400).json({
        success: false,
        messages: [],
      });
    }

    let messages = [];

    if (!firebaseInitialized || !db) {
      const key = [userId, otherUserId].sort().join("_");
      const storedMessages = mockMessages.get(key) || [];
      messages = storedMessages.sort(
        (a, b) => new Date(a.timestamp) - new Date(b.timestamp),
      );
    } else {
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

      messages.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    }

    res.json({
      success: true,
      messages,
      count: messages.length,
    });
  } catch (error) {
    console.error("Error fetching messages:", error);
    res.status(500).json({
      success: false,
      messages: [],
    });
  }
});

// Save private message
app.post("/api/private-messages", async (req, res) => {
  try {
    const message = req.body;

    if (!message.fromUserId || !message.toUserId || !message.text) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields",
      });
    }

    if (!firebaseInitialized || !db) {
      if (!message.id) {
        message.id = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      }
      if (!message.timestamp) {
        message.timestamp = new Date().toISOString();
      }

      const key = [message.fromUserId, message.toUserId].sort().join("_");
      if (!mockMessages.has(key)) mockMessages.set(key, []);
      mockMessages.get(key).push(message);

      return res.json({ success: true, id: message.id, message });
    }

    message.participants = [message.fromUserId, message.toUserId];
    message.createdAt = new Date().toISOString();

    const docRef = await db.collection("privateMessages").add(message);

    res.json({ success: true, id: docRef.id, message });
  } catch (error) {
    console.error("Error saving message:", error);
    res.status(500).json({ success: false, error: "Failed to save message" });
  }
});

// Get all registered users
app.get("/api/users", (req, res) => {
  const allUsers = Array.from(userNames.entries()).map(
    ([userId, username]) => ({
      id: userId,
      username: username,
      isOnline: onlineUsers.has(userId),
    }),
  );
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

// Debug endpoint
app.get("/api/debug", (req, res) => {
  res.json({
    onlineUsers: Array.from(onlineUsers.entries()),
    userNames: Array.from(userNames.entries()),
    mockMessagesSize: mockMessages.size,
    firebaseInitialized,
    totalUsers: userNames.size,
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: "Not found",
    path: req.path,
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error("Error:", err);
  res.status(500).json({
    success: false,
    error: "Internal server error",
  });
});

// Start server
const PORT = process.env.PORT || 5000;
const HOST = "0.0.0.0";

server.listen(PORT, HOST, () => {
  console.log("\n" + "=".repeat(60));
  console.log(`🚀 Server running on http://${HOST}:${PORT}`);
  console.log(`📡 WebSocket server ready at ws://${HOST}:${PORT}`);
  console.log(
    `📝 Mode: ${firebaseInitialized ? "Firebase Database" : "Mock Data"}`,
  );
  console.log(`👥 Registered users: ${userNames.size}`);
  console.log(`🌐 CORS enabled for ${allowedOrigins.length} origins`);
  console.log("\n📌 Available Endpoints:");
  console.log("   POST   /api/login     - Login (auto-registers if new user)");
  console.log("   POST   /api/register  - Explicit registration");
  console.log("   POST   /api/save-fcm-token - Save FCM token");
  console.log("   GET    /api/health    - Health check");
  console.log("   GET    /api/users     - Get all users");
  console.log("   GET    /api/online-users - Get online users");
  console.log("   GET    /api/private-messages - Get messages");
  console.log("   POST   /api/private-messages - Save message");
  console.log("   GET    /api/debug     - Debug info");
  console.log("\n📞 WebSocket Events:");
  console.log("   register / register-user - Register user");
  console.log("   call-user - Initiate video/audio call");
  console.log("   answer-call - Answer incoming call");
  console.log("   ice-candidate - Send ICE candidate");
  console.log("   end-call - End call");
  console.log("   private-message - Send private message");
  console.log("   typing - Typing indicator");
  console.log("   getUsers - Get online users list");
  console.log("=".repeat(60) + "\n");
});

// Graceful shutdown
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