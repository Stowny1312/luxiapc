const { SUPABASE_URL, bearerToken, getSupabaseUser, readJson, sendJson, siteOrigin, supabaseHeaders, supabaseRpc, zoomAccessToken } = require("../lib/zoom-common");

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

function formatBrusselsDate(value) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Brussels",
    dateStyle: "full",
    timeStyle: "short"
  }).format(new Date(value));
}

async function notifyClient(booking, meetingUrl) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey || !booking.client_email) return false;
  const label = bookingLabel(booking.session_type);
  const start = formatBrusselsDate(booking.starts_at);
  const end = formatBrusselsDate(booking.ends_at);
  const clientName = booking.client_name || "there";
  const emailResponse = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": `booking-confirmed-client/${booking.id}`
    },
    body: JSON.stringify({
      from: process.env.CONTACT_FROM_EMAIL || "Luxia P&C <onboarding@resend.dev>",
      to: booking.client_email,
      subject: `Your Luxia ${label} is confirmed`,
      text: [
        `Hello ${clientName},`,
        "",
        `Your ${label} with Luxia P&C is confirmed.`,
        `Starts: ${start}`,
        `Ends: ${end}`,
        "",
        `Open your private session: ${meetingUrl}`,
        "",
        "The room opens 10 minutes before the appointment. Please sign in with the email used for the booking. You will remain in Zoom's private waiting room until the coach admits you."
      ].join("\n"),
      html: `<div style="font-family:Arial,sans-serif;line-height:1.65;color:#243236;max-width:620px;margin:auto"><p style="color:#42777e;font-weight:700;letter-spacing:.08em;text-transform:uppercase">Luxia P&amp;C</p><h1 style="font-size:26px;margin-bottom:8px">Your booking is confirmed</h1><p>Hello ${escapeHtml(clientName)},</p><p>Your <strong>${escapeHtml(label)}</strong> has been confirmed.</p><div style="padding:18px;border-radius:16px;background:#f0fafb"><div><strong>Starts:</strong> ${escapeHtml(start)}</div><div><strong>Ends:</strong> ${escapeHtml(end)}</div></div><p style="margin:28px 0"><a href="${escapeHtml(meetingUrl)}" style="display:inline-block;padding:14px 22px;border-radius:999px;background:#243236;color:#fff;text-decoration:none;font-weight:700">Open private session</a></p><p style="font-size:14px;color:#647276">The room opens 10 minutes before the appointment. Sign in with the email used for this booking. You will stay in Zoom's private waiting room until your coach admits you.</p></div>`
    })
  });
  if (!emailResponse.ok) {
    const providerError = await readJson(emailResponse);
    console.error("Confirmed booking client email failed.", booking.id, providerError);
    return false;
  }
  return true;
}

module.exports = async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    sendJson(response, 405, { error: "Method not allowed." });
    return;
  }
  const authorization = bearerToken(request);
  if (!authorization) return sendJson(response, 401, { error: "Owner login is required." });
  const bookingId = String((request.body && request.body.bookingId) || "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(bookingId)) return sendJson(response, 400, { error: "Invalid booking." });

  try {
    const user = await getSupabaseUser(authorization);
    if (!user.app_metadata || user.app_metadata.luxia_role !== "owner") return sendJson(response, 403, { error: "Owner access is required." });
    const bookingResponse = await fetch(`${SUPABASE_URL}/rest/v1/bookings?id=eq.${bookingId}&select=id,session_type,starts_at,ends_at,status,client_name,client_email,meeting_url`, { headers: supabaseHeaders(authorization) });
    const bookings = await readJson(bookingResponse);
    const booking = Array.isArray(bookings) ? bookings[0] : null;
    if (!bookingResponse.ok || !booking || booking.status !== "upcoming" || new Date(booking.ends_at) <= new Date()) {
      return sendJson(response, 409, { error: "This booking cannot be confirmed." });
    }
    if (booking.meeting_url) return sendJson(response, 200, { ok: true, meetingUrl: booking.meeting_url });

    const accessToken = await zoomAccessToken();
    const hostEmail = process.env.ZOOM_HOST_EMAIL || "tonkata.stoev@gmail.com";
    const duration = Math.max(1, Math.round((new Date(booking.ends_at) - new Date(booking.starts_at)) / 60000));
    const zoomResponse = await fetch(`https://api.zoom.us/v2/users/${encodeURIComponent(hostEmail)}/meetings`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        topic: `Luxia P&C - ${bookingLabel(booking.session_type)}`,
        type: 2,
        start_time: booking.starts_at,
        duration,
        timezone: "Europe/Brussels",
        agenda: `Private Luxia session with ${booking.client_name || booking.client_email || "client"}`,
        settings: {
          join_before_host: false,
          waiting_room: true,
          waiting_room_options: { mode: "custom", who_goes_to_waiting_room: "everyone" },
          approval_type: 2,
          host_video: true,
          participant_video: true,
          audio: "both",
          auto_recording: "none"
        }
      })
    });
    const zoomMeeting = await readJson(zoomResponse);
    if (!zoomResponse.ok || !zoomMeeting.id || !zoomMeeting.password) throw new Error((zoomMeeting && zoomMeeting.message) || "Zoom could not create the meeting.");

    const meetingUrl = `${siteOrigin(request)}/prototypes/vibrant-premium/pages/private-session.html?booking=${booking.id}`;
    await supabaseRpc("store_booking_zoom_session", {
      p_booking_id: booking.id,
      p_meeting_number: String(zoomMeeting.id),
      p_meeting_passcode: zoomMeeting.password,
      p_meeting_url: meetingUrl
    }, authorization);
    let notificationSent = false;
    try {
      notificationSent = await notifyClient(booking, meetingUrl);
    } catch (emailError) {
      console.error("Booking confirmed but client notification was unavailable.", booking.id, emailError.message);
    }
    sendJson(response, 200, { ok: true, meetingUrl, notificationSent });
  } catch (error) {
    console.error("Booking confirmation failed.", error.message);
    sendJson(response, 502, { error: error.message || "The Zoom meeting could not be created." });
  }
};
