const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const booking = fs.readFileSync(path.join(__dirname, "..", "api", "book-consultation.js"), "utf8");
const webhook = fs.readFileSync(path.join(__dirname, "..", "api", "stripe-webhook.js"), "utf8");

assert.match(booking, /Idempotency-Key/);
assert.match(booking, /STRIPE_INVOICE_CREATION_ENABLED/);
assert.match(booking, /STRIPE_TAX_ENABLED/);
assert.match(webhook, /checkout\.session\.async_payment_succeeded/);
assert.match(webhook, /checkout\.session\.async_payment_failed/);
assert.doesNotMatch(booking, /payment_method_types/);

console.log("Stripe checkout safety tests passed.");
