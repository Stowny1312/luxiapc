const { stripeRequest } = require("../lib/stripe");
const SUPABASE_URL = process.env.SUPABASE_URL || "https://tapvkveybfotgskqjeof.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || "sb_publishable__BsA8Xl7RTgowZRkw5cjSQ_K-2FaQt5";

module.exports = async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Type", "application/json");
  if (request.method !== "GET") { response.statusCode = 405; return response.end(JSON.stringify({ error: "Method not allowed." })); }
  const authorization = String(request.headers.authorization || "");
  const sessionId = String(request.query?.session_id || "");
  if (!authorization.startsWith("Bearer ") || !/^cs_(test|live)_/.test(sessionId)) { response.statusCode = 400; return response.end(JSON.stringify({ error: "Invalid payment request." })); }
  try {
    const session = await stripeRequest(`/checkout/sessions/${encodeURIComponent(sessionId)}`);
    const bookingId = String(session.metadata?.booking_id || session.client_reference_id || "");
    const bookingResponse = await fetch(`${SUPABASE_URL}/rest/v1/bookings?id=eq.${encodeURIComponent(bookingId)}&select=id,status,payment_status,payment_amount_cents,payment_currency`, { headers: { apikey: SUPABASE_KEY, Authorization: authorization } });
    const bookings = await bookingResponse.json();
    if (!bookingResponse.ok || !bookings[0]) throw new Error("Payment details are unavailable.");
    response.statusCode = 200;
    response.end(JSON.stringify({ ok: true, booking: bookings[0], stripePaymentStatus: session.payment_status }));
  } catch (error) {
    response.statusCode = 404;
    response.end(JSON.stringify({ error: error.message || "Payment details are unavailable." }));
  }
};
