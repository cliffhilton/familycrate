import cron from "node-cron";
import { Resend } from "resend";
import supabase from "./lib/supabase.js";

const resend = new Resend(process.env.RESEND_API_KEY);

// ── Branded email wrapper ─────────────────────────────────────────────────────
const branded = (content) => `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/></head>
<body style="margin:0;padding:0;background:#F0F4F8;font-family:'DM Sans',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F0F4F8;padding:40px 20px;">
    <tr><td align="center">
      <table width="100%" style="max-width:520px;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(26,42,56,.08);">
        
        <!-- Header -->
        <tr>
          <td style="background:#fff;padding:28px 40px;text-align:center;border-bottom:1px solid #D8E4EE;">
            <img src="https://btoklvfwjvtzzluiqjcz.supabase.co/storage/v1/object/public/images/FC-EMAIL-LOGO.png" width="180" alt="FamilyCrate" style="display:block;margin:0 auto;"/>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="padding:36px 40px;">
            ${content}
          </td>
        </tr>

        <!-- Footer -->
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
</html>`;

// ── Email content ─────────────────────────────────────────────────────────────
const btn = (text, url, color="#3A6A88") =>
  `<a href="${url}" style="display:inline-block;background:${color};color:#fff;padding:13px 28px;border-radius:100px;text-decoration:none;font-weight:500;font-size:15px;margin-top:16px;">${text}</a>`;

const tip = (title, body) =>
  `<div style="background:#E0EEF6;border-left:4px solid #3A6A88;padding:16px 20px;border-radius:8px;margin:20px 0;">
    <p style="color:#1A2A38;font-weight:600;margin:0 0 6px;">${title}</p>
    <p style="color:#344F62;margin:0;font-size:14px;line-height:1.6;">${body}</p>
  </div>`;

const sig = `<p style="color:#344F62;margin-top:28px;border-top:1px solid #D8E4EE;padding-top:20px;">— Cliff<br/><span style="color:#7A96A8;font-size:12px;">Founder, FamilyCrate</span></p>`;

const EMAILS = {
  day3: {
    subject: "Quick tip for your first week 💡",
    html: (name, familyName) => branded(`
      <h2 style="color:#1A2A38;margin:0 0 12px;font-size:22px;">Hey ${name} — how's it going?</h2>
      <p style="color:#344F62;line-height:1.75;margin:0 0 8px;">You've had FamilyCrate for a few days. Here's the one thing that makes the biggest difference early on:</p>
      ${tip("Set up your Rewards Store first.", "Kids engage way more with chores when they know what they're working toward. Even a few simple rewards — movie night, stay up late, pick dinner — is enough to get them hooked.")}
      <p style="color:#344F62;line-height:1.75;">Once rewards are in place, add 3–5 recurring chores with point values. Start small. You can always add more.</p>
      ${btn("Open FamilyCrate →", "https://www.familycrate.co/app")}
      <p style="color:#344F62;margin-top:20px;font-size:14px;">Reply anytime — I'm here.</p>
      ${sig}
    `),
  },
  day10: {
    subject: "4 days left in your trial ⏳",
    html: (name, familyName) => branded(`
      <h2 style="color:#1A2A38;margin:0 0 12px;font-size:22px;">Your trial ends in 4 days, ${name}.</h2>
      <p style="color:#344F62;line-height:1.75;">If FamilyCrate has been working — chores getting done, less nagging, kids actually engaged — this is a good time to lock in your plan.</p>
      <div style="background:#FDF5DC;border:1.5px solid #EDD898;border-radius:12px;padding:20px 24px;margin:20px 0;">
        <p style="margin:0 0 4px;font-size:13px;color:#C49A3C;font-weight:600;text-transform:uppercase;letter-spacing:.5px;">Your options</p>
        <p style="margin:0;color:#1A2A38;font-size:15px;"><strong>Monthly</strong> — $19/mo &nbsp;·&nbsp; <strong>Yearly</strong> — $190/yr <span style="color:#3A9A5A;font-size:13px;">(save 2 months)</span></p>
      </div>
      <p style="color:#344F62;line-height:1.75;font-size:14px;">No contracts. Cancel anytime.</p>
      ${btn("Lock in my plan →", "https://www.familycrate.co/subscription")}
      <p style="color:#344F62;margin-top:16px;font-size:13px;color:#7A96A8;">Not ready? No pressure — nothing charges automatically.</p>
      ${sig}
    `),
  },
  day30: {
    subject: "One month in — honest question.",
    html: (name, familyName) => branded(`
      <h2 style="color:#1A2A38;margin:0 0 12px;font-size:22px;">One month in.</h2>
      <p style="color:#344F62;line-height:1.75;">Hey ${name} — the ${familyName} has been on FamilyCrate for about a month now. I'd genuinely love to know how it's going.</p>
      <p style="color:#344F62;line-height:1.75;">What's working well? What's missing? What would make it 10x better for your family?</p>
      <p style="color:#344F62;line-height:1.75;">Just hit reply. I read every response personally — and it directly shapes what we build next.</p>
      ${sig}
    `),
  },
  day37: {
    subject: "One small ask ⭐",
    html: (name, familyName) => branded(`
      <h2 style="color:#1A2A38;margin:0 0 12px;font-size:22px;">One small ask, ${name}.</h2>
      <p style="color:#344F62;line-height:1.75;">FamilyCrate is a small, family-built app. We don't have a big marketing budget — we grow because families like yours tell other families.</p>
      <p style="color:#344F62;line-height:1.75;">If FamilyCrate has made your home run a little smoother, would you take 60 seconds to leave a quick Google review? It makes a huge difference for us.</p>
      ${btn("Leave a review ⭐", "https://www.familycrate.co", "#C49A3C")}
      <p style="color:#344F62;margin-top:20px;font-size:14px;">And as always — reply anytime. We're listening.</p>
      ${sig}
    `),
  },
};

// ── Scheduler ─────────────────────────────────────────────────────────────────
async function sendScheduledEmails() {
  try {
    const now = new Date();
    const { data: families } = await supabase
      .from("families")
      .select("id, owner_email, family_name, created_at")
      .not("owner_email", "is", null);

    if (!families?.length) return;

    const { data: sentLogs } = await supabase
      .from("email_log")
      .select("family_id, email_type");

    const sent = new Set(sentLogs?.map(l => `${l.family_id}:${l.email_type}`) || []);

    for (const family of families) {
      const daysSince = Math.floor((now - new Date(family.created_at)) / (1000 * 60 * 60 * 24));
      const parentName = family.family_name?.split(" ")[0] || "there";

      for (const [type, daysNeeded] of [["day3",3],["day10",10],["day30",30],["day37",37]]) {
        const key = `${family.id}:${type}`;
        if (daysSince >= daysNeeded && !sent.has(key)) {
          const email = EMAILS[type];
          try {
            await resend.emails.send({
              from: "Cliff at FamilyCrate <cliff@familycrate.co>",
              to: family.owner_email,
              subject: email.subject,
              html: email.html(parentName, family.family_name),
            });
            await supabase.from("email_log").insert({ family_id: family.id, email_type: type });
            console.log(`Sent ${type} to ${family.owner_email}`);
          } catch (err) {
            console.error(`Failed ${type} to ${family.owner_email}:`, err);
          }
        }
      }
    }
  } catch (err) {
    console.error("Email scheduler error:", err);
  }
}

export function startEmailScheduler() {
  console.log("Email scheduler started");
  sendScheduledEmails();
  cron.schedule("0 9 * * *", sendScheduledEmails);
}
