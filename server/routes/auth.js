import express from "express";
import supabase from "../lib/supabase.js";
import stripe from "../lib/stripe.js";
import { Resend } from "resend";
const resend = new Resend(process.env.RESEND_API_KEY);

const router = express.Router();

// ── Register a new family ─────────────────────────────────────────────────────
router.post("/register", async (req, res) => {
  try {
    const { email, password, familyName, parentName, familyEmail, members: extraMembers } = req.body;
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
    console.log("Register: userId =", userId, "email =", email);

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
      family_email: familyEmail||null,
      stripe_customer_id: customer.id,
      subscription_status: "trialing",
      trial_ends_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
    });
    if (dbError) return res.status(500).json({ error: dbError.message });

    // 4. Create all family members from onboarding (includes parent)
    const membersToInsert = extraMembers?.length
      ? extraMembers.map((m, i) => ({
          family_id: userId,
          name: m.name,
          color: m.color || "#8A6A50",
          role: i === 0 ? "admin" : (m.role || "member"),
          email: m.email || null,
        }))
      : [{ family_id: userId, name: parentName, color: "#8A6A50", role: "admin", email }];
    await supabase.from("members").insert(membersToInsert);

    // Send welcome email (non-blocking)
    resend.emails.send({
      from: "Cliff at FamilyCrate <cliff@familycrate.co>",
      to: email,
      subject: `Welcome to FamilyCrate, ${familyName}! 🏡`,
      html: `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/></head>
<body style="margin:0;padding:0;background:#F0F4F8;font-family:Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F0F4F8;padding:40px 20px;">
    <tr><td align="center">
      <table width="100%" style="max-width:520px;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(26,42,56,.08);">
        <tr>
          <td style="background:#fff;padding:28px 40px;text-align:center;border-bottom:1px solid #D8E4EE;">
            <img src="https://btoklvfwjvtzzluiqjcz.supabase.co/storage/v1/object/public/images/FC-EMAIL-LOGO.png" width="180" alt="FamilyCrate" style="display:block;margin:0 auto;"/>
          </td>
        </tr>
        <tr>
          <td style="padding:36px 40px;">
            <h2 style="color:#1A2A38;margin:0 0 12px;font-size:22px;">Welcome, ${parentName}! 👋</h2>
            <p style="color:#344F62;line-height:1.75;margin:0 0 16px;">You've set up <strong>${familyName}</strong> on FamilyCrate. Your 14-day free trial starts today — no credit card needed yet.</p>
            <div style="background:#E0EEF6;border-left:4px solid #3A6A88;padding:16px 20px;border-radius:8px;margin:0 0 20px;">
              <p style="color:#1A2A38;font-weight:600;margin:0 0 10px;">Get started in 4 steps:</p>
              <ol style="color:#344F62;line-height:2;margin:0;padding-left:18px;font-size:14px;">
                <li>Set your Parent PIN in Settings</li>
                <li>Add chores with point values</li>
                <li>Set up your Rewards Store</li>
                <li>Watch your kids get competitive 😄</li>
              </ol>
            </div>
            <a href="https://www.familycrate.co/app" style="display:inline-block;background:#3A6A88;color:#fff;padding:13px 28px;border-radius:100px;text-decoration:none;font-weight:500;font-size:15px;">Open FamilyCrate →</a>
            <p style="color:#344F62;margin-top:24px;font-size:14px;">Questions? Just reply to this email — I read every one personally.</p>
            <p style="color:#344F62;margin-top:20px;border-top:1px solid #D8E4EE;padding-top:20px;">— Cliff<br/><span style="color:#7A96A8;font-size:12px;">Founder, FamilyCrate</span></p>
          </td>
        </tr>
        <tr>
          <td style="background:#F0F4F8;padding:24px 40px;border-top:1px solid #D8E4EE;text-align:center;">
            <p style="margin:0 0 8px;font-size:12px;color:#7A96A8;">FamilyCrate · familycrate.co</p>
            <p style="margin:0;font-size:11px;color:#A0B8C8;">You're receiving this because you signed up for FamilyCrate.</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`,
    }).catch(err => console.error("Welcome email failed:", err));

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

// ── Refresh token ─────────────────────────────────────────────────────────────
router.post("/refresh", async (req, res) => {
  try {
    const { refresh_token } = req.body;
    if (!refresh_token) return res.status(400).json({ error: "No refresh token" });
    const { data, error } = await supabase.auth.refreshSession({ refresh_token });
    if (error || !data?.session) return res.status(401).json({ error: "Could not refresh" });
    res.json({
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
