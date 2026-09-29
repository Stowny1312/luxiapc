const assert = require("node:assert/strict");
const { createBookingCalendarInvite, calendarAttachment } = require("../lib/calendar-invite");

const booking = {
  id: "11111111-2222-4333-8444-555555555555",
  session_type: "coaching",
  starts_at: "2026-09-30T08:00:00.000Z",
  ends_at: "2026-09-30T09:00:00.000Z",
  client_name: "Zoë Example, Client",
  client_email: "client@example.com",
  client_phone: "+32 470 00 00 00",
  preferred_contact: "email"
};

const invite = createBookingCalendarInvite(booking, {
  ownerEmail: "luxiapc@outlook.com",
  actionUrl: "https://dev.luxiapc.com/booking?id=1"
});
assert.match(invite, /BEGIN:VCALENDAR\r\n/);
assert.match(invite, /METHOD:PUBLISH/);
assert.match(invite, /UID:11111111-2222-4333-8444-555555555555@luxiapc\.com/);
assert.match(invite, /DTSTART:20260930T080000Z/);
assert.match(invite, /DTEND:20260930T090000Z/);
assert.match(invite, /Zoë Example\\, Client/);
assert.match(invite, /BEGIN:VALARM/);
assert.match(invite, /TRIGGER:-PT30M/);
assert.ok(invite.split("\r\n").every(line => Buffer.byteLength(line, "utf8") <= 75));

const attachment = calendarAttachment(booking);
assert.equal(attachment.content_type, "text/calendar; charset=utf-8; method=PUBLISH");
assert.equal(Buffer.from(attachment.content, "base64").toString("utf8"), createBookingCalendarInvite(booking));
console.log("Calendar invitation tests passed.");
