(() => {
  'use strict';
  const normalize = value => value.replace(/\s+/g, ' ').trim();
  const dictionary = new Map(Object.entries(window.LUXIA_NL || {}).map(([key, value]) => [normalize(key), value]));
  const originals = new WeakMap();
  const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const dutchMonths = ['januari','februari','maart','april','mei','juni','juli','augustus','september','oktober','november','december'];
  const countries = {'Belgium':'België','Netherlands':'Nederland','Poland':'Polen','France':'Frankrijk','Germany':'Duitsland','Luxembourg':'Luxemburg','United Kingdom':'Verenigd Koninkrijk','Ireland':'Ierland','Spain':'Spanje','Portugal':'Portugal','Italy':'Italië','Switzerland':'Zwitserland','Austria':'Oostenrijk','Denmark':'Denemarken','Sweden':'Zweden','Norway':'Noorwegen','Finland':'Finland','Iceland':'IJsland','Greece':'Griekenland','Cyprus':'Cyprus','Malta':'Malta','Czechia':'Tsjechië','Slovakia':'Slowakije','Hungary':'Hongarije','Romania':'Roemenië','Bulgaria':'Bulgarije','Croatia':'Kroatië','Slovenia':'Slovenië','Serbia':'Servië','Bosnia & Herzegovina':'Bosnië en Herzegovina','Montenegro':'Montenegro','North Macedonia':'Noord-Macedonië','Albania':'Albanië','Lithuania':'Litouwen','Latvia':'Letland','Estonia':'Estland','Ukraine':'Oekraïne','Moldova':'Moldavië','Türkiye':'Turkije','United States / Canada':'Verenigde Staten / Canada','Mexico':'Mexico','Brazil':'Brazilië','Argentina':'Argentinië','Australia':'Australië','New Zealand':'Nieuw-Zeeland','Japan':'Japan','South Korea':'Zuid-Korea','China':'China','India':'India','United Arab Emirates':'Verenigde Arabische Emiraten','Israel':'Israël','South Africa':'Zuid-Afrika','Morocco':'Marokko'};
  const dateWords = Object.fromEntries([...months.map((m,i)=>[m,dutchMonths[i]]), ...['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'].map((d,i)=>[d,['maandag','dinsdag','woensdag','donderdag','vrijdag','zaterdag','zondag'][i]])]);
  function dateText(value) { return value.replace(/\b(January|February|March|April|May|June|July|August|September|October|November|December|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b/g, word => dateWords[word]); }
  let language = 'en';
  try { language = new URLSearchParams(location.search).get('lang') || localStorage.getItem('luxia-language') || 'en'; } catch (_) {}
  language = language.toLowerCase() === 'nl' ? 'nl' : 'en';
  try { localStorage.setItem('luxia-language', language); } catch (_) {}
  function translate(source) {
    const key = normalize(source);
    const translated = dictionary.get(key);
    if (translated !== undefined) return source.replace(/\S[\s\S]*\S|\S/, translated);
    const country = key.match(/^(\S+)\s+(.+?)\s+\((\+\d+)\)$/u);
    if (country && countries[country[2]]) return `${country[1]} ${countries[country[2]]} (${country[3]})`;
    const patterns = [
      [/^(\d+) available times? on (.+)$/, (_,n,date)=>`${n} beschikbare tijdstippen op ${dateText(date)}`],
      [/^(\d+) available times? in (.+)\.$/, (_,n,date)=>`${n} beschikbare tijdstippen in ${dateText(date)}.`],
      [/^No available times have been published for (.+) yet\.$/, (_,date)=>`Er zijn nog geen beschikbare tijdstippen gepubliceerd voor ${dateText(date)}.`],
      [/^(.+) — available hours$/, (_,date)=>`${dateText(date)} — beschikbare uren`],
      [/^Choose (.+)$/, (_,slot)=>`Kies ${dateText(slot).replace('20-minute consultation','kennismakingsgesprek van 20 minuten').replace('1-hour session','sessie van 1 uur')}`],
      [/^Your verified account details will be used: (.+)\.$/, (_,identity)=>`Je geverifieerde accountgegevens worden gebruikt: ${identity}.`],
      [/^Your account name and email will be used automatically \((.+)\)\. Please add a phone number for this message\.$/, (_,identity)=>`Je accountnaam en e-mailadres worden automatisch gebruikt (${identity}). Voeg een telefoonnummer toe voor dit bericht.`],
      [/^(€[\d.,]+) paid$/, (_,amount)=>`${amount.replace('.',',')} betaald`],
      [/^Connected and synchronized\. Last update: (.+)\.$/, (_,date)=>`Gekoppeld en gesynchroniseerd. Laatste update: ${dateText(date)}.`],
      [/^Connected, but the last synchronization needs attention: (.+)$/, (_,error)=>`Gekoppeld, maar de laatste synchronisatie vereist aandacht: ${dictionary.get(error)||error}`],
      [/^(Adding|Removing) (.+)\.\.\.$/, (_,action,date)=>`${action==='Adding'?'Toevoegen':'Verwijderen'}: ${dateText(date)}...`],
      [/^Calendar updated: (.+)\.$/, (_,date)=>`Agenda bijgewerkt: ${dateText(date)}.`],
      [/^Voice recognition could not continue: (.+)\.$/, (_,error)=>`Spraakherkenning kon niet doorgaan: ${error}.`]
      ,[/^Google Calendar synchronized\. (\d+) Luxia event\(s\) found\.$/, (_,n)=>`Google Agenda gesynchroniseerd. ${n} Luxia-afspraken gevonden.`]
      ,[/^(20 minute consultation|1 hour coaching) with (.+) on (.+)\.$/, (_,label,name,date)=>`${dictionary.get(label)} met ${name==='the client'?'de cliënt':name} op ${dateText(date)}.`]
    ];
    for (const [pattern, replacement] of patterns) if (pattern.test(key)) return key.replace(pattern,replacement);
    if (/^(January|February|March|April|May|June|July|August|September|October|November|December) \d{4}$/.test(key) || / · (20-minute consultation|1-hour session)$/.test(key)) return dateText(key).replace('20-minute consultation','kennismakingsgesprek van 20 minuten').replace('1-hour session','sessie van 1 uur');
    for (const [prefix, replacement] of [['Hi, ', 'Hallo, '], ['Phone: ', 'Telefoon: '], ['Date of birth: ', 'Geboortedatum: '], ['Gender: ', 'Geslacht: '], ['Status: ', 'Status: '], ['Payment: ', 'Betaling: '], ['Booking as ', 'Je boekt als '], ['Request submitted: ', 'Aanvraag ingediend: ']]) {
      if (key.startsWith(prefix)) return replacement + (dictionary.get(key.slice(prefix.length)) || (prefix === 'Request submitted: ' ? translate(key.slice(prefix.length)) : key.slice(prefix.length)));
    }
    return source;
  }
  function update(node, property, sourceValue, write) {
    let records = originals.get(node);
    if (!records) { records = {}; originals.set(node, records); }
    let record = records[property];
    if (!record || sourceValue !== record.rendered) record = records[property] = {source: sourceValue};
    const dateValue = property === 'text' && node.parentElement?.getAttribute('data-luxia-date');
    const result = language === 'nl' ? (dateValue ? new Intl.DateTimeFormat('nl-BE', {dateStyle: 'medium', timeStyle: 'short'}).format(new Date(dateValue)) : translate(record.source)) : record.source;
    record.rendered = result;
    if (result !== sourceValue) write(result);
  }
  function render(root = document.documentElement) {
    if (!root) return;
    const walk = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    function visit(node) {
      if (node.nodeType === Node.TEXT_NODE) {
        if (node.parentElement?.closest('script,style,textarea,[contenteditable], [data-language-menu]')) return;
        if (normalize(node.data)) update(node, 'text', node.data, value => { node.data = value; });
      } else if (node instanceof Element) {
        if (node.matches('option') && !node.hasAttribute('value')) node.setAttribute('value', node.textContent);
        for (const name of ['placeholder', 'title', 'alt', 'aria-label']) {
          if (node.hasAttribute(name) && !node.closest('[data-language-menu]')) update(node, name, node.getAttribute(name), value => node.setAttribute(name, value));
        }
        if (node.matches('meta[name="description"]')) update(node, 'content', node.content, value => { node.content = value; });
      }
    }
    visit(root);
    while (walk.nextNode()) visit(walk.currentNode);
  }
  function menus() {
    document.documentElement.lang = language;
    document.querySelectorAll('[data-language-current]').forEach(node => { node.textContent = language.toUpperCase(); });
    document.querySelectorAll('[data-language-options]').forEach(panel => {
      panel.replaceChildren(...['en', 'nl', 'pl'].map(code => {
        const button = document.createElement('button');
        button.type = 'button'; button.dataset.languageOption = code.toUpperCase(); button.textContent = code.toUpperCase();
        button.disabled = code === 'pl'; button.setAttribute('aria-pressed', String(code === language));
        if (code === 'pl') button.title = language === 'nl' ? 'Binnenkort beschikbaar' : 'Coming soon';
        return button;
      }));
    });
  }
  function sortCountries() {
    document.querySelectorAll('select').forEach(select => {
      if (!Array.from(select.options).some(option => /Belgium|België/.test(option.textContent))) return;
      const selected = select.selectedIndex >= 0 ? select.options[select.selectedIndex] : null;
      const options = Array.from(select.options).sort((a,b)=>a.textContent.replace(/^[^\p{L}]+/u,'').localeCompare(b.textContent.replace(/^[^\p{L}]+/u,''), language === 'nl' ? 'nl-BE' : 'en'));
      select.replaceChildren(...options);
      if (selected) selected.selected = true;
    });
  }
  function setLanguage(next) {
    if (!['en', 'nl'].includes(next.toLowerCase())) return;
    language = next.toLowerCase();
    try { localStorage.setItem('luxia-language', language); } catch (_) {}
    const url = new URL(location.href);
    if (url.searchParams.has('lang')) { url.searchParams.set('lang', language); history.replaceState(null, '', url); }
    document.querySelectorAll('input,select,textarea').forEach(input => { if (input.dataset.luxiaValidation) { input.setCustomValidity(''); delete input.dataset.luxiaValidation; } });
    menus(); render(); sortCountries();
    document.dispatchEvent(new CustomEvent('luxia:languagechange', {detail: {language}}));
  }
  window.LuxiaI18n = {setLanguage, translate: value => language === 'nl' ? translate(value) : value, get language() { return language; }, get locale() { return language === 'nl' ? 'nl-BE' : 'en-GB'; }};
  document.documentElement.lang = language;
  document.addEventListener('click', event => {
    const toggle = event.target.closest?.('[data-language-toggle]');
    if (toggle) {
      event.preventDefault(); event.stopImmediatePropagation();
      const panel = toggle.closest('[data-language-menu]')?.querySelector('[data-language-options]');
      if (panel) { panel.hidden = !panel.hidden; toggle.setAttribute('aria-expanded', String(!panel.hidden)); }
      return;
    }
    const option = event.target.closest?.('[data-language-option]');
    if (!option) return;
    event.preventDefault(); event.stopImmediatePropagation();
    setLanguage(option.dataset.languageOption);
    document.querySelectorAll('[data-language-options]').forEach(panel => { panel.hidden = true; });
    document.querySelectorAll('[data-language-toggle]').forEach(button => button.setAttribute('aria-expanded', 'false'));
  }, true);
  document.addEventListener('invalid', event => {
    const input = event.target;
    if (language !== 'nl' || !input.validity || input.validity.customError) return;
    const validity = input.validity;
    const message = validity.valueMissing ? 'Vul dit verplichte veld in.' : validity.typeMismatch ? (input.type === 'email' ? 'Vul een geldig e-mailadres in.' : 'Vul een geldige waarde in.') : validity.tooShort ? `Gebruik minstens ${input.minLength} tekens.` : validity.patternMismatch ? 'Gebruik het gevraagde formaat.' : validity.rangeUnderflow || validity.rangeOverflow ? 'Kies een waarde binnen het toegestane bereik.' : 'Controleer de ingevulde waarde.';
    input.setCustomValidity(message); input.dataset.luxiaValidation = 'true';
  }, true);
  document.addEventListener('input', event => {
    if (event.target.dataset?.luxiaValidation) { event.target.setCustomValidity(''); delete event.target.dataset.luxiaValidation; }
  });
  document.addEventListener('DOMContentLoaded', () => {
    menus(); render(); sortCountries();
    new MutationObserver(records => {
      for (const record of records) {
        if (record.type === 'characterData') render(record.target);
        else if (record.type === 'attributes') render(record.target);
        else record.addedNodes.forEach(node => { if (node.nodeType === 1 || node.nodeType === 3) render(node); });
      }
    }).observe(document.documentElement, {subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['placeholder', 'title', 'alt', 'aria-label', 'content']});
  });
})();
