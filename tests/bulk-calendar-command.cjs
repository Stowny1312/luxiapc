const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('prototypes/vibrant-premium/calendar.js', 'utf8');
const parserStart = source.indexOf('  function parseVoiceCommand(rawCommand) {');
const parserEnd = source.indexOf('  async function applyOwnerCommand()', parserStart);
assert.ok(parserStart >= 0 && parserEnd > parserStart, 'The calendar command parser should be present.');

const parserSource = source.slice(parserStart, parserEnd);
const context = {
  Date,
  Intl,
  window: { LuxiaI18n: { language: 'en' } }
};

vm.runInNewContext(`
  const timeZone = 'Europe/Brussels';
  const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const monthLookup = Object.fromEntries(monthNames.map((name, index) => [name.toLowerCase(), index]));
  const datePartsFormatter = new Intl.DateTimeFormat('en-GB', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  function partsInBrussels(date) {
    const values = {};
    datePartsFormatter.formatToParts(date).forEach((part) => { if (part.type !== 'literal') values[part.type] = Number(part.value); });
    return values;
  }
  function brusselsDateToUtc(year, monthIndex, day, hour, minute) {
    const target = Date.UTC(year, monthIndex, day, hour || 0, minute || 0, 0);
    let guess = target;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const actualParts = partsInBrussels(new Date(guess));
      const actual = Date.UTC(actualParts.year, actualParts.month - 1, actualParts.day, actualParts.hour, actualParts.minute, actualParts.second);
      guess += target - actual;
    }
    return new Date(guess);
  }
  function addCalendarDays(parts, amount) {
    const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + amount));
    return { year: date.getUTCFullYear(), monthIndex: date.getUTCMonth(), day: date.getUTCDate() };
  }
  ${parserSource}
  globalThis.parseVoiceCommandForTest = parseVoiceCommand;
`, context);

const english = context.parseVoiceCommandForTest('remove all 20 minutes sessions for September 30');
assert.equal(english.action, 'remove');
assert.equal(english.bulk, true);
assert.equal(english.duration, 20);
assert.equal(english.slotType, 'consultation');
assert.equal(english.dayEnd.getTime() - english.start.getTime(), 24 * 60 * 60 * 1000);

const coaching = context.parseVoiceCommandForTest('remove every one hour coaching session on September 30');
assert.equal(coaching.bulk, true);
assert.equal(coaching.duration, 60);
assert.equal(coaching.slotType, 'coaching');

assert.throws(
  () => context.parseVoiceCommandForTest('remove all sessions on September 30'),
  /For bulk removal/
);

context.window.LuxiaI18n.language = 'nl';
const dutch = context.parseVoiceCommandForTest('Verwijder alle consultaties van 20 minuten op 30 september');
assert.equal(dutch.bulk, true);
assert.equal(dutch.duration, 20);

context.window.LuxiaI18n.language = 'pl';
const polish = context.parseVoiceCommandForTest('Usuń wszystkie konsultacje 20 minut 30 września');
assert.equal(polish.bulk, true);
assert.equal(polish.duration, 20);

assert.match(source, /\.eq\("status", "available"\)/, 'Bulk removal must only target available slots.');
assert.match(source, /\.eq\("duration_minutes", parsed\.duration\)/, 'Bulk removal must match the requested duration.');
assert.match(source, /\.in\("id", matchingSlots\.map/, 'Bulk removal should delete the matched IDs together.');

console.log('Bulk calendar command tests passed.');
