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

    // Validate coupon if provided
    let discounts = [];
    const couponCode = req.body.couponCode?.trim().toUpperCase();
    if (couponCode) {
      const { data: coupon } = await supabase
        .from("coupons")
        .select("*")
        .eq("code", couponCode)
        .eq("active", true)
        .single();
      if (coupon && (coupon.max_uses === null || coupon.uses < coupon.max_uses)) {
        // Create a Stripe coupon on the fly
        const stripeCoupon = await stripe.coupons.create({
          percent_off: coupon.discount_percent,
          duration: "once",
          name: couponCode,
        });
        discounts = [{ coupon: stripeCoupon.id }];
        // Increment usage
        await supabase.from("coupons").update({ uses: coupon.uses + 1 }).eq("id", coupon.id);
      }
    }

    const session = await stripe.checkout.sessions.create({
      customer: family.stripe_customer_id,
      mode: "subscription",
      payment_method_types: ["card"],
      line_items: [{
        price: req.body.plan === "yearly"
          ? process.env.STRIPE_PRICE_ID_YEARLY
          : process.env.STRIPE_PRICE_ID,
        quantity: 1,
      }],
      subscription_data: {
        trial_period_days: 14,
        metadata: { familyId: req.familyId },
      },
      ...(discounts.length > 0 && { discounts }),
      success_url: `https://www.familycrate.co/app/?subscribed=true`,
      cancel_url:  `https://www.familycrate.co/subscription.html`,
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


// ── Validate coupon code ──────────────────────────────────────────────────────
router.post("/validate-coupon", requireAuth, async (req, res) => {
  try {
    const code = req.body.couponCode?.trim().toUpperCase();
    if (!code) return res.json({ valid: false });
    const { data: coupon, error } = await supabase
      .from("coupons").select("*").eq("code", code).eq("active", true).maybeSingle();
    if (error) { console.error("Coupon lookup error:", error); return res.json({ valid: false }); }
    if (coupon && (coupon.max_uses === null || coupon.uses < coupon.max_uses)) {
      return res.json({ valid: true, discount: coupon.discount_percent });
    }
    res.json({ valid: false });
  } catch (err) {
    console.error("Validate coupon error:", err);
    res.json({ valid: false });
  }
});
export default router;
