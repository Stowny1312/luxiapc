const { verifyWebhook } = require("../lib/stripe");
const { detailsCard, luxiaEmail, paragraph } = require("../lib/luxia-email");

const SUPABASE_URL = process.env.SUPABASE_URL || "https://tapvkveybfotgskqjeof.supabase.co";

module.exports.config = { api: { bodyParser: false } };

async function rawBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

function reply(response, status, payload) {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json");
  response.end(JSON.stringify(payload));
}

async function serviceRpc(name, body) {
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "");
  if (!key) throw new Error("Supabase server credentials are missing.");
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: { apikey: key, "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error(`Database payment update failed (${response.status}).`);
  return response.json();
}

async function notifyOwner(bookingId) {
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "");
  const resendKey = String(process.env.RESEND_API_KEY || "");
  if (!key || !resendKey) return;
  const result = await fetch(`${SUPABASE_URL}/rest/v1/bookings?id=eq.${encodeURIComponent(bookingId)}&select=id,starts_at,client_name,client_email,client_phone,preferred_contact,client_message,payment_amount_cents,payment_currency`, {
    headers: { apikey: key }
  });
  const booking = (await result.json())[0];
  if (!result.ok || !booking) return;
  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json", "Idempotency-Key": `paid-booking-owner/${booking.id}` },
    body: JSON.stringify({
      from: process.env.CONTACT_FROM_EMAIL || "Luxia P&C <onboarding@resend.dev>",
      to: "tonkata.stoev@gmail.com",
      reply_to: booking.client_email,
      subject: "New paid Luxia coaching booking",
      text: `A coaching payment was received.\nClient: ${booking.client_name}\nEmail: ${booking.client_email}\nStarts: ${booking.starts_at}\nBooking: ${booking.id}`,
      html: luxiaEmail({
        eyebrow: "Paid booking",
        title: "A coaching payment was received",
        intro: "The payment was verified by Stripe and the booking is now confirmed.",
        content: detailsCard([["Client", booking.client_name], ["Email", booking.client_email], ["Phone", booking.client_phone], ["Starts", new Date(booking.starts_at).toLocaleString("en-GB", { timeZone: "Europe/Brussels" })], ["Amount", `€${(booking.payment_amount_cents / 100).toFixed(2)}`], ["Booking ID", booking.id]]) + paragraph("The booking is ready for the normal confirmation and private-session workflow.")
      })
    })
  });
}

module.exports = async function handler(request, response) {
  if (request.method !== "POST") return reply(response, 405, { error: "Method not allowed." });
  let event;
  try { event = verifyWebhook(await rawBody(request), request.headers["stripe-signature"]); }
  catch (error) { return reply(response, 400, { error: error.message }); }

  const session = event.data?.object || {};
  const bookingId = String(session.metadata?.booking_id || session.client_reference_id || "");
  try {
    if (event.type === "checkout.session.completed" && session.payment_status === "paid" && bookingId) {
      await serviceRpc("complete_booking_payment", {
        p_booking_id: bookingId, p_checkout_session_id: session.id,
        p_payment_intent_id: String(session.payment_intent || ""),
        p_amount_cents: Number(session.amount_total), p_currency: String(session.currency || "eur")
      });
      await notifyOwner(bookingId);
    } else if (event.type === "checkout.session.expired" && bookingId) {
      await serviceRpc("expire_booking_payment", { p_booking_id: bookingId, p_checkout_session_id: session.id });
    }
  } catch (error) {
    console.error("Stripe webhook processing failed", event.id, error.message);
    return reply(response, 500, { error: "Webhook processing failed." });
  }
  return reply(response, 200, { received: true });
};
