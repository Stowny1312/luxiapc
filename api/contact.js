const CONTACT_TO_EMAIL = "tonkata.stoev@gmail.com";

function sendJson(response, statusCode, payload) {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json");
  response.end(JSON.stringify(payload));
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isValidPhone(phone) {
  return /^[+()\d\s.-]{7,30}$/.test(phone);
}

module.exports = async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    sendJson(response, 405, { error: "Method not allowed." });
    return;
  }

  const apiKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.CONTACT_FROM_EMAIL || "Luxia P&C <onboarding@resend.dev>";

  if (!apiKey) {
    sendJson(response, 503, {
      error: "Email sending is not configured yet. Please add RESEND_API_KEY in Vercel."
    });
    return;
  }

  let payload;
  try {
    payload = typeof request.body === "string" ? JSON.parse(request.body) : request.body;
  } catch (error) {
    sendJson(response, 400, { error: "Invalid message payload." });
    return;
  }

  const email = String((payload && payload.email) || "").trim().toLowerCase();
  const fullName = String((payload && payload.fullName) || "").trim();
  const phone = String((payload && payload.phone) || "").trim();
  const preferredContact = String((payload && payload.preferredContact) || "").trim().toLowerCase();
  const message = String((payload && payload.message) || "").trim();
  const clientAccount = String((payload && payload.clientAccount) || "not logged in").trim();

  if (!fullName || fullName.length > 120) {
    sendJson(response, 400, { error: "Please enter a valid full name." });
    return;
  }

  if (!isValidEmail(email)) {
    sendJson(response, 400, { error: "Please enter a valid email address." });
    return;
  }

  if (!isValidPhone(phone)) {
    sendJson(response, 400, { error: "Please enter a valid phone number." });
    return;
  }

  if (!["email", "phone"].includes(preferredContact)) {
    sendJson(response, 400, { error: "Please choose email or phone as your preferred contact method." });
    return;
  }

  if (!message || message.length > 5000) {
    sendJson(response, 400, { error: "Please write a message before sending." });
    return;
  }

  const resendResponse = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from: fromEmail,
      to: CONTACT_TO_EMAIL,
      reply_to: email,
      subject: "Luxia P&C contact message",
      text: [
        "New message from the Luxia P&C website",
        "",
        `Full name: ${fullName}`,
        `Email: ${email}`,
        `Phone: ${phone}`,
        `Preferred contact method: ${preferredContact}`,
        `Client account: ${clientAccount}`,
        "",
        "Message:",
        message
      ].join("\n")
    })
  });

  if (!resendResponse.ok) {
    let details = "Email provider rejected the message.";
    try {
      const data = await resendResponse.json();
      details = data.message || data.error || details;
    } catch (error) {
      details = await resendResponse.text();
    }

    sendJson(response, 502, { error: details });
    return;
  }

  sendJson(response, 200, { ok: true });
};
