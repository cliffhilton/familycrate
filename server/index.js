import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import authRoutes from "./routes/auth.js";
import familyRoutes from "./routes/family.js";
import stripeRoutes from "./routes/stripe.js";
import webhookRoutes from "./routes/webhooks.js";
import notifyRoutes from "./routes/notify.js";

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

// Root route — serve landing page
app.get("/", (req, res) => res.sendFile("public/landing.html"));

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
