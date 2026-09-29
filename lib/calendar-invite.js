function escapeIcs(value) {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/\r?\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

function utcStamp(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("Invalid calendar date.");
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function foldLine(line) {
  const lines = [];
  let current = "";
  for (const character of String(line)) {
    if (Buffer.byteLength(current + character, "utf8") > 73) {
      lines.push(current);
      current = ` ${character}`;
    } else {
      current += character;
    }
  }
  lines.push(current);
  return lines.join("\r\n");
}

function bookingLabel(sessionType) {
  return sessionType === "coaching" ? "1-hour coaching session" : "20-minute consultation";
}

function createBookingCalendarInvite(booking, options = {}) {
  if (!booking || !booking.id || !booking.starts_at || !booking.ends_at) {
    throw new Error("Complete booking details are required for a calendar invitation.");
  }
  const ownerEmail = String(options.ownerEmail || "luxiapc@outlook.com").trim().toLowerCase();
  const label = bookingLabel(booking.session_type);
  const description = [
    `${label} with ${booking.client_name || booking.client_email || "Luxia client"}.`,
    booking.client_email ? `Client email: ${booking.client_email}` : "",
    booking.client_phone ? `Client phone: ${booking.client_phone}` : "",
    booking.preferred_contact ? `Preferred contact: ${booking.preferred_contact}` : "",
    options.actionUrl ? `Open booking: ${options.actionUrl}` : "",
    `Booking ID: ${booking.id}`
  ].filter(Boolean).join("\n");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Luxia Prevention & Coaching//Booking Calendar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:Luxia P&C bookings",
    "BEGIN:VEVENT",
    `UID:${escapeIcs(booking.id)}@luxiapc.com`,
    `DTSTAMP:${utcStamp(new Date())}`,
    `DTSTART:${utcStamp(booking.starts_at)}`,
    `DTEND:${utcStamp(booking.ends_at)}`,
    `SUMMARY:${escapeIcs(`Luxia P&C — ${label}`)}`,
    `DESCRIPTION:${escapeIcs(description)}`,
    "LOCATION:Online — Luxia Prevention & Coaching",
    `CONTACT:${escapeIcs(ownerEmail)}`,
    "STATUS:CONFIRMED",
    "TRANSP:OPAQUE",
    "BEGIN:VALARM",
    "TRIGGER:-PT30M",
    "ACTION:DISPLAY",
    "DESCRIPTION:Luxia session starts in 30 minutes",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR"
  ];
  return `${lines.map(foldLine).join("\r\n")}\r\n`;
}

function calendarAttachment(booking, options = {}) {
  const content = createBookingCalendarInvite(booking, options);
  return {
    filename: `luxia-booking-${booking.id}.ics`,
    content: Buffer.from(content, "utf8").toString("base64"),
    content_type: "text/calendar; charset=utf-8; method=PUBLISH"
  };
}

module.exports = { bookingLabel, calendarAttachment, createBookingCalendarInvite, escapeIcs, utcStamp };
