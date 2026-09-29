const SUPABASE_URL = process.env.SUPABASE_URL || "https://tapvkveybfotgskqjeof.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || "sb_publishable__BsA8Xl7RTgowZRkw5cjSQ_K-2FaQt5";
const TIME_ZONE = "Europe/Brussels";
const MONTH_NAMES = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december"
];
const WEEKDAY_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const datePartsFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23"
});
const spokenDateFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: TIME_ZONE,
  weekday: "long",
  day: "numeric",
  month: "long",
  hour: "2-digit",
  minute: "2-digit"
});

function sendJson(response, statusCode, payload) {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.end(JSON.stringify(payload));
}

function partsInBrussels(date) {
  const values = {};
  datePartsFormatter.formatToParts(date).forEach((part) => {
    if (part.type !== "literal") values[part.type] = Number(part.value);
  });
  return values;
}

function brusselsDateToUtc(year, monthIndex, day, hour, minute) {
  const target = Date.UTC(year, monthIndex, day, hour || 0, minute || 0, 0);
  let guess = target;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const actualParts = partsInBrussels(new Date(guess));
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

function addCalendarDays(parts, amount) {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + amount));
  return {
    year: date.getUTCFullYear(),
    monthIndex: date.getUTCMonth(),
    day: date.getUTCDate()
  };
}

function parseVoiceCommand(rawCommand) {
  const command = String(rawCommand || "")
    .toLowerCase()
    .replace(/(\d)(st|nd|rd|th)\b/g, "$1")
    .replace(/[,.]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const addAction = /\b(add|create|open|publish|make available)\b/.test(command);
  const removeAction = /\b(remove|delete|cancel|close)\b/.test(command);
  if (!addAction && !removeAction) {
    throw new Error("Start the command with add or remove.");
  }

  const now = new Date();
  const nowParts = partsInBrussels(now);
  let dateParts;

  if (/\btomorrow\b/.test(command)) {
    dateParts = addCalendarDays(nowParts, 1);
  } else if (/\btoday\b/.test(command)) {
    dateParts = { year: nowParts.year, monthIndex: nowParts.month - 1, day: nowParts.day };
  } else {
    const isoDate = command.match(/\b(20\d{2})[-/](\d{1,2})[-/](\d{1,2})\b/);
    const monthFirst = command.match(new RegExp(`\\b(${MONTH_NAMES.join("|")})\\s+(\\d{1,2})(?:\\s+(20\\d{2}))?\\b`, "i"));
    const dayFirst = command.match(new RegExp(`\\b(\\d{1,2})\\s+(${MONTH_NAMES.join("|")})(?:\\s+(20\\d{2}))?\\b`, "i"));
    const weekday = command.match(new RegExp(`\\b(next\\s+)?(${WEEKDAY_NAMES.join("|")})\\b`, "i"));

    if (isoDate) {
      dateParts = {
        year: Number(isoDate[1]),
        monthIndex: Number(isoDate[2]) - 1,
        day: Number(isoDate[3])
      };
    } else if (monthFirst) {
      dateParts = {
        year: Number(monthFirst[3] || nowParts.year),
        monthIndex: MONTH_NAMES.indexOf(monthFirst[1].toLowerCase()),
        day: Number(monthFirst[2])
      };
    } else if (dayFirst) {
      dateParts = {
        year: Number(dayFirst[3] || nowParts.year),
        monthIndex: MONTH_NAMES.indexOf(dayFirst[2].toLowerCase()),
        day: Number(dayFirst[1])
      };
    } else if (weekday) {
      const todayUtc = new Date(Date.UTC(nowParts.year, nowParts.month - 1, nowParts.day));
      const targetWeekday = WEEKDAY_NAMES.indexOf(weekday[2].toLowerCase());
      let daysAhead = (targetWeekday - todayUtc.getUTCDay() + 7) % 7;
      if (daysAhead === 0 || weekday[1]) daysAhead += 7;
      dateParts = addCalendarDays(nowParts, daysAhead);
    } else {
      throw new Error("Say a date such as tomorrow, next Monday, or August 18.");
    }
  }

  const timeMatch = command.match(/\b(?:at|for)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/);
  if (!timeMatch) throw new Error("Say a time such as at 10 AM or at 14:30.");

  let hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2] || 0);
  const meridiem = timeMatch[3];
  if (meridiem === "pm" && hour < 12) hour += 12;
  if (meridiem === "am" && hour === 12) hour = 0;
  if (hour > 23 || minute > 59) throw new Error("The spoken time is not valid.");

  let start = brusselsDateToUtc(dateParts.year, dateParts.monthIndex, dateParts.day, hour, minute);
  if (!/\b(20\d{2})\b/.test(command) && start < now && !/\b(today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/.test(command)) {
    start = brusselsDateToUtc(dateParts.year + 1, dateParts.monthIndex, dateParts.day, hour, minute);
  }

  if (addAction && start <= now) throw new Error("New availability must be in the future.");

  const isCoaching = /\b(60|one hour|1 hour|hour-long|coaching)\b/.test(command);
  return {
    action: addAction ? "add" : "remove",
    startsAt: start,
    duration: isCoaching ? 60 : 20,
    slotType: isCoaching ? "coaching" : "consultation"
  };
}

function bearerToken(request) {
  const authorization = String(request.headers.authorization || "");
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

module.exports = async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    sendJson(response, 405, { ok: false, message: "Send a POST voice command." });
    return;
  }

  const token = bearerToken(request);
  if (!token) {
    sendJson(response, 401, { ok: false, message: "The Luxia voice credential is missing." });
    return;
  }

  let payload;
  try {
    payload = typeof request.body === "string" ? JSON.parse(request.body) : request.body;
  } catch (error) {
    sendJson(response, 400, { ok: false, message: "The voice command payload is not valid." });
    return;
  }

  const command = String((payload && payload.command) || "").trim();
  if (!command || command.length > 300) {
    sendJson(response, 400, { ok: false, message: "Say one calendar command of up to 300 characters." });
    return;
  }

  let parsed;
  try {
    parsed = parseVoiceCommand(command);
  } catch (error) {
    sendJson(response, 400, { ok: false, message: error.message || "The command was not understood." });
    return;
  }

  let supabaseResponse;
  try {
    supabaseResponse = await fetch(`${SUPABASE_URL}/rest/v1/rpc/apply_voice_calendar_command`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_PUBLISHABLE_KEY,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        p_token: token,
        p_action: parsed.action,
        p_slot_type: parsed.slotType,
        p_starts_at: parsed.startsAt.toISOString(),
        p_duration: parsed.duration
      })
    });
  } catch (error) {
    sendJson(response, 503, { ok: false, message: "Luxia calendar is temporarily unavailable." });
    return;
  }

  let result = {};
  try {
    result = await supabaseResponse.json();
  } catch (error) {
    result = {};
  }

  if (!supabaseResponse.ok) {
    const message = String(result.message || "The calendar command could not be completed.");
    const rejectedCredential = /credential rejected/i.test(message);
    sendJson(response, rejectedCredential ? 401 : 400, { ok: false, message });
    return;
  }

  const confirmation = `${result.message} ${spokenDateFormatter.format(parsed.startsAt)} Brussels time.`;
  sendJson(response, 200, {
    ok: true,
    message: confirmation,
    action: result.action,
    slotType: result.slot_type,
    startsAt: result.starts_at,
    durationMinutes: result.duration_minutes
  });
};
