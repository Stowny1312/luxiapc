const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const files = [
  'api/book-consultation.js',
  'api/contact.js',
  'api/stripe-webhook.js'
];

for (const file of files) {
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  assert.match(source, /OWNER_NOTIFICATION_EMAIL/, `${file} must use the owner notification setting`);
  assert.doesNotMatch(source, /tonkata\.stoev@gmail\.com/i, `${file} must not notify the former inbox`);
  assert.match(source, /luxiapc@outlook\.com/i, `${file} must default to the official business inbox`);
}

console.log('PASS: all owner-facing email flows target the official business inbox');
