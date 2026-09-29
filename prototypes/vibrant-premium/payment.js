(function () {
  "use strict";
  const title = document.querySelector("[data-payment-title]");
  const message = document.querySelector("[data-payment-message]");
  const status = document.querySelector("[data-payment-status]");
  const amount = document.querySelector("[data-payment-amount]");
  const action = document.querySelector("[data-payment-action]");
  if (!title || !status) return;
  const params = new URLSearchParams(window.location.search);

  function show(kind, heading, detail, statusText) {
    title.textContent = heading;
    message.textContent = detail;
    status.textContent = statusText;
    status.dataset.type = kind;
    action.hidden = false;
  }

  if (params.get("cancelled")) {
    show("info", "Payment was not completed", "No money was taken. The reserved time will become available again when the secure payment window expires.", "You can return and choose another session.");
    return;
  }
  const sessionId = params.get("session_id");
  if (!sessionId) {
    show("info", "Payments at Luxia", "Paid coaching sessions use Stripe Checkout, with eligible payment methods shown for your device and country.", "Choose a coaching time to begin.");
    return;
  }

  async function check(attempt) {
    const client = window.LUXIA_SUPABASE_CLIENT;
    const session = client && (await client.auth.getSession()).data.session;
    if (!session) return show("error", "Please log in", "Log in with the same Luxia account used for the booking to view the payment result.", "Your payment details remain private.");
    try {
      const response = await fetch(`/api/payment-status?session_id=${encodeURIComponent(sessionId)}`, { headers: { Authorization: `Bearer ${session.access_token}` } });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Payment status is unavailable.");
      if (result.booking.payment_status === "paid" && result.booking.status === "upcoming") {
        amount.textContent = `€${(result.booking.payment_amount_cents / 100).toFixed(2)} paid`;
        action.href = "client-space.html";
        action.textContent = "Open Client space";
        return show("success", "Payment confirmed", "Your coaching session is confirmed and now appears in your Client space.", "Thank you — Luxia has received your payment.");
      }
      if (attempt < 8) return window.setTimeout(() => check(attempt + 1), 1500);
      show("info", "Payment received", "Stripe is still confirming the payment with Luxia. It will appear in your Client space shortly.", "You may safely close this page.");
    } catch (error) {
      show("error", "We could not verify the payment yet", "If money was taken, do not pay again. Please check your Client space shortly or contact Luxia.", error.message);
    }
  }
  check(0);
})();
