const assert = require("node:assert/strict");
const { stripeSiteOrigin } = require("../lib/stripe");

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
});

withEnv({ STRIPE_MODE: "live", PUBLIC_SITE_URL: "https://luxiapc.com" }, () => {
  assert.equal(stripeSiteOrigin(), "https://luxiapc.com");
});

withEnv({ STRIPE_MODE: "live", PUBLIC_SITE_URL: "https://dev.luxiapc.com" }, () => {
  assert.throws(() => stripeSiteOrigin(), /must use luxiapc\.com/);
});

withEnv({ STRIPE_MODE: "test", PUBLIC_SITE_URL: "https://luxiapc.com" }, () => {
  assert.throws(() => stripeSiteOrigin(), /must use dev\.luxiapc\.com/);
});

console.log("Stripe environment guard tests passed.");
