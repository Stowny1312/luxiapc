(function () {
  "use strict";

  const calendarElements = Array.from(document.querySelectorAll("[data-slot-calendar]"));
  if (!calendarElements.length) return;

  const config = window.LUXIA_SUPABASE;
  const client = window.LUXIA_SUPABASE_CLIENT || (
    config && window.supabase
      ? window.supabase.createClient(config.url, config.publishableKey)
      : null
  );

  const bookingPanel = document.querySelector("[data-booking-panel]");
  const bookingForm = document.querySelector("[data-booking-form]");
  const bookingLoggedOut = document.querySelector("[data-booking-logged-out]");
  const bookingStatus = document.querySelector("[data-booking-status]");
  const selectedSlotTitle = document.querySelector("[data-selected-slot]");
  const bookingAccount = document.querySelector("[data-booking-account]");
  const bookingPhoneField = document.querySelector("[data-booking-phone-field]");
  const ownerPanel = document.querySelector("[data-owner-calendar]");
  const ownerAgendaList = document.querySelector("[data-owner-agenda-list]");
  const commandInput = document.querySelector("[data-owner-command]");
  const commandStatus = document.querySelector("[data-owner-command-status]");
  const voiceButton = document.querySelector("[data-voice-start]");
  const applyCommandButton = document.querySelector("[data-command-apply]");
  const timeZone = "Europe/Brussels";
  const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const monthLookup = Object.fromEntries(monthNames.map((name, index) => [name.toLowerCase(), index]));
  const state = {
    user: null,
    isOwner: false,
    selectedSlot: null,
    slots: new Map(),
    calendars: new Map()
  };

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
  const longDateFormatter = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
  const shortDateFormatter = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit"
  });
  const timeFormatter = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit"
  });

  function setStatus(node, message, type) {
    if (!node) return;
    node.textContent = message;
    node.dataset.type = type || "info";
    node.hidden = false;
  }

  function clearStatus(node) {
    if (!node) return;
    node.textContent = "";
    node.hidden = true;
    delete node.dataset.type;
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

  function dateKey(year, monthIndex, day) {
    return `${year}-${String(monthIndex + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  function dateKeyForInstant(value) {
    const parts = partsInBrussels(new Date(value));
    return dateKey(parts.year, parts.month - 1, parts.day);
  }

  function monthSerial(year, monthIndex) {
    return year * 12 + monthIndex;
  }

  function shiftedMonth(year, monthIndex, amount) {
    const value = monthSerial(year, monthIndex) + amount;
    return { year: Math.floor(value / 12), monthIndex: ((value % 12) + 12) % 12 };
  }

  function formatSlot(slot) {
    const duration = slot.duration_minutes === 20 ? "20-minute consultation" : "60-minute coaching session";
    return `${longDateFormatter.format(new Date(slot.starts_at))} · ${duration}`;
  }

  function createElement(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function renderCalendar(calendarElement, slots, year, monthIndex) {
    const grid = calendarElement.querySelector("[data-calendar-grid]");
    const title = calendarElement.querySelector("[data-calendar-title]");
    const status = calendarElement.querySelector("[data-calendar-status]");
    const previous = calendarElement.querySelector("[data-calendar-previous]");
    const nowParts = partsInBrussels(new Date());
    const currentSerial = monthSerial(nowParts.year, nowParts.month - 1);
    const viewedSerial = monthSerial(year, monthIndex);
    const slotMap = new Map();

    slots.forEach((slot) => {
      state.slots.set(slot.id, slot);
      const key = dateKeyForInstant(slot.starts_at);
      if (!slotMap.has(key)) slotMap.set(key, []);
      slotMap.get(key).push(slot);
    });

    title.textContent = `${monthNames[monthIndex]} ${year}`;
    previous.disabled = viewedSerial <= currentSerial;
    grid.replaceChildren();

    const firstWeekday = (new Date(Date.UTC(year, monthIndex, 1)).getUTCDay() + 6) % 7;
    const daysInMonth = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
    for (let index = 0; index < firstWeekday; index += 1) {
      const spacer = createElement("span", "slot-calendar-spacer");
      spacer.setAttribute("aria-hidden", "true");
      grid.append(spacer);
    }

    for (let day = 1; day <= daysInMonth; day += 1) {
      const key = dateKey(year, monthIndex, day);
      const daySlots = (slotMap.get(key) || []).sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at));
      const cell = createElement("div", "slot-calendar-day");
      const dayNumber = createElement("span", "slot-calendar-day-number", String(day));
      cell.append(dayNumber);
      if (key === dateKey(nowParts.year, nowParts.month - 1, nowParts.day)) cell.classList.add("is-today");
      if (daySlots.length) cell.classList.add("has-slots");

      daySlots.forEach((slot) => {
        const button = createElement("button", "slot-time-button", timeFormatter.format(new Date(slot.starts_at)));
        button.type = "button";
        button.dataset.slotId = slot.id;
        button.setAttribute("aria-label", `Choose ${formatSlot(slot)}`);
        button.addEventListener("click", () => selectSlot(slot));
        cell.append(button);
      });
      grid.append(cell);
    }

    while (grid.children.length % 7 !== 0) {
      const spacer = createElement("span", "slot-calendar-spacer");
      spacer.setAttribute("aria-hidden", "true");
      grid.append(spacer);
    }

    status.textContent = slots.length
      ? `${slots.length} available ${slots.length === 1 ? "time" : "times"} in ${monthNames[monthIndex]}.`
      : `No available times have been published for ${monthNames[monthIndex]} yet.`;
  }

  async function loadCalendar(calendarElement) {
    const calendarState = state.calendars.get(calendarElement);
    const status = calendarElement.querySelector("[data-calendar-status]");
    const start = brusselsDateToUtc(calendarState.year, calendarState.monthIndex, 1, 0, 0);
    const next = shiftedMonth(calendarState.year, calendarState.monthIndex, 1);
    const end = brusselsDateToUtc(next.year, next.monthIndex, 1, 0, 0);
    status.textContent = "Loading available times...";

    const { data, error } = await client
      .from("consultation_slots")
      .select("id, slot_type, duration_minutes, starts_at, ends_at, status")
      .eq("slot_type", calendarElement.dataset.slotType)
      .eq("status", "available")
      .gte("starts_at", start.toISOString())
      .lt("starts_at", end.toISOString())
      .order("starts_at", { ascending: true });

    if (error) {
      status.textContent = "The calendar could not be loaded. Please refresh the page and try again.";
      status.dataset.type = "error";
      return;
    }

    delete status.dataset.type;
    renderCalendar(calendarElement, data || [], calendarState.year, calendarState.monthIndex);
  }

  async function loadAllCalendars() {
    state.slots.clear();
    await Promise.all(calendarElements.map((calendarElement) => loadCalendar(calendarElement)));
  }

  function renderBookingIdentity() {
    if (!bookingPanel || !state.selectedSlot) return;
    bookingPanel.hidden = false;
    selectedSlotTitle.textContent = formatSlot(state.selectedSlot);
    bookingLoggedOut.hidden = Boolean(state.user);
    bookingForm.hidden = !state.user;

    if (!state.user) return;
    const metadata = state.user.user_metadata || {};
    const fullName = [metadata.first_name, metadata.last_name].filter(Boolean).join(" ") || "Luxia client";
    const phone = state.user.phone || metadata.phone || "";
    bookingAccount.textContent = `Booking as ${fullName} · ${state.user.email || "verified account"}`;
    const phoneInput = bookingForm.querySelector('input[name="phone"]');
    if (phoneInput) phoneInput.value = phone;
    bookingPhoneField.hidden = Boolean(phone);
    clearStatus(bookingStatus);
  }

  function selectSlot(slot) {
    state.selectedSlot = slot;
    renderBookingIdentity();
    bookingPanel.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  async function initializeAuth() {
    const { data: sessionData } = await client.auth.getSession();
    let user = sessionData.session && sessionData.session.user;

    if (sessionData.session) {
      const { data: refreshed } = await client.auth.refreshSession();
      user = refreshed.user || (refreshed.session && refreshed.session.user) || user;
    }

    state.user = user || null;
    state.isOwner = Boolean(state.user && state.user.app_metadata && state.user.app_metadata.luxia_role === "owner");
    if (ownerPanel) ownerPanel.hidden = !state.isOwner;
    renderBookingIdentity();
    if (state.isOwner) await loadOwnerAgenda();
  }

  async function submitBooking(event) {
    event.preventDefault();
    if (!state.selectedSlot || !state.user) return;
    const submitButton = bookingForm.querySelector('button[type="submit"]');
    const formData = new FormData(bookingForm);
    submitButton.disabled = true;
    setStatus(bookingStatus, "Confirming your booking...", "info");

    const { error } = await client.rpc("book_consultation_slot", {
      p_slot_id: state.selectedSlot.id,
      p_preferred_contact: String(formData.get("preferred_contact") || "email"),
      p_phone: String(formData.get("phone") || "").trim() || null,
      p_message: String(formData.get("message") || "").trim() || null
    });

    submitButton.disabled = false;
    if (error) {
      setStatus(bookingStatus, error.message || "This booking could not be completed.", "error");
      await loadAllCalendars();
      return;
    }

    const confirmed = state.selectedSlot;
    state.selectedSlot = null;
    selectedSlotTitle.textContent = `Confirmed: ${formatSlot(confirmed)}`;
    bookingForm.hidden = true;
    bookingLoggedOut.hidden = true;
    setStatus(bookingStatus, "Your booking is confirmed and has been added to your Client space.", "success");
    await loadAllCalendars();
    if (state.isOwner) await loadOwnerAgenda();
  }

  function agendaEntry(slot, booking) {
    const article = createElement("article", "owner-agenda-item");
    const heading = createElement("div", "owner-agenda-item-heading");
    const title = createElement("strong", "", shortDateFormatter.format(new Date(slot.starts_at)));
    const badge = createElement("span", `slot-status slot-status-${slot.status}`, slot.status);
    heading.append(title, badge);
    article.append(heading);
    article.append(createElement("p", "", slot.slot_type === "consultation" ? "20-minute consultation" : "60-minute coaching session"));
    if (booking) {
      article.append(createElement("p", "owner-booking-client", `${booking.client_name || "Client"} · ${booking.client_email || "No email"}`));
      if (booking.client_phone) article.append(createElement("p", "", booking.client_phone));
    }
    return article;
  }

  async function loadOwnerAgenda() {
    if (!state.isOwner || !ownerAgendaList) return;
    ownerAgendaList.replaceChildren(createElement("p", "", "Loading your calendar..."));
    const nowIso = new Date().toISOString();
    const [{ data: slots, error: slotError }, { data: bookings, error: bookingError }] = await Promise.all([
      client.from("consultation_slots").select("id, slot_type, duration_minutes, starts_at, ends_at, status").gte("starts_at", nowIso).order("starts_at", { ascending: true }).limit(80),
      client.from("bookings").select("slot_id, client_name, client_email, client_phone, preferred_contact, status").gte("starts_at", nowIso).order("starts_at", { ascending: true }).limit(80)
    ]);

    if (slotError || bookingError) {
      ownerAgendaList.replaceChildren(createElement("p", "", "The owner calendar could not be loaded."));
      return;
    }

    const bookingBySlot = new Map((bookings || []).map((booking) => [booking.slot_id, booking]));
    ownerAgendaList.replaceChildren();
    if (!slots || !slots.length) {
      ownerAgendaList.append(createElement("p", "", "No upcoming slots yet. Add the first one with a voice command."));
      return;
    }
    slots.forEach((slot) => ownerAgendaList.append(agendaEntry(slot, bookingBySlot.get(slot.id))));
  }

  function addCalendarDays(parts, amount) {
    const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + amount));
    return { year: date.getUTCFullYear(), monthIndex: date.getUTCMonth(), day: date.getUTCDate() };
  }

  function parseVoiceCommand(rawCommand) {
    const command = rawCommand
      .toLowerCase()
      .replace(/(\d)(st|nd|rd|th)\b/g, "$1")
      .replace(/[,.]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    const addAction = /\b(add|create|open|publish|make available)\b/.test(command);
    const removeAction = /\b(remove|delete|cancel|close)\b/.test(command);
    if (!addAction && !removeAction) throw new Error("Start the command with add or remove.");

    const now = new Date();
    const nowParts = partsInBrussels(now);
    let dateParts;
    if (/\btomorrow\b/.test(command)) {
      dateParts = addCalendarDays(nowParts, 1);
    } else if (/\btoday\b/.test(command)) {
      dateParts = { year: nowParts.year, monthIndex: nowParts.month - 1, day: nowParts.day };
    } else {
      const isoDate = command.match(/\b(20\d{2})[-/](\d{1,2})[-/](\d{1,2})\b/);
      const monthFirst = command.match(new RegExp(`\\b(${monthNames.join("|")})\\s+(\\d{1,2})(?:\\s+(20\\d{2}))?\\b`, "i"));
      const dayFirst = command.match(new RegExp(`\\b(\\d{1,2})\\s+(${monthNames.join("|")})(?:\\s+(20\\d{2}))?\\b`, "i"));
      if (isoDate) {
        dateParts = { year: Number(isoDate[1]), monthIndex: Number(isoDate[2]) - 1, day: Number(isoDate[3]) };
      } else if (monthFirst) {
        dateParts = { year: Number(monthFirst[3] || nowParts.year), monthIndex: monthLookup[monthFirst[1].toLowerCase()], day: Number(monthFirst[2]) };
      } else if (dayFirst) {
        dateParts = { year: Number(dayFirst[3] || nowParts.year), monthIndex: monthLookup[dayFirst[2].toLowerCase()], day: Number(dayFirst[1]) };
      } else {
        throw new Error("Say a date such as tomorrow or August 18.");
      }
    }

    const timeMatch = command.match(/\b(?:at|for)\s+(\d{1,2})(?:[:](\d{2}))?\s*(am|pm)?\b/);
    if (!timeMatch) throw new Error("Say a time such as at 10 AM or at 14:30.");
    let hour = Number(timeMatch[1]);
    const minute = Number(timeMatch[2] || 0);
    const meridiem = timeMatch[3];
    if (meridiem === "pm" && hour < 12) hour += 12;
    if (meridiem === "am" && hour === 12) hour = 0;
    if (hour > 23 || minute > 59) throw new Error("The spoken time is not valid.");

    let start = brusselsDateToUtc(dateParts.year, dateParts.monthIndex, dateParts.day, hour, minute);
    if (!/\b(20\d{2})\b/.test(command) && start < now && !/\b(today|tomorrow)\b/.test(command)) {
      start = brusselsDateToUtc(dateParts.year + 1, dateParts.monthIndex, dateParts.day, hour, minute);
    }
    if (addAction && start <= now) throw new Error("New availability must be in the future.");

    const isCoaching = /\b(60|one hour|1 hour|coaching)\b/.test(command);
    return {
      action: addAction ? "add" : "remove",
      start,
      duration: isCoaching ? 60 : 20,
      slotType: isCoaching ? "coaching" : "consultation"
    };
  }

  async function applyOwnerCommand() {
    if (!state.isOwner || !state.user) {
      setStatus(commandStatus, "Owner access is required.", "error");
      return;
    }
    let parsed;
    try {
      parsed = parseVoiceCommand(String(commandInput.value || ""));
    } catch (error) {
      setStatus(commandStatus, error.message, "error");
      return;
    }

    applyCommandButton.disabled = true;
    setStatus(commandStatus, `${parsed.action === "add" ? "Adding" : "Removing"} ${longDateFormatter.format(parsed.start)}...`, "info");
    let error;
    if (parsed.action === "add") {
      const end = new Date(parsed.start.getTime() + parsed.duration * 60000);
      ({ error } = await client.from("consultation_slots").insert({
        slot_type: parsed.slotType,
        duration_minutes: parsed.duration,
        starts_at: parsed.start.toISOString(),
        ends_at: end.toISOString(),
        status: "available",
        created_by: state.user.id
      }));
    } else {
      const from = new Date(parsed.start.getTime() - 60000).toISOString();
      const to = new Date(parsed.start.getTime() + 60000).toISOString();
      const { data: matchingSlot, error: findError } = await client
        .from("consultation_slots")
        .select("id")
        .eq("status", "available")
        .gte("starts_at", from)
        .lte("starts_at", to)
        .limit(1)
        .maybeSingle();
      if (findError) {
        error = findError;
      } else if (!matchingSlot) {
        error = { message: "No free slot was found at that date and time." };
      } else {
        ({ error } = await client.from("consultation_slots").delete().eq("id", matchingSlot.id).eq("status", "available"));
      }
    }
    applyCommandButton.disabled = false;

    if (error) {
      const message = error.code === "23P01"
        ? "That time overlaps another published or booked slot."
        : error.message || "The calendar could not be changed.";
      setStatus(commandStatus, message, "error");
      return;
    }

    setStatus(commandStatus, `Calendar updated: ${longDateFormatter.format(parsed.start)}.`, "success");
    commandInput.value = "";
    await Promise.all([loadAllCalendars(), loadOwnerAgenda()]);
  }

  function initializeVoiceRecognition() {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!voiceButton) return;
    if (!Recognition) {
      voiceButton.disabled = true;
      voiceButton.textContent = "Voice recognition is not supported here — type the command below";
      return;
    }

    const recognition = new Recognition();
    recognition.lang = "en-GB";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    voiceButton.addEventListener("click", () => recognition.start());
    recognition.onstart = () => {
      voiceButton.disabled = true;
      setStatus(commandStatus, "Listening...", "info");
    };
    recognition.onresult = (event) => {
      commandInput.value = event.results[0][0].transcript;
      setStatus(commandStatus, "Command recognized. Review it, then tap Apply command.", "success");
    };
    recognition.onerror = (event) => setStatus(commandStatus, `Voice recognition could not continue: ${event.error}.`, "error");
    recognition.onend = () => { voiceButton.disabled = false; };
  }

  function initializeCalendars() {
    const nowParts = partsInBrussels(new Date());
    calendarElements.forEach((calendarElement) => {
      state.calendars.set(calendarElement, { year: nowParts.year, monthIndex: nowParts.month - 1 });
      calendarElement.querySelector("[data-calendar-previous]").addEventListener("click", () => {
        const current = state.calendars.get(calendarElement);
        const previous = shiftedMonth(current.year, current.monthIndex, -1);
        state.calendars.set(calendarElement, previous);
        loadCalendar(calendarElement);
      });
      calendarElement.querySelector("[data-calendar-next]").addEventListener("click", () => {
        const current = state.calendars.get(calendarElement);
        const next = shiftedMonth(current.year, current.monthIndex, 1);
        state.calendars.set(calendarElement, next);
        loadCalendar(calendarElement);
      });
    });
  }

  if (!client) {
    calendarElements.forEach((calendarElement) => {
      calendarElement.querySelector("[data-calendar-status]").textContent = "The calendar is temporarily unavailable.";
    });
    return;
  }

  initializeCalendars();
  initializeVoiceRecognition();
  bookingForm.addEventListener("submit", submitBooking);
  bookingForm.querySelector('select[name="preferred_contact"]').addEventListener("change", (event) => {
    const metadata = (state.user && state.user.user_metadata) || {};
    const accountPhone = (state.user && state.user.phone) || metadata.phone || "";
    bookingPhoneField.hidden = event.target.value !== "phone" || Boolean(accountPhone);
  });
  document.querySelector("[data-cancel-selection]").addEventListener("click", () => {
    state.selectedSlot = null;
    bookingPanel.hidden = true;
  });
  if (applyCommandButton) applyCommandButton.addEventListener("click", applyOwnerCommand);
  document.querySelector("[data-command-clear]")?.addEventListener("click", () => {
    commandInput.value = "";
    clearStatus(commandStatus);
  });
  document.querySelector("[data-owner-refresh]")?.addEventListener("click", loadOwnerAgenda);
  window.addEventListener("focus", loadAllCalendars);

  initializeAuth().then(loadAllCalendars);
})();
