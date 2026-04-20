import express from "express";
import supabase from "../lib/supabase.js";
import stripe from "../lib/stripe.js";

const router = express.Router();

router.post("/stripe", async (req, res) => {
  const sig = req.headers["stripe-signature"];
  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error("Webhook signature failed:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  const data = event.data.object;

  switch (event.type) {

    // Subscription created or updated
    case "customer.subscription.created":
    case "customer.subscription.updated": {
      const familyId = data.metadata?.familyId;
      if (!familyId) break;

      const status = data.status === "active" ? "active"
        : data.status === "trialing" ? "trialing"
        : data.status === "past_due" ? "past_due"
        : "inactive";

      await supabase.from("families").update({
        subscription_status: status,
        stripe_subscription_id: data.id,
        trial_ends_at: data.trial_end
          ? new Date(data.trial_end * 1000).toISOString()
          : null,
      }).eq("id", familyId);

      console.log(`Family ${familyId} subscription → ${status}`);
      break;
    }

    // Subscription cancelled or expired
    case "customer.subscription.deleted": {
      const familyId = data.metadata?.familyId;
      if (!familyId) break;
      await supabase.from("families").update({
        subscription_status: "cancelled",
      }).eq("id", familyId);
      console.log(`Family ${familyId} subscription cancelled`);
      break;
    }

    // Payment succeeded
    case "invoice.payment_succeeded": {
      const customerId = data.customer;
      const { data: family } = await supabase
        .from("families").select("id").eq("stripe_customer_id", customerId).single();
      if (family) {
        await supabase.from("families").update({
          subscription_status: "active",
        }).eq("id", family.id);
      }
      break;
    }

    // Payment failed
    case "invoice.payment_failed": {
      const customerId = data.customer;
      const { data: family } = await supabase
        .from("families").select("id").eq("stripe_customer_id", customerId).single();
      if (family) {
        await supabase.from("families").update({
          subscription_status: "past_due",
        }).eq("id", family.id);
        // TODO: send payment failed email via Resend
      }
      break;
    }

    // Trial ending soon (3 days before)
    case "customer.subscription.trial_will_end": {
      const familyId = data.metadata?.familyId;
      if (familyId) {
        const { data: family } = await supabase
          .from("families").select("owner_email, family_name").eq("id", familyId).single();
        // TODO: send trial ending email
        console.log(`Trial ending soon for ${family?.owner_email}`);
      }
      break;
    }

    default:
      console.log(`Unhandled event: ${event.type}`);
  }

  res.json({ received: true });
});

export default router;
