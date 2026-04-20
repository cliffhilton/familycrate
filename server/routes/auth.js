import express from "express";
import supabase from "../lib/supabase.js";
import stripe from "../lib/stripe.js";

const router = express.Router();

// ── Register a new family ─────────────────────────────────────────────────────
router.post("/register", async (req, res) => {
  try {
    const { email, password, familyName, parentName } = req.body;
    if (!email || !password || !familyName || !parentName) {
      return res.status(400).json({ error: "All fields required" });
    }

    // 1. Create Supabase auth user
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (authError) return res.status(400).json({ error: authError.message });

    const userId = authData.user.id;

    // 2. Create Stripe customer
    const customer = await stripe.customers.create({
      email,
      name: parentName,
      metadata: { familyName, userId },
    });

    // 3. Create family record in DB
    const { error: dbError } = await supabase.from("families").insert({
      id: userId,
      family_name: familyName,
      owner_email: email,
      stripe_customer_id: customer.id,
      subscription_status: "trialing",
      trial_ends_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
    });
    if (dbError) return res.status(500).json({ error: dbError.message });

    // 4. Create initial admin member
    await supabase.from("members").insert({
      family_id: userId,
      name: parentName,
      color: "#8A6A50",
      role: "admin",
      email,
    });

    res.json({ success: true, userId, customerId: customer.id });

  } catch (err) {
    console.error("Register error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── Login ─────────────────────────────────────────────────────────────────────
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return res.status(401).json({ error: error.message });

    // Get family data
    const { data: family } = await supabase
      .from("families")
      .select("*")
      .eq("id", data.user.id)
      .single();

    res.json({
      session: data.session,
      user: data.user,
      family,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Get current session family ────────────────────────────────────────────────
router.get("/me", async (req, res) => {
  try {
    const token = req.headers.authorization?.replace("Bearer ", "");
    if (!token) return res.status(401).json({ error: "No token" });

    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) return res.status(401).json({ error: "Invalid token" });

    const { data: family } = await supabase
      .from("families")
      .select("*")
      .eq("id", user.id)
      .single();

    res.json({ user, family });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Password reset ────────────────────────────────────────────────────────────
router.post("/reset-password", async (req, res) => {
  try {
    const { email } = req.body;
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: "https://familycrate.co/reset",
    });
    if (error) return res.status(400).json({ error: error.message });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
