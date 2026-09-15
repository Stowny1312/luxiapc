const crypto = require("crypto");

function stripeMode() {
  const mode = String(process.env.STRIPE_MODE || "test").trim().toLowerCase();
  if (!new Set(["test", "live"]).has(mode)) throw new Error("Stripe mode must be test or live.");
  return mode;
}

function stripeKey() {
  const key = String(process.env.STRIPE_SECRET_KEY || "").trim();
  if (!/^sk_(test|live)_/.test(key)) throw new Error("Stripe is not configured.");
  const keyMode = key.startsWith("sk_live_") ? "live" : "test";
  if (keyMode !== stripeMode()) throw new Error(`Stripe ${stripeMode()} mode requires an ${stripeMode()} secret key.`);
  return key;
}

function stripeSiteOrigin(fallback) {
  const origin = String(process.env.PUBLIC_SITE_URL || fallback || "").trim().replace(/\/$/, "");
  let hostname;
  try {
    hostname = new URL(origin).hostname.toLowerCase();
  } catch (error) {
    throw new Error("The payment website URL is not configured correctly.");
  }
  const expectedHost = stripeMode() === "live" ? "luxiapc.com" : "dev.luxiapc.com";
  if (hostname !== expectedHost) throw new Error(`Stripe ${stripeMode()} mode must use ${expectedHost}.`);
  return origin;
}

async function stripeRequest(path, options = {}) {
  const response = await fetch(`https://api.stripe.com/v1${path}`, {
    method: options.method || "GET",
    headers: { Authorization: `Bearer ${stripeKey()}`, ...(options.body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}) },
    body: options.body ? new URLSearchParams(options.body).toString() : undefined
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error?.message || "Stripe could not complete the request.");
  return result;
}

function verifyWebhook(rawBody, signatureHeader) {
  const secret = String(process.env.STRIPE_WEBHOOK_SECRET || "").trim();
  if (!secret) throw new Error("Stripe webhook signing is not configured.");
  const parts = String(signatureHeader || "").split(",").map((part) => part.split("="));
  const timestamp = parts.find(([key]) => key === "t")?.[1];
  const signatures = parts.filter(([key]) => key === "v1").map(([, value]) => value);
  if (!timestamp || !signatures.length || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) throw new Error("Invalid Stripe webhook signature.");
  const expected = crypto.createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
  const valid = signatures.some((signature) => /^[a-f0-9]{64}$/i.test(signature) && crypto.timingSafeEqual(Buffer.from(signature, "hex"), Buffer.from(expected, "hex")));
  if (!valid) throw new Error("Invalid Stripe webhook signature.");
  return JSON.parse(rawBody);
}

module.exports = { stripeMode, stripeRequest, stripeSiteOrigin, verifyWebhook };
