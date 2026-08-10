const OWNER_EMAIL = "tonkata.stoev@gmail.com";
const SUPABASE_URL = process.env.SUPABASE_URL || "https://tapvkveybfotgskqjeof.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || "sb_publishable__BsA8Xl7RTgowZRkw5cjSQ_K-2FaQt5";

function sendJson(response, statusCode, payload) {
  response.statusCode = statusCode;
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Type", "application/json");
  response.end(JSON.stringify(payload));
}

function bookingLabel(sessionType) {
  return sessionType === "coaching" ? "1 hour coaching" : "20 minute consultation";
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
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
      `${SUPABASE_URL}/rest/v1/bookings?id=eq.${encodeURIComponent(bookingId)}&select=id,session_type,starts_at,ends_at,client_name,client_email,client_phone,preferred_contact,client_message`,
      { headers: supabaseHeaders }
    );
    bookings = await readJson(bookingResponse);
  } catch (error) {
    console.error("Booking confirmed but owner notification lookup failed.", bookingId);
    sendJson(response, 201, { ok: true, bookingId, notificationSent: false });
    return;
  }
  const booking = Array.isArray(bookings) ? bookings[0] : null;
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
          `Confirm booking and add the private session link: ${confirmUrl}`
        ].join("\n"),
        html: `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#243236;max-width:620px;margin:auto"><h1 style="font-size:24px">New Luxia booking</h1><p>A new booking was made on the Luxia P&amp;C website.</p><div style="padding:18px;border-radius:14px;background:#f0fafb">${detailsText.map((detail) => `<div>${escapeHtml(detail)}</div>`).join("")}<div style="margin-top:12px"><strong>Client message:</strong><br>${escapeHtml(booking.client_message || "No message provided.")}</div></div><p style="margin:28px 0"><a href="${escapeHtml(confirmUrl)}" style="display:inline-block;padding:13px 22px;border-radius:999px;background:#243236;color:#fff;text-decoration:none;font-weight:700">Confirm booking</a></p><p style="font-size:13px;color:#647276">Owner login is required. Add the personalized private session link on the confirmation page; it will then appear in the client’s private space.</p></div>`
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

  sendJson(response, 201, { ok: true, bookingId, notificationSent: true });
};
