import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import authRoutes from "./routes/auth.js";
import familyRoutes from "./routes/family.js";
import stripeRoutes from "./routes/stripe.js";
import webhookRoutes from "./routes/webhooks.js";
import notifyRoutes from "./routes/notify.js";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Webhook route needs raw body BEFORE json middleware
app.use("/api/webhooks", express.raw({ type: "application/json" }), webhookRoutes);

// Standard middleware
app.use(cors({
  origin: [
    "https://familycrate.co",
    "https://www.familycrate.co",
    "http://localhost:5173",
    "http://localhost:3000",
  ],
  credentials: true,
}));
app.use(express.json());

// Serve static files from the public folder
app.use(express.static("public"));

// Serve React app static assets (JS, CSS, etc.) from dist/ at /app
app.use("/app", express.static("./dist"));

// Root route — serve landing page
app.get("/", (req, res) => res.sendFile("landing.html", { root: __dirname + "/public" }));

// Page routes
app.get("/register", (req, res) => res.sendFile("register.html", { root: __dirname + "/public" }));
app.get("/login", (req, res) => res.sendFile("login.html", { root: __dirname + "/public" }));
app.get("/subscription", (req, res) => res.sendFile("subscription.html", { root: __dirname + "/public" }));
// Serve React app from /app
app.get("/app", (req, res) => res.sendFile("index.html", { root: __dirname + "/../dist" }));

// Health check
app.get("/health", (req, res) => res.json({ status: "ok", app: "FamilyCrate" }));

// Routes
app.use("/api/auth",   authRoutes);
app.use("/api/family", familyRoutes);
app.use("/api/stripe", stripeRoutes);
app.use("/api/notify", notifyRoutes);

// 404
app.use((req, res) => res.status(404).json({ error: "Not found" }));

// Error handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message || "Server error" });
});

app.listen(PORT, () => console.log(`FamilyCrate server running on port ${PORT}`));
