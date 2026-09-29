const assert = require("node:assert/strict");
const { coachingPriceCents, stripeSiteOrigin } = require("../lib/stripe");

function withEnv(values, test) {
  const previous = {};
  for (const [key, value] of Object.entries(values)) {
    previous[key] = process.env[key];
    process.env[key] = value;
  }
  try { test(); } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

withEnv({ STRIPE_MODE: "test", PUBLIC_SITE_URL: "https://dev.luxiapc.com" }, () => {
  assert.equal(stripeSiteOrigin(), "https://dev.luxiapc.com");
  assert.equal(coachingPriceCents(new Date("2026-09-29T12:00:00Z")), 100);
});

withEnv({ STRIPE_MODE: "live", PUBLIC_SITE_URL: "https://luxiapc.com" }, () => {
  assert.equal(stripeSiteOrigin(), "https://luxiapc.com");
  assert.equal(coachingPriceCents(new Date("2026-10-31T22:59:59Z")), 4500);
  assert.equal(coachingPriceCents(new Date("2026-10-31T23:00:00Z")), 5000);
});

withEnv({ STRIPE_MODE: "test", PUBLIC_SITE_URL: "https://dev.luxiapc.com", COACHING_PRICE_CENTS: "250" }, () => {
  assert.equal(coachingPriceCents(new Date("2026-09-29T12:00:00Z")), 250);
});

withEnv({ STRIPE_MODE: "live", PUBLIC_SITE_URL: "https://dev.luxiapc.com" }, () => {
  assert.throws(() => stripeSiteOrigin(), /must use luxiapc\.com/);
});

withEnv({ STRIPE_MODE: "test", PUBLIC_SITE_URL: "https://luxiapc.com" }, () => {
  assert.throws(() => stripeSiteOrigin(), /must use dev\.luxiapc\.com/);
});

console.log("Stripe environment guard tests passed.");
