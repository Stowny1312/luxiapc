const { SUPABASE_URL, bearerToken, getSupabaseUser, readJson, sendJson, siteOrigin, supabaseHeaders, supabaseRpc, zoomAccessToken } = require("../lib/zoom-common");

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
        topic: `Luxia P&C - ${booking.session_type === "coaching" ? "1 hour coaching" : "20 minute consultation"}`,
        type: 2,
        start_time: booking.starts_at,
        duration,
        timezone: "Europe/Brussels",
        agenda: `Private Luxia session with ${booking.client_name || booking.client_email || "client"}`,
        settings: { join_before_host: false, waiting_room: true, approval_type: 2, audio: "both", auto_recording: "none" }
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
    sendJson(response, 200, { ok: true, meetingUrl });
  } catch (error) {
    console.error("Booking confirmation failed.", error.message);
    sendJson(response, 502, { error: error.message || "The Zoom meeting could not be created." });
  }
};
