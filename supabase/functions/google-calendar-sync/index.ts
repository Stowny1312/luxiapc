import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Cache-Control": "no-store",
  "Content-Type": "application/json"
};

const timeZone = "Europe/Brussels";
const maxCalendarBytes = 2_000_000;
const datePartsFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23"
});

type IcsProperty = {
  value: string;
  params: Record<string, string>;
};

type CalendarEvent = {
  external_event_id: string;
  slot_type: "consultation" | "coaching";
  duration_minutes: 20 | 60;
  starts_at: string;
  ends_at: string;
};

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

function unfoldIcs(value: string) {
  return value.replace(/\r?\n[ \t]/g, "");
}

function unescapeIcsText(value: string) {
  return value
    .replace(/\\[nN]/g, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\")
    .trim();
}

function readProperty(line: string): { name: string; property: IcsProperty } | null {
  const separator = line.indexOf(":");
  if (separator < 1) return null;

  const descriptor = line.slice(0, separator);
  const value = line.slice(separator + 1);
  const [rawName, ...rawParams] = descriptor.split(";");
  const params: Record<string, string> = {};

  rawParams.forEach((rawParam) => {
    const equals = rawParam.indexOf("=");
    if (equals > 0) {
      params[rawParam.slice(0, equals).toUpperCase()] = rawParam.slice(equals + 1);
    }
  });

  return {
    name: rawName.toUpperCase(),
    property: { value, params }
  };
}

function partsInZone(date: Date, zone: string) {
  const formatter = zone === timeZone
    ? datePartsFormatter
    : new Intl.DateTimeFormat("en-GB", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23"
    });
  const values: Record<string, number> = {};
  formatter.formatToParts(date).forEach((part) => {
    if (part.type !== "literal") values[part.type] = Number(part.value);
  });
  return values;
}

function zonedDateToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  zone: string
) {
  const target = Date.UTC(year, month - 1, day, hour, minute, second);
  let guess = target;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const actualParts = partsInZone(new Date(guess), zone);
    const actual = Date.UTC(
      actualParts.year,
      actualParts.month - 1,
      actualParts.day,
      actualParts.hour,
      actualParts.minute,
      actualParts.second
    );
    guess += target - actual;
  }

  return new Date(guess);
}

function parseIcsDate(property: IcsProperty | undefined) {
  if (!property || property.params.VALUE === "DATE") return null;
  const match = property.value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/);
  if (!match) return null;

  const [, year, month, day, hour, minute, second, utc] = match;
  if (utc === "Z") {
    return new Date(Date.UTC(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second)
    ));
  }

  const zone = property.params.TZID || timeZone;
  try {
    return zonedDateToUtc(
      Number(year),
      Number(month),
      Number(day),
      Number(hour),
      Number(minute),
      Number(second),
      zone
    );
  } catch {
    return null;
  }
}

function eventFromProperties(properties: Map<string, IcsProperty>): CalendarEvent | null {
  if (properties.has("RRULE")) return null;
  if ((properties.get("STATUS")?.value || "").toUpperCase() === "CANCELLED") return null;

  const uid = unescapeIcsText(properties.get("UID")?.value || "");
  const summary = unescapeIcsText(properties.get("SUMMARY")?.value || "");
  const start = parseIcsDate(properties.get("DTSTART"));
  const end = parseIcsDate(properties.get("DTEND"));

  if (!uid || uid.length > 512 || !/\bluxia\b/i.test(summary) || !start || !end) return null;

  const durationMinutes = Math.round((end.getTime() - start.getTime()) / 60000);
  if (durationMinutes !== 20 && durationMinutes !== 60) return null;

  const now = Date.now();
  if (start.getTime() < now - 15 * 60_000 || start.getTime() > now + 365 * 24 * 60 * 60_000) {
    return null;
  }

  return {
    external_event_id: uid,
    slot_type: durationMinutes === 20 ? "consultation" : "coaching",
    duration_minutes: durationMinutes,
    starts_at: start.toISOString(),
    ends_at: end.toISOString()
  };
}

function parseCalendar(calendarText: string) {
  const lines = unfoldIcs(calendarText).split(/\r?\n/);
  const events = new Map<string, CalendarEvent>();
  let properties: Map<string, IcsProperty> | null = null;

  lines.forEach((line) => {
    if (line === "BEGIN:VEVENT") {
      properties = new Map();
      return;
    }
    if (line === "END:VEVENT") {
      if (properties) {
        const event = eventFromProperties(properties);
        if (event) events.set(event.external_event_id, event);
      }
      properties = null;
      return;
    }
    if (!properties) return;

    const parsed = readProperty(line);
    if (parsed && !properties.has(parsed.name)) {
      properties.set(parsed.name, parsed.property);
    }
  });

  return Array.from(events.values()).sort((left, right) => (
    left.starts_at.localeCompare(right.starts_at)
  ));
}

async function rpc<T>(name: string, body: Record<string, unknown> = {}) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) throw new Error("Supabase function environment is incomplete.");

  const result = await fetch(`${supabaseUrl}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "apikey": serviceRoleKey,
      "Authorization": `Bearer ${serviceRoleKey}`
    },
    body: JSON.stringify(body)
  });

  const text = await result.text();
  if (!result.ok) {
    let message = "The calendar database operation failed.";
    try {
      const data = JSON.parse(text);
      message = data.message || message;
    } catch {
      // Keep the safe fallback.
    }
    throw new Error(message);
  }

  return (text ? JSON.parse(text) : null) as T;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (request.method !== "POST") {
    return response({ ok: false, message: "Use POST to synchronize the calendar." }, 405);
  }

  let ownerUserId: string | null = null;
  try {
    const claims = await rpc<Array<{ owner_user_id: string; feed_url: string }>>(
      "claim_google_calendar_sync"
    );
    const claim = claims?.[0];
    if (!claim) {
      return response({
        ok: true,
        status: "idle",
        message: "No calendar synchronization is due."
      }, 202);
    }

    ownerUserId = claim.owner_user_id;
    const calendarResponse = await fetch(claim.feed_url, {
      method: "GET",
      redirect: "follow",
      headers: { "Accept": "text/calendar, text/plain;q=0.9" }
    });
    if (!calendarResponse.ok) {
      throw new Error(`Google Calendar returned HTTP ${calendarResponse.status}.`);
    }

    const contentLength = Number(calendarResponse.headers.get("content-length") || 0);
    if (contentLength > maxCalendarBytes) {
      throw new Error("The Google Calendar feed is too large to synchronize.");
    }

    const calendarText = await calendarResponse.text();
    if (new TextEncoder().encode(calendarText).byteLength > maxCalendarBytes) {
      throw new Error("The Google Calendar feed is too large to synchronize.");
    }
    if (!calendarText.includes("BEGIN:VCALENDAR")) {
      throw new Error("Google Calendar did not return a valid iCal calendar.");
    }

    const events = parseCalendar(calendarText);
    const result = await rpc<Record<string, unknown>>("apply_google_calendar_snapshot", {
      p_owner_user_id: ownerUserId,
      p_events: events
    });

    return response({
      ok: true,
      status: "synchronized",
      imported_events: events.length,
      result
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Google Calendar synchronization failed.";
    if (ownerUserId) {
      try {
        await rpc("record_google_calendar_sync_error", {
          p_owner_user_id: ownerUserId,
          p_error: message
        });
      } catch {
        // The original synchronization error is more useful to the caller.
      }
    }
    return response({ ok: false, status: "error", message }, 502);
  }
});
