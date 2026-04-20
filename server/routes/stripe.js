import express from "express";
import supabase from "../lib/supabase.js";
import stripe from "../lib/stripe.js";

const router = express.Router();

async function requireAuth(req, res, next) {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!token) return res.status(401).json({ error: "No token" });
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return res.status(401).json({ error: "Unauthorized" });
  req.user = user;
  req.familyId = user.id;
  next();
}

// ── Create checkout session (start subscription) ──────────────────────────────
router.post("/checkout", requireAuth, async (req, res) => {
  try {
    const { data: family } = await supabase
      .from("families").select("stripe_customer_id, family_name").eq("id", req.familyId).single();

    const session = await stripe.checkout.sessions.create({
      customer: family.stripe_customer_id,
      mode: "subscription",
      payment_method_types: ["card"],
      line_items: [{
        price: process.env.STRIPE_PRICE_ID, // your $19/mo price ID from Stripe
        quantity: 1,
      }],
      subscription_data: {
        trial_period_days: 14,
        metadata: { familyId: req.familyId },
      },
      success_url: `https://familycrate.co/app?subscribed=true`,
      cancel_url:  `https://familycrate.co/pricing`,
      metadata: { familyId: req.familyId },
    });

    res.json({ url: session.url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Customer portal (manage/cancel subscription) ──────────────────────────────
router.post("/portal", requireAuth, async (req, res) => {
  try {
    const { data: family } = await supabase
      .from("families").select("stripe_customer_id").eq("id", req.familyId).single();

    const session = await stripe.billingPortal.sessions.create({
      customer: family.stripe_customer_id,
      return_url: "https://familycrate.co/app",
    });

    res.json({ url: session.url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Get subscription status ───────────────────────────────────────────────────
router.get("/status", requireAuth, async (req, res) => {
  try {
    const { data: family } = await supabase
      .from("families")
      .select("subscription_status, trial_ends_at, stripe_customer_id")
      .eq("id", req.familyId).single();

    const trialEnds = family?.trial_ends_at ? new Date(family.trial_ends_at) : null;
    const trialDaysLeft = trialEnds
      ? Math.max(0, Math.ceil((trialEnds - new Date()) / (1000 * 60 * 60 * 24)))
      : 0;

    res.json({
      status: family?.subscription_status || "none",
      trialEnds: family?.trial_ends_at,
      trialDaysLeft,
      isActive: family?.subscription_status === "active",
      isTrialing: family?.subscription_status === "trialing" && trialDaysLeft > 0,
      isExpired: family?.subscription_status === "trialing" && trialDaysLeft === 0,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
