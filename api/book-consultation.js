const OWNER_EMAIL = "tonkata.stoev@gmail.com";
const SUPABASE_URL = process.env.SUPABASE_URL || "https://tapvkveybfotgskqjeof.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || "sb_publishable__BsA8Xl7RTgowZRkw5cjSQ_K-2FaQt5";
const { actionButton, detailsCard, escapeHtml, luxiaEmail, paragraph } = require("../lib/luxia-email");
const { stripeRequest } = require("../lib/stripe");

function sendJson(response, statusCode, payload) {
  response.statusCode = statusCode;
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Type", "application/json");
  response.end(JSON.stringify(payload));
}

function bookingLabel(sessionType) {
  return sessionType === "coaching" ? "1 hour coaching" : "20 minute consultation";
}

function confirmationUrl(request, bookingId) {
  const forwardedHost = String(request.headers["x-forwarded-host"] || request.headers.host || "dev.luxiapc.com");
  const forwardedProtocol = String(request.headers["x-forwarded-proto"] || "https");
  const origin = process.env.PUBLIC_SITE_URL || `${forwardedProtocol}://${forwardedHost}`;
  return `${origin.replace(/\/$/, "")}/prototypes/vibrant-premium/pages/administration.html?booking=${encodeURIComponent(bookingId)}`;
}

function formatBrusselsDate(value) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Brussels",
    dateStyle: "full",
    timeStyle: "short"
  }).format(new Date(value));
}

async function readJson(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (error) {
    return text;
  }
}

module.exports = async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    sendJson(response, 405, { error: "Method not allowed." });
    return;
  }

  const authorization = String(request.headers.authorization || "");
  if (!authorization.startsWith("Bearer ") || authorization.length <= 7) {
    sendJson(response, 401, { error: "Please log in before booking." });
    return;
  }

  let payload;
  try {
    payload = typeof request.body === "string" ? JSON.parse(request.body) : request.body;
  } catch (error) {
    sendJson(response, 400, { error: "Invalid booking payload." });
    return;
  }

  const slotId = String((payload && payload.slotId) || "").trim();
  const preferredContact = String((payload && payload.preferredContact) || "email").trim().toLowerCase();
  const phone = String((payload && payload.phone) || "").trim();
  const message = String((payload && payload.message) || "").trim();

  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(slotId)) {
    sendJson(response, 400, { error: "Please select a valid available time." });
    return;
  }
  if (!["email", "phone"].includes(preferredContact) || phone.length > 30 || message.length > 5000) {
    sendJson(response, 400, { error: "Please check your booking details." });
    return;
  }

  const supabaseHeaders = {
    apikey: SUPABASE_PUBLISHABLE_KEY,
    Authorization: authorization,
    "Content-Type": "application/json"
  };
  let rpcResponse;
  try {
    rpcResponse = await fetch(`${SUPABASE_URL}/rest/v1/rpc/book_consultation_slot`, {
      method: "POST",
      headers: supabaseHeaders,
      body: JSON.stringify({
        p_slot_id: slotId,
        p_preferred_contact: preferredContact,
        p_phone: phone || null,
        p_message: message || null
      })
    });
  } catch (error) {
    sendJson(response, 502, { error: "The booking service is temporarily unavailable." });
    return;
  }
  const rpcResult = await readJson(rpcResponse);

  if (!rpcResponse.ok) {
    sendJson(response, rpcResponse.status === 401 ? 401 : 409, {
      error: (rpcResult && rpcResult.message) || "This booking could not be completed."
    });
    return;
  }

  const bookingId = typeof rpcResult === "string" ? rpcResult : String(rpcResult || "").replace(/^"|"$/g, "");
  let bookingResponse;
  let bookings;
  try {
    bookingResponse = await fetch(
      `${SUPABASE_URL}/rest/v1/bookings?id=eq.${encodeURIComponent(bookingId)}&select=id,session_type,starts_at,ends_at,client_name,client_email,client_phone,preferred_contact,client_message,status`,
      { headers: supabaseHeaders }
    );
    bookings = await readJson(bookingResponse);
  } catch (error) {
    console.error("Booking confirmed but owner notification lookup failed.", bookingId);
    sendJson(response, 201, { ok: true, bookingId, notificationSent: false });
    return;
  }
  const booking = Array.isArray(bookings) ? bookings[0] : null;
  if (bookingResponse.ok && booking && booking.session_type === "coaching") {
    const serviceKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
    if (!serviceKey) {
      sendJson(response, 503, { error: "Secure payment is not configured yet." });
      return;
    }
    const serviceHeaders = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" };
    const amount = Number(process.env.COACHING_PRICE_CENTS || 100);
    const origin = String(process.env.PUBLIC_SITE_URL || `https://${request.headers["x-forwarded-host"] || request.headers.host || "dev.luxiapc.com"}`).replace(/\/$/, "");
    const expiresAt = Math.floor(Date.now() / 1000) + 30 * 60;
    try {
      if (!Number.isInteger(amount) || amount < 50) throw new Error("Payment is not configured yet.");
      const session = await stripeRequest("/checkout/sessions", { method: "POST", body: {
        mode: "payment",
        "line_items[0][quantity]": "1",
        "line_items[0][price_data][currency]": "eur",
        "line_items[0][price_data][unit_amount]": String(amount),
        "line_items[0][price_data][product_data][name]": "Luxia P&C — 1-hour coaching session",
        customer_email: booking.client_email,
        client_reference_id: bookingId,
        "metadata[booking_id]": bookingId,
        "payment_intent_data[metadata][booking_id]": bookingId,
        expires_at: String(expiresAt),
        success_url: `${origin}/prototypes/vibrant-premium/pages/payment.html?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${origin}/prototypes/vibrant-premium/pages/payment.html?cancelled=1&booking=${encodeURIComponent(bookingId)}`
      }});
      const attachResponse = await fetch(`${SUPABASE_URL}/rest/v1/rpc/attach_booking_checkout`, {
        method: "POST", headers: serviceHeaders,
        body: JSON.stringify({ p_booking_id: bookingId, p_checkout_session_id: session.id, p_amount_cents: amount, p_currency: "eur", p_expires_at: new Date(expiresAt * 1000).toISOString() })
      });
      const attached = await readJson(attachResponse);
      if (!attachResponse.ok || attached !== true) throw new Error("The payment could not be attached to the booking.");
      sendJson(response, 201, { ok: true, bookingId, paymentRequired: true, checkoutUrl: session.url });
      return;
    } catch (error) {
      await fetch(`${SUPABASE_URL}/rest/v1/rpc/cancel_own_pending_booking`, {
        method: "POST", headers: serviceHeaders, body: JSON.stringify({ p_booking_id: bookingId })
      }).catch(() => null);
      sendJson(response, 502, { error: error.message || "Secure payment is temporarily unavailable." });
      return;
    }
  }
  const apiKey = process.env.RESEND_API_KEY;

  if (!bookingResponse.ok || !booking || !apiKey) {
    console.error("Booking confirmed but owner notification could not be prepared.", bookingId);
    sendJson(response, 201, { ok: true, bookingId, notificationSent: false });
    return;
  }

  const label = bookingLabel(booking.session_type);
  const confirmUrl = confirmationUrl(request, booking.id);
  const detailsText = [
    `Session: ${label}`,
    `Starts: ${formatBrusselsDate(booking.starts_at)}`,
    `Ends: ${formatBrusselsDate(booking.ends_at)}`,
    `Client: ${booking.client_name || "Not provided"}`,
    `Email: ${booking.client_email || "Not provided"}`,
    `Phone: ${booking.client_phone || "Not provided"}`,
    `Preferred contact: ${booking.preferred_contact || "email"}`,
    `Booking ID: ${booking.id}`
  ];
  let resendResponse;
  try {
    resendResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `booking-owner/${booking.id}`
      },
      body: JSON.stringify({
        from: process.env.CONTACT_FROM_EMAIL || "Luxia P&C <onboarding@resend.dev>",
        to: OWNER_EMAIL,
        reply_to: booking.client_email,
        subject: `New Luxia booking: ${label}`,
        text: [
          "A new booking was made on the Luxia P&C website.",
          "",
          ...detailsText,
          "",
          "Client message:",
          booking.client_message || "No message provided.",
          "",
          `Confirm booking and create the private Zoom session: ${confirmUrl}`
        ].join("\n"),
        html: luxiaEmail({
          eyebrow: "New booking",
          title: "A new Luxia session was booked",
          intro: "Review the client details and confirm the booking to create the private session room.",
          content: detailsCard([
            ["Session", label],
            ["Starts", formatBrusselsDate(booking.starts_at)],
            ["Ends", formatBrusselsDate(booking.ends_at)],
            ["Client", booking.client_name],
            ["Email", booking.client_email],
            ["Phone", booking.client_phone],
            ["Preferred contact", booking.preferred_contact || "email"],
            ["Booking ID", booking.id]
          ]) + paragraph("Client message") + `<div style="padding:16px 18px;background:#f5faf8;border-radius:12px;font-size:15px;line-height:1.7;color:#587078;white-space:pre-wrap">${escapeHtml(booking.client_message || "No message provided.")}</div>` + actionButton(confirmUrl, "Review and confirm booking"),
          footer: "Owner login is required before a booking can be confirmed."
        })
      })
    });
  } catch (error) {
    console.error("Booking confirmed but the owner email provider was unavailable.", bookingId);
    sendJson(response, 201, { ok: true, bookingId, notificationSent: false });
    return;
  }

  if (!resendResponse.ok) {
    const providerError = await readJson(resendResponse);
    console.error("Booking confirmed but owner email failed.", bookingId, providerError);
    sendJson(response, 201, { ok: true, bookingId, notificationSent: false });
    return;
  }

  sendJson(response, 201, { ok: true, bookingId, paymentRequired: false, notificationSent: true });
};
