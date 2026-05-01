import express from "express";
import { google } from "googleapis";
import supabase from "../lib/supabase.js";

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

function getOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    "https://www.familycrate.co/api/google/callback"
  );
}

router.get("/auth", requireAuth, (req, res) => {
  const oauth2 = getOAuth2Client();
  const url = oauth2.generateAuthUrl({
    access_type: "offline",
    scope: ["https://www.googleapis.com/auth/calendar.readonly"],
    state: req.familyId,
    prompt: "consent",
  });
  res.json({ url });
});

router.get("/callback", async (req, res) => {
  const { code, state: familyId } = req.query;
  if (!code || !familyId) return res.redirect("/app?gc=error");
  try {
    const oauth2 = getOAuth2Client();
    const { tokens } = await oauth2.getToken(code);
    await supabase.from("families").update({ google_tokens: tokens }).eq("id", familyId);
    res.redirect("/app?gc=success");
  } catch (err) {
    console.error("Google OAuth error:", err);
    res.redirect("/app?gc=error");
  }
});

router.get("/events", requireAuth, async (req, res) => {
  try {
    const { data: family } = await supabase.from("families").select("google_tokens").eq("id", req.familyId).single();
    if (!family?.google_tokens) return res.json({ connected: false, events: [] });

    const oauth2 = getOAuth2Client();
    oauth2.setCredentials(family.google_tokens);
    oauth2.on("tokens", async (tokens) => {
      if (tokens.refresh_token) {
        await supabase.from("families").update({ google_tokens: { ...family.google_tokens, ...tokens } }).eq("id", req.familyId);
      }
    });

    const calendar = google.calendar({ version: "v3", auth: oauth2 });
    const now = new Date();
    const future = new Date();
    future.setDate(future.getDate() + 30);

    const calList = await calendar.calendarList.list();
    const dailyLife = calList.data.items?.find(c => c.summary?.toLowerCase().includes("daily life"));
    if (!dailyLife) return res.json({ connected: true, events: [], error: "Daily Life calendar not found" });

    const eventsRes = await calendar.events.list({
      calendarId: dailyLife.id,
      timeMin: now.toISOString(),
      timeMax: future.toISOString(),
      singleEvents: true,
      orderBy: "startTime",
      maxResults: 100,
    });

    const tz = eventsRes.data.timeZone || "America/New_York";
    const events = (eventsRes.data.items || []).map(ev => {
      const startDT = ev.start?.dateTime;
      const endDT = ev.end?.dateTime;
      const startDate = ev.start?.date;
      // Use event timezone for display
      const timeStr = startDT ? new Date(startDT).toLocaleTimeString("en-US", {
        hour: "numeric", minute: "2-digit", hour12: true,
        timeZone: ev.start?.timeZone || tz
      }) : "";
      const dateStr = startDT
        ? new Date(startDT).toLocaleDateString("en-CA", { timeZone: ev.start?.timeZone || tz })
        : startDate;
      const duration = startDT && endDT
        ? Math.round((new Date(endDT) - new Date(startDT)) / 60000)
        : 60;
      return {
        id: "gc_" + ev.id,
        title: ev.summary || "Untitled",
        date: dateStr,
        time: timeStr,
        duration,
        color: "#4A90D9",
        memberIds: [],
        repeat: "none",
        type: "google",
        source: "google",
      };
    });

    res.json({ connected: true, events });
  } catch (err) {
    console.error("Google Calendar error:", err);
    res.status(500).json({ error: err.message });
  }
});

router.delete("/disconnect", requireAuth, async (req, res) => {
  await supabase.from("families").update({ google_tokens: null }).eq("id", req.familyId);
  res.json({ success: true });
});

export default router;
