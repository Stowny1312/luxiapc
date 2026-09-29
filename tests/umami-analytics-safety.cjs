const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const loader = fs.readFileSync(path.join(__dirname, "..", "prototypes", "vibrant-premium", "loader.js"), "utf8");
const endpoint = fs.readFileSync(path.join(__dirname, "..", "api", "umami.js"), "utf8");

assert.match(loader, /analytics\.src = "\/api\/umami"/);
assert.match(endpoint, /UMAMI_WEBSITE_ID/);
assert.match(endpoint, /data-domains/);
assert.match(endpoint, /data-performance/);
assert.doesNotMatch(endpoint, /email|phone|client_name|user_id/i);

console.log("Umami analytics safety tests passed.");
