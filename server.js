import express from "express";
import https from "https";
import http from "http";
import path from "path";
import { Server } from "socket.io";
import cors from "cors";
import dotenv from "dotenv";
import admin from "firebase-admin";
import { fileURLToPath } from "url";
import { dirname } from "path";
import fs from "fs";
import os from "os";
import { Resend } from "resend";

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(null, true); // Allow all in development
      }
    },
    credentials: true,
    allowedHeaders: ["Content-Type", "Authorization", "ngrok-skip-browser-warning"],
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  }),
);
app.options("*splat", cors());

// Helper function to get local IP
const getLocalIp = () => {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const net of interfaces[name]) {
      if (net.family === "IPv4" && !net.internal) {
        return net.address;
      }
    }
  }
  return "localhost";
};

// Check if certificates exist
const certsDir = `${__dirname}/certs`;

// Create certs directory if it doesn't exist
if (!fs.existsSync(certsDir)) {
  try {
    fs.mkdirSync(certsDir, { recursive: true });
    console.log("📁 Created certs directory");
  } catch (error) {
    console.log("⚠️ Could not create certs directory:", error.message);
  }
}

// Create HTTPS or HTTP server
let server;
let isHttps = false;

const certPath = path.join(__dirname, "certs", "cert.pem");
const keyPath = path.join(__dirname, "certs", "key.pem");

try {
  if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
    try {
      const key = fs.readFileSync(keyPath);
      const cert = fs.readFileSync(certPath);
      server = https.createServer({ key, cert }, app);
      isHttps = true;
      console.log("🔒 HTTPS server created with mkcert certificates");
    } catch (error) {
      console.error("❌ Error loading certificates:", error.message);
      console.log("⚠️ Falling back to HTTP server");
      server = http.createServer(app);
    }
  } else {
    console.log("⚠️ No SSL certificates found. Running HTTP server.");
    console.log("💡 To enable HTTPS, generate certificates using:");
    console.log("   cd certs && mkcert 192.168.29.92 localhost 127.0.0.1");
    server = http.createServer(app);
  }
} catch (error) {
  console.error("❌ Server creation error:", error.message);
  server = http.createServer(app);
}

// ✅ CORS configuration
const allowedOrigins = [
  "http://localhost:5173",
  "http://localhost:5174",
  "http://localhost:5175",
  "http://127.0.0.1:5173",
  "http://127.0.0.1:5174",
  "http://192.168.29.93:5173",
  "http://192.168.29.93:5174",
  "https://localhost:5173",
  "https://localhost:5174",
  "https://127.0.0.1:5173",
  "https://192.168.29.93:5173",
  "https://192.168.29.93:5174",
  "https://menially-mastoparietal-siobhan.ngrok-free.dev",
  "https://real-time-chat-application-sand-three.vercel.app",
  "https://chat-app-frontend-xi.vercel.app",
];

const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl)
    if (!origin) return callback(null, true);

    // Check if origin is allowed
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.log("⚠️ Origin not allowed:", origin);
      callback(new Error("Not allowed by CORS"));
    }
  },
  credentials: true,
  optionsSuccessStatus: 200,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
};

app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
  });
});

app.use(
  cors({
    origin: function (origin, callback) {
      // Allow requests with no origin (like Postman)
      if (!origin) return callback(null, true);

      if (allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        console.log("⚠️ Origin not allowed:", origin);
        callback(null, true); // ✅ TEMP allow all (fix error)
      }
    },
    credentials: true,
  }),
);
app.use(express.json({ limit: "10mb" }));

// Initialize Firebase Admin
let firebaseInitialized = false;
let db = null;

try {
  if (
    process.env.FIREBASE_SERVICE_ACCOUNT &&
    process.env.FIREBASE_SERVICE_ACCOUNT !== "undefined"
  ) {
    try {
      const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
      if (!admin.apps.length) {
        admin.initializeApp({
          credential: admin.credential.cert(serviceAccount),
        });
        console.log("✅ Firebase Admin initialized successfully");
        firebaseInitialized = true;
        db = admin.firestore();
      } else {
        console.log("✅ Firebase already initialized");
        firebaseInitialized = true;
        db = admin.firestore();
      }
    } catch (parseError) {
      console.error(
        "❌ Failed to parse Firebase service account:",
        parseError.message,
      );
      console.log("⚠️ Using mock data mode");
    }
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
    origin: [
      "https://localhost:5173",
      "https://localhost:5174",
      "https://192.168.29.93:5173",
      "http://localhost:5173",
      "http://192.168.29.93:5173",
      "https://menially-mastoparietal-siobhan.ngrok-free.dev",
      "https://real-time-chat-application-sand-three.vercel.app",
      "https://chat-app-frontend-xi.vercel.app",
    ],
    methods: ["GET", "POST"],
    credentials: true,
  },

  transports: ["websocket", "polling"],

  allowEIO3: true,
});

// Store data using Map
const onlineUsers = new Map(); // userId -> socketId
const userSockets = new Map(); // socketId -> userId
const userNames = new Map(); // userId -> username
const mockMessages = new Map();
const offlineMessages = new Map(); // userId -> array of offline messages

// Clean up offline messages periodically (every hour)
const cleanupInterval = setInterval(
  () => {
    try {
      const now = Date.now();
      let cleanedCount = 0;

      for (const [userId, messages] of offlineMessages.entries()) {
        // Remove messages older than 24 hours
        const filteredMessages = messages.filter((msg) => {
          const msgTime = new Date(msg.timestamp).getTime();
          return now - msgTime < 24 * 60 * 60 * 1000;
        });
        if (filteredMessages.length === 0) {
          offlineMessages.delete(userId);
          cleanedCount++;
        } else if (filteredMessages.length !== messages.length) {
          offlineMessages.set(userId, filteredMessages);
          cleanedCount++;
        }
      }

      if (cleanedCount > 0) {
        console.log(
          `🧹 Cleaned up offline messages. Active offline stores: ${offlineMessages.size}`,
        );
      }
    } catch (error) {
      console.error("Error cleaning offline messages:", error);
    }
  },
  60 * 60 * 1000,
); // Run every hour

// Helper function to validate user
const isValidUser = (userId) => {
  return (
    userId &&
    typeof userId === "string" &&
    userId.length > 0 &&
    userId.length < 100
  );
};

// Helper function to validate message
const isValidMessage = (text) => {
  return (
    text &&
    typeof text === "string" &&
    text.trim().length > 0 &&
    text.length <= 5000
  );
};

// Helper function to broadcast online users
const broadcastOnlineUsers = () => {
  try {
    const onlineUsersList = Array.from(onlineUsers.entries()).map(
      ([userId, socketId]) => ({
        userId,
        username: userNames.get(userId) || `User ${userId}`,
        socketId,
      }),
    );
    io.emit("onlineUsers", onlineUsersList);
  } catch (error) {
    console.error("Error broadcasting online users:", error);
  }
};

// Socket.io connection handling
io.on("connection", (socket) => {
  console.log(`🟢 New client connected: ${socket.id}`);

  // Unified registration handler
  socket.on("register", (data) => {
    try {
      // Handle both formats: direct params or object
      let userId, username;
      if (typeof data === "object" && data !== null) {
        userId = data.userId;
        username = data.username;
      } else {
        userId = data;
        username = null;
      }

      if (!isValidUser(userId)) {
        console.log("❌ Invalid registration: missing or invalid userId");
        socket.emit("error", { message: "Invalid user ID" });
        return;
      }

      // Clean up existing connection
      if (onlineUsers.has(userId)) {
        const oldSocketId = onlineUsers.get(userId);
        if (oldSocketId !== socket.id) {
          console.log(`👤 User ${userId} reconnecting, cleaning old socket`);
          const oldSocket = io.sockets.sockets.get(oldSocketId);
          if (oldSocket && oldSocket.connected) {
            oldSocket.disconnect(true);
          }
          onlineUsers.delete(userId);
          userSockets.delete(oldSocketId);
        }
      }

      // Register new connection
      onlineUsers.set(userId, socket.id);
      userSockets.set(socket.id, userId);

      if (username && typeof username === "string" && username.length > 0) {
        userNames.set(userId, username);
      }

      console.log(
        `👤 User ${userId} (${userNames.get(userId) || "Unknown"}) registered`,
      );

      // Send offline messages if any
      const pendingMessages = offlineMessages.get(userId) || [];
      if (pendingMessages.length > 0) {
        console.log(
          `📨 Sending ${pendingMessages.length} offline messages to ${userId}`,
        );
        pendingMessages.forEach((msg) => {
          socket.emit("private-message", msg);
        });
        offlineMessages.delete(userId);
      }

      // Broadcast updated online users
      broadcastOnlineUsers();

      // Send confirmation
      socket.emit("registered", {
        success: true,
        userId,
        username: userNames.get(userId),
      });
    } catch (error) {
      console.error("Error in register handler:", error);
      socket.emit("error", { message: "Registration failed" });
    }
  });

  // 📞 CALL USER (Video/Audio Call)
  socket.on("call-user", (data) => {
    try {
      const { to, from, offer, fromUsername } = data;

      if (!isValidUser(to) || !isValidUser(from)) {
        socket.emit("call-error", { message: "Invalid user information" });
        return;
      }

      const receiverSocketId = onlineUsers.get(to);

      if (receiverSocketId) {
        io.to(receiverSocketId).emit("incoming-call", {
          from,
          fromUsername: fromUsername || userNames.get(from) || "Unknown",
          offer,
          callId: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        });
        console.log(`📞 Call initiated from ${from} to ${to}`);
        socket.emit("call-initiated", { to, success: true });
      } else {
        console.log(`❌ User ${to} is offline`);
        socket.emit("call-error", { message: "User is offline", to });
      }
    } catch (error) {
      console.error("Error in call-user:", error);
      socket.emit("call-error", { message: "Failed to initiate call" });
    }
  });

  // 📞 ANSWER CALL
  socket.on("answer-call", (data) => {
    try {
      const { to, answer } = data;

      if (!isValidUser(to)) {
        socket.emit("call-error", { message: "Invalid user" });
        return;
      }

      const receiverSocketId = onlineUsers.get(to);

      if (receiverSocketId) {
        io.to(receiverSocketId).emit("call-answered", { answer });
        console.log(`📞 Call answered by ${to}`);
      } else {
        console.log(`❌ Cannot answer: User ${to} is offline`);
        socket.emit("call-error", { message: "User is offline" });
      }
    } catch (error) {
      console.error("Error in answer-call:", error);
      socket.emit("call-error", { message: "Failed to answer call" });
    }
  });

  // ❄ ICE CANDIDATE
  socket.on("ice-candidate", (data) => {
    try {
      const { to, candidate } = data;

      if (!isValidUser(to)) return;

      const receiverSocketId = onlineUsers.get(to);
      if (receiverSocketId) {
        io.to(receiverSocketId).emit("ice-candidate", { candidate });
      }
    } catch (error) {
      console.error("Error in ice-candidate:", error);
    }
  });

  // 📞 End Call
  socket.on("end-call", (data) => {
    try {
      const { to } = data;

      if (!isValidUser(to)) return;

      const receiverSocketId = onlineUsers.get(to);
      if (receiverSocketId) {
        io.to(receiverSocketId).emit("call-ended", { message: "Call ended" });
      }
    } catch (error) {
      console.error("Error in end-call:", error);
    }
  });

  // 📨 Private messages (unified)
  socket.on("private-message", (data) => {
    try {
      const {
        toUserId,
        fromUserId,
        fromUsername,
        text,
        timestamp = new Date().toISOString(),
        id = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      } = data;

      if (!isValidUser(toUserId) || !isValidUser(fromUserId)) {
        socket.emit("error", { message: "Invalid user information" });
        return;
      }

      if (!isValidMessage(text)) {
        socket.emit("error", { message: "Invalid message content" });
        return;
      }

      const messageData = {
        id,
        fromUserId,
        fromUsername: fromUsername || userNames.get(fromUserId) || "Unknown",
        toUserId,
        text: text.trim(),
        timestamp,
        type: "private",
      };

      // Save to Firebase if available
      if (firebaseInitialized && db) {
        db.collection("privateMessages")
          .add({
            ...messageData,
            participants: [fromUserId, toUserId],
            createdAt: new Date().toISOString(),
          })
          .catch((err) =>
            console.error("Error saving message to Firebase:", err),
          );
      } else {
        // Save to mock storage with limit
        const key = [fromUserId, toUserId].sort().join("_");
        if (!mockMessages.has(key)) mockMessages.set(key, []);
        mockMessages.get(key).push(messageData);

        // Limit mock messages to prevent memory issues (keep last 500)
        if (mockMessages.get(key).length > 500) {
          mockMessages.set(key, mockMessages.get(key).slice(-500));
        }
      }

      const receiverSocketId = onlineUsers.get(toUserId);
      if (receiverSocketId) {
        io.to(receiverSocketId).emit("private-message", messageData);
        console.log(`📨 Message sent to ${toUserId}`);
      } else {
        console.log(`📨 User ${toUserId} offline, storing message`);
        // Store offline message with limit
        const pendingMessages = offlineMessages.get(toUserId) || [];
        pendingMessages.push(messageData);

        // Limit offline messages per user (keep last 100)
        if (pendingMessages.length > 100) {
          pendingMessages.shift();
        }
        offlineMessages.set(toUserId, pendingMessages);
      }

      socket.emit("message-sent", { id, success: true });
    } catch (error) {
      console.error("Error in private-message handler:", error);
      socket.emit("error", { message: "Failed to send message" });
    }
  });

  // ⌨️ Typing indicators
  socket.on("typing", (data) => {
    try {
      const { username, isTyping, toUserId } = data;
      if (!isValidUser(toUserId)) return;

      const receiverSocketId = onlineUsers.get(toUserId);
      if (receiverSocketId) {
        io.to(receiverSocketId).emit("typing", {
          username,
          isTyping: Boolean(isTyping),
          fromUserId: userSockets.get(socket.id),
        });
      }
    } catch (error) {
      console.error("Error in typing handler:", error);
    }
  });

  // 👥 Get users
  socket.on("getUsers", () => {
    try {
      const usersList = Array.from(onlineUsers.entries()).map(
        ([userId, socketId]) => ({
          id: userId,
          username: userNames.get(userId) || `User ${userId}`,
          isOnline: true,
        }),
      );
      socket.emit("users", usersList);
    } catch (error) {
      console.error("Error in getUsers:", error);
    }
  });

  // 🔴 Disconnect
  socket.on("disconnect", (reason) => {
    console.log(`🔴 Client disconnected: ${socket.id}, reason: ${reason}`);

    const userId = userSockets.get(socket.id);
    if (userId) {
      onlineUsers.delete(userId);
      userSockets.delete(socket.id);
      // Keep userNames for reconnection

      broadcastOnlineUsers();
      console.log(`👤 User ${userId} went offline (${reason})`);
    }
  });
});

// ✅ API Endpoints

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
    if (trimmedUsername.length < 2 || trimmedUsername.length > 50) {
      return res.status(400).json({
        success: false,
        message: "Username must be between 2 and 50 characters",
      });
    }

    // Check for existing user
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

    // Create new user
    const userId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    userNames.set(userId, trimmedUsername);

    console.log(
      "✅ New user auto-registered:",
      trimmedUsername,
      "with ID:",
      userId,
    );

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
    if (trimmedUsername.length < 2 || trimmedUsername.length > 50) {
      return res.status(400).json({
        success: false,
        message: "Username must be between 2 and 50 characters",
      });
    }

    // Check for existing user
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

    const userId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
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

    if (!userId || !token) {
      return res.status(400).json({
        success: false,
        message: "User ID and token required",
      });
    }

    console.log(`📱 FCM Token saved for user ${userId}`);
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
    protocol: isHttps ? "HTTPS" : "HTTP",
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
    protocol: isHttps ? "https" : "http",
    firebase: firebaseInitialized ? "connected" : "mock data",
    onlineUsers: onlineUsers.size,
    registeredUsers: userNames.size,
    offlineMessages: offlineMessages.size,
    uptime: process.uptime(),
  });
});

// Get private messages with pagination
app.get("/api/private-messages", async (req, res) => {
  try {
    const { userId, otherUserId, limit = 50, before } = req.query;

    if (!userId || !otherUserId) {
      return res.status(400).json({
        success: false,
        messages: [],
        error: "userId and otherUserId are required",
      });
    }

    let messages = [];

    if (!firebaseInitialized || !db) {
      const key = [userId, otherUserId].sort().join("_");
      const storedMessages = mockMessages.get(key) || [];

      let filteredMessages = [...storedMessages];
      if (before) {
        filteredMessages = filteredMessages.filter((m) => m.timestamp < before);
      }

      messages = filteredMessages
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
        .slice(0, parseInt(limit));

      messages.reverse();
    } else {
      const messagesRef = db.collection("privateMessages");
      let query = messagesRef
        .where("participants", "array-contains", userId)
        .orderBy("timestamp", "desc")
        .limit(parseInt(limit));

      if (before) {
        query = query.startAfter(before);
      }

      const snapshot = await query.get();

      snapshot.forEach((doc) => {
        const data = doc.data();
        if (
          (data.fromUserId === userId && data.toUserId === otherUserId) ||
          (data.fromUserId === otherUserId && data.toUserId === userId)
        ) {
          messages.push({ id: doc.id, ...data });
        }
      });

      messages.reverse();
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
      error: "Failed to fetch messages",
    });
  }
});

// Save private message (REST endpoint)
app.post("/api/private-messages", async (req, res) => {
  try {
    const message = req.body;

    if (!message.fromUserId || !message.toUserId || !message.text) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields",
      });
    }

    message.text = message.text.trim();
    if (message.text.length === 0 || message.text.length > 5000) {
      return res.status(400).json({
        success: false,
        error: "Message text must be between 1 and 5000 characters",
      });
    }

    if (!message.id) {
      message.id = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }
    if (!message.timestamp) {
      message.timestamp = new Date().toISOString();
    }

    if (!firebaseInitialized || !db) {
      const key = [message.fromUserId, message.toUserId].sort().join("_");
      if (!mockMessages.has(key)) mockMessages.set(key, []);
      mockMessages.get(key).push(message);

      if (mockMessages.get(key).length > 500) {
        mockMessages.set(key, mockMessages.get(key).slice(-500));
      }

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

// Debug endpoint (only in development)
if (process.env.NODE_ENV !== "production") {
  app.get("/api/debug", (req, res) => {
    res.json({
      onlineUsers: Array.from(onlineUsers.entries()),
      userNames: Array.from(userNames.entries()),
      mockMessagesSize: mockMessages.size,
      offlineMessagesSize: offlineMessages.size,
      firebaseInitialized,
      totalUsers: userNames.size,
      protocol: isHttps ? "HTTPS" : "HTTP",
    });
  });
}

// OTP store (in-memory)
const otpStore = new Map();

// Send OTP route
app.post("/api/send-otp", async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ success: false, message: "Email required" });

  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  otpStore.set(email, { otp, expiresAt: Date.now() + 10 * 60 * 1000 });

  try {
    const nodemailer = await import("nodemailer");
    const transporter = nodemailer.default.createTransport({
      host: "smtp-relay.brevo.com",
      port: 587,
      secure: false,
      family: 4,
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });

    await transporter.sendMail({
      from: `"MeetUp" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: "Your MeetUp Verification Code",
      html: `
        <div style="font-family:sans-serif;max-width:400px;margin:auto;padding:24px;border:1px solid #eee;border-radius:12px;">
          <h2 style="color:#2D8CFF;">MeetUp Verification</h2>
          <p>Your verification code is:</p>
          <h1 style="letter-spacing:8px;color:#1a1a1a;">${otp}</h1>
          <p style="color:#888;font-size:12px;">This code expires in 10 minutes.</p>
        </div>
      `,
    });

    console.log(`✅ OTP sent to ${email}`);
    res.json({ success: true, message: "OTP sent" });
  } catch (err) {
    console.error("❌ Email send error:", err.message);
    res.status(500).json({ success: false, message: "Failed to send OTP" });
  }
});

// Verify OTP route
app.post("/api/verify-otp", (req, res) => {
  const { email, otp } = req.body;
  const record = otpStore.get(email);

  if (!record) return res.status(400).json({ success: false, message: "OTP not found" });
  if (Date.now() > record.expiresAt) {
    otpStore.delete(email);
    return res.status(400).json({ success: false, message: "OTP expired" });
  }
  if (record.otp !== otp) return res.status(400).json({ success: false, message: "Invalid OTP" });

  otpStore.delete(email);
  res.json({ success: true, message: "OTP verified" });
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
const LOCAL_IP = getLocalIp();

const logServerStart = (port) => {
  const protocol = isHttps ? "https" : "http";
  const wsProtocol = isHttps ? "wss" : "ws";

  console.log("\n" + "=".repeat(60));
  console.log(`🚀 SERVER STARTED SUCCESSFULLY`);
  console.log("=".repeat(60));
  console.log(`📍 Local:    ${protocol}://localhost:${port}`);
  console.log(`📍 Network:  ${protocol}://${LOCAL_IP}:${port}`);
  console.log(`📡 WebSocket: ${wsProtocol}://${LOCAL_IP}:${port}`);
  console.log(
    `📝 Mode: ${firebaseInitialized ? "Firebase Database" : "Mock Data"}`,
  );
  console.log(`🔒 Protocol: ${isHttps ? "HTTPS (Secure)" : "HTTP"}`);
  console.log(`👥 Registered users: ${userNames.size}`);
  console.log(`🟢 Online users: ${onlineUsers.size}`);
  console.log(`📨 Offline messages: ${offlineMessages.size}`);
  console.log(`🌐 CORS enabled for ${allowedOrigins.length} origins`);
  console.log("\n📌 Available Endpoints:");
  console.log(
    `   GET  ${protocol}://localhost:${port}/api/health - Health check`,
  );
  console.log(`   POST ${protocol}://localhost:${port}/api/login - Login`);
  console.log(
    `   POST ${protocol}://localhost:${port}/api/register - Register`,
  );
  console.log(
    `   GET  ${protocol}://localhost:${port}/api/users - Get all users`,
  );
  console.log(
    `   GET  ${protocol}://localhost:${port}/api/online-users - Get online users`,
  );
  console.log("\n💡 Frontend should connect to:");
  console.log(`   ${protocol}://${LOCAL_IP}:${port}`);
  console.log("\n📞 WebSocket Events:");
  console.log("   register - Register user");
  console.log("   call-user - Initiate video/audio call");
  console.log("   answer-call - Answer incoming call");
  console.log("   ice-candidate - Send ICE candidate");
  console.log("   end-call - End call");
  console.log("   private-message - Send private message");
  console.log("   typing - Typing indicator");
  console.log("   getUsers - Get online users list");
  console.log("=".repeat(60) + "\n");
};

// Start server with error handling
server
  .listen(PORT, HOST, () => {
    logServerStart(PORT);
  })
  .on("error", (error) => {
    if (error.code === "EADDRINUSE") {
      console.error(
        `❌ Port ${PORT} is already in use. Please free the port or use a different one.`,
      );
      console.log(`💡 Try: lsof -i :${PORT} && kill -9 $(lsof -t -i:${PORT})`);
      process.exit(1);
    } else {
      console.error("❌ Server error:", error);
      process.exit(1);
    }
  });

// Graceful shutdown
const shutdown = () => {
  console.log("\n👋 Shutting down gracefully...");

  // Clear intervals
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
  }

  server.close(() => {
    console.log("✅ Server closed");
    process.exit(0);
  });

  // Force close after 10 seconds
  setTimeout(() => {
    console.error("⚠️ Force closing connections...");
    process.exit(1);
  }, 10000);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
