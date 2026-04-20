import express from "express";
import { Resend } from "resend";
import supabase from "../lib/supabase.js";

const router = express.Router();
const resend = new Resend(process.env.RESEND_API_KEY);

async function requireAuth(req, res, next) {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!token) return res.status(401).json({ error: "No token" });
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return res.status(401).json({ error: "Unauthorized" });
  req.user = user; req.familyId = user.id; next();
}

// ── Send chore reminder ───────────────────────────────────────────────────────
router.post("/chore-reminder", requireAuth, async (req, res) => {
  try {
    const { memberId, choreName } = req.body;
    const { data: member } = await supabase
      .from("members").select("name, email").eq("id", memberId).single();
    if (!member?.email) return res.json({ skipped: true, reason: "No email" });

    await resend.emails.send({
      from: "FamilyCrate <hello@familycrate.co>",
      to: member.email,
      subject: `Reminder: ${choreName}`,
      html: `
        <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px;">
          <img src="https://familycrate.co/logo.png" height="32" alt="FamilyCrate"/>
          <h2 style="color:#1A2A38;margin-top:20px;">Hey ${member.name}! 👋</h2>
          <p style="color:#344F62;">Don't forget — you have a chore waiting:</p>
          <div style="background:#F0F4F8;border-radius:12px;padding:16px 20px;margin:16px 0;">
            <strong style="color:#1A2A38;font-size:16px;">${choreName}</strong>
          </div>
          <p style="color:#344F62;">Check it off in FamilyCrate to earn your points! 🏆</p>
          <a href="https://familycrate.co/app" style="display:inline-block;background:#3A6A88;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:500;margin-top:8px;">Open FamilyCrate</a>
          <p style="color:#7A96A8;font-size:12px;margin-top:24px;">FamilyCrate · familycrate.co</p>
        </div>
      `,
    });

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Send reward approved notification ─────────────────────────────────────────
router.post("/reward-approved", requireAuth, async (req, res) => {
  try {
    const { memberId, rewardTitle, rewardIcon } = req.body;
    const { data: member } = await supabase
      .from("members").select("name, email").eq("id", memberId).single();
    if (!member?.email) return res.json({ skipped: true, reason: "No email" });

    await resend.emails.send({
      from: "FamilyCrate <hello@familycrate.co>",
      to: member.email,
      subject: `Your reward was approved! ${rewardIcon}`,
      html: `
        <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px;">
          <img src="https://familycrate.co/logo.png" height="32" alt="FamilyCrate"/>
          <h2 style="color:#1A2A38;margin-top:20px;">Great news, ${member.name}! 🎉</h2>
          <p style="color:#344F62;">Your reward request was approved:</p>
          <div style="background:#FDF5DC;border:2px solid #EDD898;border-radius:12px;padding:16px 20px;margin:16px 0;text-align:center;">
            <div style="font-size:32px;margin-bottom:8px;">${rewardIcon}</div>
            <strong style="color:#1A2A38;font-size:16px;">${rewardTitle}</strong>
          </div>
          <p style="color:#344F62;">Go enjoy it — you earned it! Keep checking off those chores. 💪</p>
          <a href="https://familycrate.co/app" style="display:inline-block;background:#3A6A88;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:500;margin-top:8px;">Open FamilyCrate</a>
          <p style="color:#7A96A8;font-size:12px;margin-top:24px;">FamilyCrate · familycrate.co</p>
        </div>
      `,
    });

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Welcome email (sent after registration) ───────────────────────────────────
router.post("/welcome", async (req, res) => {
  try {
    const { email, parentName, familyName } = req.body;

    await resend.emails.send({
      from: "Cliff at FamilyCrate <cliff@familycrate.co>",
      to: email,
      subject: `Welcome to FamilyCrate, ${familyName}! 🏡`,
      html: `
        <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px;">
          <img src="https://familycrate.co/logo.png" height="32" alt="FamilyCrate"/>
          <h2 style="color:#1A2A38;margin-top:20px;">Welcome, ${parentName}! 👋</h2>
          <p style="color:#344F62;">You've set up <strong>${familyName}</strong> on FamilyCrate. Your 14-day free trial starts today — no credit card needed yet.</p>
          <h3 style="color:#1A2A38;">Getting started:</h3>
          <ol style="color:#344F62;line-height:2;">
            <li>Add your family members in Settings</li>
            <li>Set up your chores and schedule</li>
            <li>Set your points-to-dollars rate</li>
            <li>Watch your kids get competitive 😄</li>
          </ol>
          <a href="https://familycrate.co/app" style="display:inline-block;background:#3A6A88;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:500;margin-top:8px;">Open FamilyCrate</a>
          <p style="color:#344F62;margin-top:20px;">Questions? Just reply to this email — I read every one.</p>
          <p style="color:#344F62;">— Cliff<br/><span style="color:#7A96A8;font-size:12px;">Founder, FamilyCrate</span></p>
        </div>
      `,
    });

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
