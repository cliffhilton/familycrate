import express from "express";
import supabase from "../lib/supabase.js";

const router = express.Router();

// ── Auth middleware ───────────────────────────────────────────────────────────
async function requireAuth(req, res, next) {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!token) return res.status(401).json({ error: "No token" });
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return res.status(401).json({ error: "Unauthorized" });
  req.user = user;
  req.familyId = user.id;
  next();
}

// ── Check subscription ────────────────────────────────────────────────────────
async function requireSubscription(req, res, next) {
  const { data: family } = await supabase
    .from("families").select("subscription_status, trial_ends_at").eq("id", req.familyId).single();

  const active = family?.subscription_status === "active";
  const trialing = family?.subscription_status === "trialing" &&
    new Date(family.trial_ends_at) > new Date();

  if (!active && !trialing) {
    return res.status(402).json({ error: "Subscription required", code: "SUBSCRIPTION_REQUIRED" });
  }
  next();
}

const auth = [requireAuth, requireSubscription];

// ── GET all family data ───────────────────────────────────────────────────────
router.get("/", requireAuth, async (req, res) => {
  try {
    const fid = req.familyId;
    const [members, items, events, rewards, doneLog, redeemReqs, settings] = await Promise.all([
      supabase.from("members").select("*").eq("family_id", fid).order("sort_order"),
      supabase.from("items").select("*").eq("family_id", fid),
      supabase.from("events").select("*").eq("family_id", fid),
      supabase.from("rewards").select("*").eq("family_id", fid),
      supabase.from("done_log").select("*").eq("family_id", fid),
      supabase.from("redeem_requests").select("*").eq("family_id", fid).neq("status", "declined"),
      supabase.from("families").select("rate, period_start, period_days, spent_points, categories").eq("id", fid).single(),
    ]);

    res.json({
      members: members.data || [],
      items: items.data || [],
      events: events.data || [],
      rewards: rewards.data || [],
      doneLog: (doneLog.data || []).reduce((acc, r) => { acc[r.key] = r.done; return acc; }, {}),
      redeemReqs: redeemReqs.data || [],
      rate: settings.data?.rate || 0.25,
      periodStart: settings.data?.period_start,
      periodDays: settings.data?.period_days || 14,
      spentPoints: settings.data?.spent_points || {},
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Members ───────────────────────────────────────────────────────────────────
router.post("/members", auth, async (req, res) => {
  const { data, error } = await supabase.from("members")
    .insert({ ...req.body, family_id: req.familyId }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.put("/members/:id", auth, async (req, res) => {
  const { data, error } = await supabase.from("members")
    .update(req.body).eq("id", req.params.id).eq("family_id", req.familyId).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.delete("/members/:id", auth, async (req, res) => {
  await supabase.from("members").delete().eq("id", req.params.id).eq("family_id", req.familyId);
  res.json({ success: true });
});

// ── Items (chores/groceries/todos) ────────────────────────────────────────────
router.post("/items", auth, async (req, res) => {
  const { data, error } = await supabase.from("items")
    .insert({ ...req.body, family_id: req.familyId }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.put("/items/:id", auth, async (req, res) => {
  const { data, error } = await supabase.from("items")
    .update(req.body).eq("id", req.params.id).eq("family_id", req.familyId).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.delete("/items/:id", auth, async (req, res) => {
  await supabase.from("items").delete().eq("id", req.params.id).eq("family_id", req.familyId);
  res.json({ success: true });
});

// ── Events ────────────────────────────────────────────────────────────────────
router.post("/events", auth, async (req, res) => {
  const { data, error } = await supabase.from("events")
    .insert({ ...req.body, family_id: req.familyId }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.put("/events/:id", auth, async (req, res) => {
  const { data, error } = await supabase.from("events")
    .update(req.body).eq("id", req.params.id).eq("family_id", req.familyId).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.delete("/events/:id", auth, async (req, res) => {
  await supabase.from("events").delete().eq("id", req.params.id).eq("family_id", req.familyId);
  res.json({ success: true });
});

// ── Done log (checkmarks) ─────────────────────────────────────────────────────
router.post("/done", auth, async (req, res) => {
  const { key, done } = req.body;
  const { data, error } = await supabase.from("done_log")
    .upsert({ family_id: req.familyId, key, done }, { onConflict: "family_id,key" })
    .select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// ── Rewards ───────────────────────────────────────────────────────────────────
router.post("/rewards", auth, async (req, res) => {
  const { data, error } = await supabase.from("rewards")
    .insert({ ...req.body, family_id: req.familyId }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.put("/rewards/:id", auth, async (req, res) => {
  const { data, error } = await supabase.from("rewards")
    .update(req.body).eq("id", req.params.id).eq("family_id", req.familyId).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.delete("/rewards/:id", auth, async (req, res) => {
  await supabase.from("rewards").delete().eq("id", req.params.id).eq("family_id", req.familyId);
  res.json({ success: true });
});

// ── Redeem requests ───────────────────────────────────────────────────────────
router.post("/redeem", auth, async (req, res) => {
  const { data, error } = await supabase.from("redeem_requests")
    .insert({ ...req.body, family_id: req.familyId, status: "pending" }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.put("/redeem/:id/approve", auth, async (req, res) => {
  const { data: req_ } = await supabase.from("redeem_requests")
    .select("*, rewards(points)").eq("id", req.params.id).single();
  if (!req_) return res.status(404).json({ error: "Request not found" });

  // Update request status
  await supabase.from("redeem_requests").update({ status: "approved" }).eq("id", req.params.id);

  // Deduct spent points from family settings
  const { data: family } = await supabase.from("families")
    .select("spent_points").eq("id", req.familyId).single();
  const spent = family?.spent_points || {};
  spent[req_.member_id] = (spent[req_.member_id] || 0) + (req_.rewards?.points || req_.points || 0);
  await supabase.from("families").update({ spent_points: spent }).eq("id", req.familyId);

  res.json({ success: true });
});

router.put("/redeem/:id/decline", auth, async (req, res) => {
  await supabase.from("redeem_requests").update({ status: "declined" }).eq("id", req.params.id);
  res.json({ success: true });
});

// ── Family settings ───────────────────────────────────────────────────────────
router.put("/settings", auth, async (req, res) => {
  const allowed = ["rate", "period_start", "period_days", "spent_points", "categories"];
  const update = {};
  allowed.forEach(k => { if (req.body[k] !== undefined) update[k] = req.body[k]; });
  const { error } = await supabase.from("families").update(update).eq("id", req.familyId);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

export default router;
