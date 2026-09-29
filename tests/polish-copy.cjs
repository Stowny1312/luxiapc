const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const context = {window:{}};
vm.createContext(context);
for (const language of ['nl','pl']) vm.runInContext(fs.readFileSync(path.join(__dirname,'../prototypes/vibrant-premium',language+'.js'),'utf8'),context);
const {LUXIA_NL:nl,LUXIA_PL:pl,LuxiaPolish:polish} = context.window;
for (const key of Object.keys(nl)) assert.ok(typeof pl[key] === 'string' && pl[key].trim(), 'Missing Polish: '+key);
for (const [source,expected] of [
 ['October 2026','październik 2026'],
 ['18 August — available hours','18 sierpnia — dostępne godziny'],
 ['2 available times on 18 August','Dostępne terminy na 18 sierpnia: 2'],
 ['Payment: Approved','Płatność: Zatwierdzona'],
 ['Payment: Declined','Płatność: Odrzucona'],
 ['Gender: female','Płeć: kobieta'],
 ['Hi, Jane Test','Cześć, Jane Test'],
 ['Phone: +32470000000','Telefon: +32470000000'],
 ['Date of birth: 1990-01-01','Data urodzenia: 01.01.1990'],
 ['€45.00 paid','Zapłacono: €45,00'],
 ['🇵🇱 Poland (+48)','🇵🇱 Polska (+48)'],
 ['user@example.com','user@example.com']
]) assert.equal(polish.translate(source),expected,source);
assert.equal(polish.validation({validity:{valueMissing:true}}),'Uzupełnij to wymagane pole.');
console.log('PASS: Polish dictionary coverage, dates, parameterized messages, countries, validation, and identity preservation');
