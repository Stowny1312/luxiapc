const { bearerToken, getSupabaseUser, meetingSdkJwt, readJson, sendJson, supabaseRpc, zoomAccessToken } = require("../lib/zoom-common");

module.exports = async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    sendJson(response, 405, { error: "Method not allowed." });
    return;
  }
  const authorization = bearerToken(request);
  if (!authorization) return sendJson(response, 401, { error: "Please log in to enter your private session." });
  const bookingId = String((request.body && request.body.bookingId) || "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(bookingId)) return sendJson(response, 400, { error: "Invalid private session link." });

  try {
    const [user, accessRows] = await Promise.all([
      getSupabaseUser(authorization),
      supabaseRpc("get_booking_zoom_access", { p_booking_id: bookingId }, authorization)
    ]);
    const access = Array.isArray(accessRows) ? accessRows[0] : null;
    if (!access) return sendJson(response, 403, { error: "This private session is unavailable." });
    const role = access.is_owner ? 1 : 0;
    const sdk = meetingSdkJwt(access.meeting_number, role);
    let zak;
    const zoomToken = await zoomAccessToken();
    const meetingUpdateResponse = await fetch(`https://api.zoom.us/v2/meetings/${encodeURIComponent(access.meeting_number)}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${zoomToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ settings: { join_before_host: true, jbh_time: 0, waiting_room: false } })
    });
    if (!meetingUpdateResponse.ok && meetingUpdateResponse.status !== 204) {
      const updateError = await readJson(meetingUpdateResponse);
      console.error("Zoom meeting access settings could not be refreshed.", updateError);
    }
    if (access.is_owner) {
      const hostEmail = process.env.ZOOM_HOST_EMAIL || "tonkata.stoev@gmail.com";
      const zakResponse = await fetch(`https://api.zoom.us/v2/users/${encodeURIComponent(hostEmail)}/token?type=zak`, { headers: { Authorization: `Bearer ${zoomToken}` } });
      const zakData = await readJson(zakResponse);
      if (!zakResponse.ok || !zakData.token) {
        console.error("Zoom host ZAK request failed.", {
          status: zakResponse.status,
          code: zakData && zakData.code,
          message: zakData && zakData.message
        });
        throw new Error("Zoom could not authorize the host.");
      }
      zak = zakData.token;
    }
    const metadata = user.user_metadata || {};
    const userName = [metadata.first_name, metadata.last_name].filter(Boolean).join(" ") || (access.is_owner ? "Luxia Coach" : "Luxia Client");
    sendJson(response, 200, {
      sdkKey: sdk.clientId,
      signature: sdk.signature,
      meetingNumber: access.meeting_number,
      password: access.meeting_passcode,
      userName,
      zak: zak || null,
      endsAt: access.ends_at,
      isOwner: Boolean(access.is_owner)
    });
  } catch (error) {
    console.error("Private Zoom session access failed.", error.message);
    const message = error.message || "This private session is unavailable.";
    const expected = /opens 10 minutes|expired|waiting for owner|not found|not active|Authentication/i.test(message);
    sendJson(response, expected ? 403 : 502, { error: message });
  }
};
