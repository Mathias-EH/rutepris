// Rutepris – frontend. Snakker bare med vår egen backend (/api/…).

import { EN, EN_MØNSTRE } from './sprak.js';

const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------- Språk ---
// Norsk er kildespråket. tr('norsk tekst') gir teksten på valgt språk; engelsk ligger i sprak.js.
// Norsk er standard for alle. Engelsk velges med EN-knappen, og valget huskes på enheten.
let språk = (() => {
  try { if (localStorage.getItem('rutepris-sprak') === 'en') return 'en'; } catch { /* lagring er valgfri */ }
  return 'nb';
})();
function tr(nb, vars) {
  let s = nb;
  if (språk === 'en' && nb) {
    s = EN[nb];
    if (s == null) { s = nb; for (const [mønster, engelsk] of EN_MØNSTRE) if (mønster.test(nb)) { s = nb.replace(mønster, engelsk); break; } }
  }
  return vars ? String(s).replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '') : s;
}
/** Detaljlinja i søkeforslag («Tettsted, nær Uddevalla, Sverige») oversettes ledd for ledd. */
const trDetalj = (d) => (språk === 'en' && d ? d.split(', ').map((x) => tr(x)).join(', ') : d);
const el = (tag, attrs = {}, ...barn) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v; else if (k === 'text') n.textContent = v; else if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else n.setAttribute(k, v === true ? '' : v);
  }
  for (const b of barn.flat(3)) if (b != null && b !== false) n.append(b.nodeType ? b : document.createTextNode(String(b)));
  return n;
};
const SVG = 'http://www.w3.org/2000/svg';
/** Ikon fra symbolene i index.html. */
const ikon = (navn) => {
  const s = document.createElementNS(SVG, 'svg');
  s.setAttribute('class', 'ikon');
  s.setAttribute('aria-hidden', 'true');
  const u = document.createElementNS(SVG, 'use');
  u.setAttribute('href', `#i-${navn}`);
  s.append(u);
  return s;
};
const ikonHtml = (navn) => `<svg class="ikon" aria-hidden="true"><use href="#i-${navn}"/></svg>`;

const tall = (x, desimaler) => new Intl.NumberFormat('nb-NO', { minimumFractionDigits: desimaler, maximumFractionDigits: desimaler }).format(x);
const kr = (x) => `${tall(x, Number.isInteger(x) ? 0 : 2)} kr`;
const km = (x) => `${tall(x, 1)} km`;
const tid = (sek) => { const m = Math.round(sek / 60); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} ${tr('t')} ${m % 60} min`; };
const dato = (iso) => { const [a, m, d] = iso.split('-'); return `${Number(d)}.${Number(m)}.${a}`; };
const roligModus = matchMedia('(prefers-reduced-motion: reduce)').matches;

const FARGER = { raskeste: '--rute-raskeste', kompromiss: '--rute-kompromiss', billigste: '--rute-billigste' };
// Returen tegnes i en farge som skiller seg tydelig fra turen
const RETURFARGE = { raskeste: '--rosa', kompromiss: '--turkis', billigste: '--turkis' };
const RUTEIKON = { raskeste: 'klokke', kompromiss: 'vekt', billigste: 'spart' };
const cssFarge = (navn) => getComputedStyle(document.documentElement).getPropertyValue(navn).trim();
const erMobil = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
// Berøringsskjerm som hovedinngang (mobil og nettbrett): tastaturet skjules etter valg, og kartet flyttes med to fingre
const berøring = matchMedia('(pointer: coarse)').matches;

const tilstand = { steder: { fra: null, til: null }, svar: null, valgt: null, standardForbruk: null, lag: [] };

function toast(tekst) {
  const t = $('toast');
  t.hidden = true; void t.offsetWidth; // start animasjonen på nytt
  t.textContent = tekst; t.hidden = false;
  clearTimeout(toast.tidtaker);
  toast.tidtaker = setTimeout(() => { t.hidden = true; }, 2300);
}

// ----------------------------------------------------------------- Tema ---

$('temaKnapp').addEventListener('click', () => {
  const rot = document.documentElement;
  const mørkNå = rot.dataset.tema ? rot.dataset.tema === 'mork' : matchMedia('(prefers-color-scheme: dark)').matches;
  rot.dataset.tema = mørkNå ? 'lys' : 'mork';
  try { localStorage.setItem('tema', rot.dataset.tema); } catch { /* lagring er valgfri */ }
  if (tilstand.svar) tegnKart(false);
});

// ----------------------------------------------------------------- Kart ---

// fadeAnimation av: ellers får hver kartflis sitt eget lag i nettleseren og tones inn bilde for bilde.
// På store skjermer kunne det stoppe opp halvveis, slik at kartet ble stående med hull til musa ble flyttet.
// På berøringsskjerm er én-fingers flytting slått av, så siden kan rulles forbi kartet. To fingre flytter og zoomer.
const kart = L.map('kart', { zoomControl: true, attributionControl: true, fadeAnimation: false, dragging: !berøring }).setView([64.5, 12.5], 5);
// Krediteringen kan ikke fjernes: OpenStreetMaps lisens krever at den står synlig på kartet. Den er gjort så kort som retningslinjene tillater.
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '<a href="https://www.openstreetmap.org/copyright">&copy; OpenStreetMap</a>' }).addTo(kart);
kart.attributionControl.setPrefix(false);
if (berøring) {
  // Én finger på kartet: vis kort hvordan det flyttes
  let hintTidtaker = null;
  $('kart').addEventListener('touchmove', (e) => {
    if (e.touches.length !== 1) { $('karthint').hidden = true; return; }
    $('karthint').hidden = false;
    clearTimeout(hintTidtaker);
    hintTidtaker = setTimeout(() => { $('karthint').hidden = true; }, 1400);
  }, { passive: true });
}
// Kartet må måles på nytt når flaten endrer størrelse (vindu, mobilvisning, panel som åpnes)
new ResizeObserver(() => kart.invalidateSize()).observe($('kart'));

function dekodPolyline(tekst, presisjon = 5) {
  const f = 10 ** presisjon, ut = [];
  let i = 0, lat = 0, lon = 0;
  while (i < tekst.length) {
    for (const akse of [0, 1]) {
      let res = 0, skift = 0, b;
      do { b = tekst.charCodeAt(i++) - 63; res |= (b & 0x1f) << skift; skift += 5; } while (b >= 0x20);
      const d = res & 1 ? ~(res >> 1) : res >> 1;
      if (akse === 0) lat += d; else lon += d;
    }
    ut.push([lat / f, lon / f]);
  }
  return ut;
}

/** Rundt kartmerke med ikon. `forsinkelse` gir en liten bølge når mange merker dukker opp. */
const kartmerke = (klasse, ikonnavn, forsinkelse = 0, stort = false) => L.divIcon({
  className: '', iconSize: stort ? [34, 34] : [28, 28], iconAnchor: stort ? [17, 17] : [14, 14], popupAnchor: [0, -14],
  html: `<div class="kartmerke ${klasse}${stort ? ' stort' : ''}" style="animation-delay:${forsinkelse}ms">${ikonHtml(ikonnavn)}</div>`,
});
const STATUSKLASSE = { betalt: 'betalt', ukjent: 'ukjent', 'gratis-timesregel': 'gratis', gratis: 'gratis', unngaatt: 'unngaatt' };

function bomPopup(m) {
  // Pris vises alltid: det du betaler, eller det bommen ville kostet når den er unngått eller dekket av timesregel.
  const ordinær = m.ordinarPris == null ? tr('pris ukjent') : kr(m.ordinarPris);
  const pris = m.status === 'unngaatt' ? `${tr('Unngått')} · ${ordinær}`
    : m.status === 'ukjent' ? tr('Pris ukjent')
    : m.status === 'gratis-timesregel' ? tr('0 kr (timesregel) · ordinært {pris}', { pris: ordinær })
    : kr(m.pris);
  return el('div', {},
    el('b', { text: m.navn }), el('br'),
    el('span', { text: [pris, m.tid && tr('kl. {tid}', { tid: m.tid }), m.rush && tr('rush')].filter(Boolean).join(' · ') }),
    el('span', { class: 'under', text: m.prosjektNavn }));
}
function ferjePopup(f) {
  return el('div', {},
    el('b', { text: f.navn }), el('br'),
    el('span', { text: [f.status === 'ukjent' ? tr('Pris ukjent') : kr(f.pris), f.avgang && tr('avgang {tid}', { tid: f.avgang })].filter(Boolean).join(' · ') }),
    f.avgang ? el('span', { class: 'under', text: tr('{min} min venting · framme {tid}', { min: f.ventMinutter, tid: f.ankomst }) }) : el('span', { class: 'under', text: tr('Ferje') }));
}

function tegnKart(animer = true) {
  for (const lag of tilstand.lag) lag.remove();
  tilstand.lag = [];
  const { svar, valgt } = tilstand;
  if (!svar) return;
  const flate = cssFarge('--flate');
  const legg = (lag) => { tilstand.lag.push(lag.addTo(kart)); return lag; };

  // Ikke-valgte ruter først (stiplet), valgt rute øverst
  const rekkefølge = [...svar.ruter].sort((a, b) => Number(a.id === valgt) - Number(b.id === valgt));
  let grenser = null;
  for (const r of rekkefølge) {
    const aktiv = r.id === valgt;
    const farge = cssFarge(FARGER[r.id]);
    r.etapper.forEach((e, nr) => {
      e.punkter ||= dekodPolyline(e.geometri);
      // Returen får egen farge og tegnes smalere oppå turen, slik at begge synes der de følger samme vei
      const retur = aktiv && nr === 1;
      if (aktiv) legg(L.polyline(e.punkter, { color: flate, weight: retur ? 6 : 11, opacity: .9, interactive: false }));
      const linje = legg(L.polyline(e.punkter, { color: retur ? cssFarge(RETURFARGE[r.id]) : farge, weight: retur ? 3.5 : aktiv ? 7 : 4, opacity: aktiv ? 1 : .55, dashArray: aktiv ? null : '2 9', lineCap: 'round' }));
      linje.on('click', () => velgRute(r.id));
      linje.bindTooltip(`${tr(r.tittel)}${e.navn ? ` (${tr(e.navn).toLowerCase()})` : ''} · ${tid(r.sekunder)} · ${kr(r.bompenger.total)}`, { sticky: true });
      // Den valgte ruta tegnes opp fra start til mål (returen litt etter turen)
      if (aktiv && animer && !roligModus) { const sti = linje.getElement(); if (sti) { sti.setAttribute('pathLength', '1'); sti.classList.add('rute-tegn'); if (retur) sti.style.animationDelay = '.5s'; } }
      grenser = grenser ? grenser.extend(linje.getBounds()) : linje.getBounds();
    });
  }

  const rute = svar.ruter.find((r) => r.id === valgt);
  let nr = 0;
  for (const e of rute.etapper) {
    for (const m of e.markører) {
      legg(L.marker([m.lat, m.lon], { icon: kartmerke(STATUSKLASSE[m.status] || 'betalt', 'bom', animer ? 300 + nr++ * 45 : 0), title: m.navn })).bindPopup(bomPopup(m));
    }
    for (const f of e.ferjer || []) {
      if (!f.fra || !f.til) continue;
      legg(L.marker([(f.fra[0] + f.til[0]) / 2, (f.fra[1] + f.til[1]) / 2], { icon: kartmerke('ferje', 'ferje', animer ? 300 + nr++ * 45 : 0, true), title: f.navn, zIndexOffset: 500 })).bindPopup(ferjePopup(f));
    }
  }
  legg(L.marker([svar.fra.lat, svar.fra.lon], { icon: kartmerke('start', 'bil', 0, true), title: svar.fra.navn, zIndexOffset: 1000, keyboard: false })).bindPopup(el('b', { text: svar.fra.navn }));
  legg(L.marker([svar.til.lat, svar.til.lon], { icon: kartmerke('maal', 'flagg', 0, true), title: svar.til.navn, zIndexOffset: 1000, keyboard: false })).bindPopup(el('b', { text: svar.til.navn }));

  if (grenser && tilstand.tilpassKart) { kart.invalidateSize({ animate: false }); kart.fitBounds(grenser, { padding: [40, 40], animate: false }); tilstand.tilpassKart = false; }
  for (const n of document.querySelectorAll('.tegnforklaring .bare-retur')) n.hidden = rute.etapper.length < 2;
  $('tegnforklaring').style.setProperty('--tur', cssFarge(FARGER[rute.id]));
  $('tegnforklaring').style.setProperty('--retur', cssFarge(RETURFARGE[rute.id]));
  $('tegnforklaring').hidden = false;
}

// ---------------------------------------------------------- Stedssøk ------

function settOppSøk(felt) {
  const inn = $(felt), liste = $(`${felt}Liste`);
  let treff = [], aktiv = -1, teller = 0, tidtaker = null;

  const lukk = () => { liste.hidden = true; inn.setAttribute('aria-expanded', 'false'); aktiv = -1; };
  // Etter valg skjules skjermtastaturet på mobil. På PC beholdes fokus, så Tab går videre til neste felt.
  const velg = (t) => { tilstand.steder[felt] = t; inn.value = t.navn + (t.type === 'adresse' ? `, ${t.detalj}` : ''); lukk(); if (berøring) inn.blur(); };
  const tegn = (tom) => {
    liste.replaceChildren(...(treff.length
      ? treff.map((t, i) => el('li', { role: 'option', id: `${felt}-valg-${i}`, 'aria-selected': i === aktiv ? 'true' : 'false', onmousedown: (e) => { e.preventDefault(); velg(t); } },
        el('span', { text: t.navn }), el('span', { class: 'detalj', text: trDetalj(t.detalj) })))
      : [el('li', { class: 'tom', text: tom })]));
    liste.hidden = false;
    inn.setAttribute('aria-expanded', 'true');
    if (aktiv >= 0) inn.setAttribute('aria-activedescendant', `${felt}-valg-${aktiv}`); else inn.removeAttribute('aria-activedescendant');
  };

  inn.addEventListener('input', () => {
    tilstand.steder[felt] = null;
    clearTimeout(tidtaker);
    const q = inn.value.trim();
    if (q.length < 2) { lukk(); return; }
    tidtaker = setTimeout(async () => {
      const min = ++teller;
      try {
        const svar = await fetch(`/api/sok?q=${encodeURIComponent(q)}`).then((r) => r.json());
        if (min !== teller || document.activeElement !== inn) return; // utdatert svar, eller feltet er forlatt
        treff = svar.treff || []; aktiv = -1;
        tegn(tr(svar.feil || 'Ingen treff'));
      } catch { if (min === teller) { treff = []; tegn(tr('Adressesøket svarer ikke')); } }
    }, 220);
  });
  inn.addEventListener('keydown', (e) => {
    if (liste.hidden || !treff.length) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); aktiv = (aktiv + (e.key === 'ArrowDown' ? 1 : -1) + treff.length) % treff.length; tegn(); }
    else if (e.key === 'Enter' && aktiv >= 0) { e.preventDefault(); velg(treff[aktiv]); }
    // Enter på skjermtastaturet uten å ha pekt på et forslag: ta det øverste, og skjul tastaturet
    else if (e.key === 'Enter' && berøring) { e.preventDefault(); velg(treff[0]); }
    else if (e.key === 'Escape') lukk();
  });
  inn.addEventListener('blur', () => setTimeout(lukk, 120));
  inn.addEventListener('focus', () => { if (treff.length && !tilstand.steder[felt] && inn.value.trim().length >= 2) tegn(); });
  // Brukes når skjemaet sendes: avbryt ventende oppslag og lukk lista
  return () => { clearTimeout(tidtaker); teller++; lukk(); };
}
const lukkSøk = [settOppSøk('fra'), settOppSøk('til')];

/** Brukeren skrev uten å velge fra lista: bruk beste treff. */
async function løsSted(felt) {
  if (tilstand.steder[felt]) return tilstand.steder[felt];
  const q = $(felt).value.trim();
  if (q.length < 2) throw new Error(tr(felt === 'fra' ? 'Skriv inn hvor du kjører fra.' : 'Skriv inn hvor du skal.'));
  const svar = await fetch(`/api/sok?q=${encodeURIComponent(q)}`).then((r) => r.json());
  if (!svar.treff?.length) throw new Error(tr('Fant ikke «{q}».', { q }));
  const t = svar.treff[0];
  tilstand.steder[felt] = t;
  $(felt).value = t.navn + (t.type === 'adresse' ? `, ${t.detalj}` : '');
  return t;
}

$('byttKnapp').addEventListener('click', () => {
  [tilstand.steder.fra, tilstand.steder.til] = [tilstand.steder.til, tilstand.steder.fra];
  [$('fra').value, $('til').value] = [$('til').value, $('fra').value];
});

// ------------------------------------------------------- Skjemafelter -----

const nåINorge = () => {
  const d = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Oslo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date()).map((p) => [p.type, p.value]));
  return `${d.year}-${d.month}-${d.day}T${d.hour}:${d.minute}`;
};
/** «2026-11-12T12:00» + minutter -> samme format. */
const plussMinutter = (lokal, minutter) => new Date(Date.parse(`${lokal}:00Z`) + minutter * 60000).toISOString().slice(0, 16);

$('avreise').value = nåINorge();
$('naaKnapp').addEventListener('click', () => { $('avreise').value = nåINorge(); oppdaterForbruksfelt(); });
// Tur/retur: returen starter alltid rett etter ankomst, så det er ikke noe eget felt for returtid.

const energiIkon = (drivstoff) => (drivstoff === 'elbil' ? 'strom' : 'drivstoff');
const DRIVSTOFFNAVN = { elbil: 'elbil', bensin: 'bensin', diesel: 'diesel', hybrid: 'ladbar hybrid', tung: 'tungt kjøretøy' };

// Bilen og valgene huskes på denne enheten (localStorage). Ingenting sendes videre.
const husk = {
  les(nokkel) { try { return JSON.parse(localStorage.getItem(nokkel)); } catch { return null; } },
  skriv(nokkel, verdi) { try { localStorage.setItem(nokkel, JSON.stringify(verdi)); } catch { /* lagring er valgfri */ } },
};

/** WLTP-forbruk regnet om til forbruk på veien (samme regler som serveren, se src/pris.js). */
function realistisk(wltp, drivstoff) {
  const f = tilstand.faktor;
  if (!f) return null;
  if (drivstoff === 'hybrid') return f.ladbarHybridLiter;
  if (!(wltp > 0)) return null;
  const vinter = [11, 12, 1, 2, 3].includes(Number($('avreise').value.slice(5, 7)));
  return Math.round(wltp * (drivstoff === 'elbil' ? (vinter ? f.elbilVinter : f.elbilSommer) : f.fossil) * 10) / 10;
}

/** Forbruket som brukes hvis feltet står tomt: bilens eget (fra regnr) eller standard for drivstofftypen. */
function standardForbruk() {
  const drivstoff = $('drivstoff').value;
  const s = tilstand.standardForbruk?.[drivstoff];
  if (!s) return null;
  const bil = tilstand.bil?.drivstoff === drivstoff ? tilstand.bil : null;
  return { per100km: (bil && realistisk(bil.wltp, drivstoff)) ?? s.per100km ?? realistisk(s.wltp, drivstoff), pris: s.pris, hurtigpris: s.hurtigpris, enhet: s.enhet, fraBil: !!(bil && bil.wltp) };
}

function oppdaterForbruksfelt() {
  const drivstoff = $('drivstoff').value;
  const s = standardForbruk();
  if (!s) return;
  const elbil = drivstoff === 'elbil';
  const enhet = s.enhet === 'kWh' ? 'kWh' : 'liter';
  $('energiIkon').setAttribute('href', `#i-${energiIkon(drivstoff)}`);
  $('forbrukTittel').textContent = elbil ? 'Forbruk og strøm' : 'Forbruk';
  $('forbrukEtikett').textContent = `${enhet}/100 km`;
  $('prisEtikett').textContent = elbil ? 'kr/kWh hjemme' : `kr/${enhet}`;
  $('forbruk').placeholder = tall(s.per100km, 1);
  // Hjemmeprisen for elbil hentes fra strømprisen for startstedet når du søker
  $('energipris').placeholder = elbil ? 'automatisk' : tall(s.pris, 2);
  $('hurtigpris').placeholder = s.hurtigpris ? tall(s.hurtigpris, 2) : '';
  $('stromRad').hidden = !elbil;
  const bil = tilstand.bil;
  $('bilnavn').hidden = !bil;
  if (bil) {
    // Registeret mangler forbrukstall for en del biler. Da brukes standardverdien, og feltet åpnes så den kan rettes.
    const mangler = !s.fraBil && bil.drivstoff !== 'hybrid';
    const navn = [bil.merke, bil.modell?.toLowerCase().startsWith(String(bil.merke).toLowerCase()) ? bil.modell.slice(String(bil.merke).length).trim() : bil.modell].filter(Boolean).join(' ');
    $('bilnavn').textContent = `${navn} · ${tr(DRIVSTOFFNAVN[bil.drivstoff])} · ${mangler ? tr('forbruk ikke registrert, bruker {tall}', { tall: tall(Number($('forbruk').value) || s.per100km, 1) }) : tall(s.per100km, 1)} ${enhet === 'liter' ? tr('liter/100 km') : `${enhet}/100 km`}`;
  }
}
// Forbruk, drivstoffpris og hurtigladepris settes med glidebryterne i rutekortet og huskes på enheten.
// Hjemmelading regnes alltid med spotpris etter strømstøtte.
const VALGFELT = ['avtale', 'hurtigpris', 'forbruk', 'energipris'];
function lagreValg() {
  husk.skriv('bomruta-valg', { drivstoff: $('drivstoff').value, ferjer: $('ferjer').checked, utenRegnr: !!tilstand.utenRegnr, ...Object.fromEntries(VALGFELT.map((id) => [id, $(id).value])) });
}
/**
 * Skjemaet viser enten registreringsnummer eller biltype. Biltype brukes når oppslag ikke er satt opp,
 * eller når du har valgt biltype uten registreringsnummer på oppstartssiden (tilstand.utenRegnr).
 */
function visBilfelt() {
  const medRegnr = !!tilstand.krevRegnr && !tilstand.utenRegnr;
  $('regnrFelt').hidden = !medRegnr;
  $('drivstoffFelt').hidden = medRegnr;
}
$('ferjer').addEventListener('change', lagreValg);
$('drivstoff').addEventListener('change', () => { for (const id of ['forbruk', 'energipris', 'hurtigpris']) $(id).value = ''; oppdaterForbruksfelt(); lagreValg(); });
for (const id of VALGFELT) $(id).addEventListener('change', lagreValg);
$('avreise').addEventListener('change', oppdaterForbruksfelt); // årstiden påvirker elbilforbruket

// ---- Registreringsnummer ----
const normRegnr = (s) => s.toUpperCase().replace(/[\s-]/g, '');

async function slåOppBil() {
  const regnr = normRegnr($('regnr').value);
  if (!regnr) { tilstand.bil = null; oppdaterForbruksfelt(); throw new Error(tr('Skriv inn registreringsnummeret til bilen.')); }
  if (tilstand.bil?.regnr === regnr) return tilstand.bil;
  const res = await fetch(`/api/kjoretoy?regnr=${encodeURIComponent(regnr)}`);
  const svar = await res.json();
  if (!res.ok) { tilstand.bil = null; oppdaterForbruksfelt(); throw new Error(tr(svar.feil || 'Fant ikke bilen.')); }
  tilstand.bil = svar;
  tilstand.utenRegnr = false;
  visBilfelt();
  $('regnr').value = regnr;
  $('drivstoff').value = svar.drivstoff;
  for (const id of ['forbruk', 'energipris', 'hurtigpris']) $(id).value = '';
  husk.skriv('bomruta-bil', svar);
  oppdaterForbruksfelt();
  lagreValg();
  return svar;
}
$('regnr').addEventListener('change', () => { visFeil(''); slåOppBil().catch((e) => visFeil(e.message)); });

const metaKlar = fetch('/api/meta').then((r) => r.json()).then((meta) => {
  tilstand.standardForbruk = meta.standardForbruk;
  tilstand.faktor = meta.forbruksfaktor;
  tilstand.hjemmeladetAndel = meta.hjemmeladetAndel;
  tilstand.krevRegnr = !!meta.kjoretoyoppslag;
  tilstand.priserOppdatert = meta.priserSistOppdatert;
  visOppdatert();
  // Hent fram det som er husket på denne enheten
  const valg = husk.les('bomruta-valg');
  if (valg) {
    if (valg.drivstoff && tilstand.standardForbruk[valg.drivstoff]) $('drivstoff').value = valg.drivstoff;
    for (const id of VALGFELT) if (valg[id] != null && valg[id] !== '') $(id).value = valg[id];
    if (valg.ferjer === false) $('ferjer').checked = false;
    tilstand.utenRegnr = !!valg.utenRegnr;
  }
  if (tilstand.krevRegnr && !tilstand.utenRegnr) {
    // Med regnr-oppslag bestemmes kjøretøytypen av bilen, ikke av nedtrekkslista
    const bil = husk.les('bomruta-bil');
    if (bil?.regnr && bil.drivstoff) { tilstand.bil = bil; $('regnr').value = bil.regnr; $('drivstoff').value = bil.drivstoff; }
  }
  // Elbil har ikke bryter for forbruk: et tall husket fra før skal ikke henge igjen uten å kunne endres
  if ($('drivstoff').value === 'elbil') $('forbruk').value = '';
  visBilfelt();
  // Oppstartssiden spør etter registreringsnummer bare når oppslag er slått på. Biltype kan alltid velges.
  $('startRegnrFelt').hidden = !tilstand.krevRegnr;
  $('startEller').hidden = !tilstand.krevRegnr;
  if (tilstand.bil) $('startRegnr').value = tilstand.bil.regnr;
  oppdaterForbruksfelt();
}).catch(() => {});

// ------------------------------------------------------ Oppstartsside -----
//
// Vises første gang på en enhet (se skriptet i <head>). «Kom i gang» slår opp bilen hvis et
// registreringsnummer er skrevet inn, og åpner så selve siden. Feltet kan stå tomt.

function lukkStart() {
  try { localStorage.setItem('rutepris-start', '1'); } catch { /* lagring er valgfri */ }
  $('start').classList.add('ut');
  if (berøring) document.activeElement?.blur?.();
  window.scrollTo(0, 0); // selve siden skal alltid starte øverst
  setTimeout(() => { delete document.documentElement.dataset.start; window.scrollTo(0, 0); kart.invalidateSize(); if (!erMobil && !berøring) $('fra').focus(); }, roligModus ? 0 : 380);
}
/** Logoen i toppen åpner oppstartssiden igjen, med bilen du har lagt inn. */
function visStart() {
  $('startRegnr').value = tilstand.bil?.regnr || '';
  $('startBil').hidden = true;
  $('startFeil').hidden = true;
  merkBiltype();
  $('start').classList.remove('ut');
  document.documentElement.dataset.start = 'ja';
}
$('hjemKnapp').addEventListener('click', visStart);

// Uten registreringsnummer: velg biltype. Da brukes gjennomsnittstall for typen (se STANDARD_FORBRUK i src/pris.js).
const merkBiltype = () => { for (const k of document.querySelectorAll('.typevalg')) k.setAttribute('aria-pressed', String(!!tilstand.utenRegnr && k.dataset.type === $('drivstoff').value)); };
for (const k of document.querySelectorAll('.typevalg')) {
  k.addEventListener('click', () => {
    tilstand.utenRegnr = true;
    tilstand.bil = null;
    $('regnr').value = '';
    $('drivstoff').value = k.dataset.type;
    for (const id of ['forbruk', 'energipris', 'hurtigpris']) $(id).value = '';
    visBilfelt();
    oppdaterForbruksfelt();
    lagreValg();
    merkBiltype();
    lukkStart();
  });
}

$('startSkjema').addEventListener('submit', async (e) => {
  e.preventDefault();
  const feil = (tekst) => { $('startFeil').textContent = tekst; $('startFeil').hidden = !tekst; };
  feil('');
  const regnr = normRegnr($('startRegnr').value);
  if (regnr && tilstand.krevRegnr) {
    const knapp = $('startKnapp');
    knapp.disabled = true;
    try {
      $('regnr').value = regnr;
      const bil = await slåOppBil();
      // Vis bilen et øyeblikk, så brukeren ser at riktig bil ble funnet
      const merke = String(bil.merke || ''), modell = String(bil.modell || '');
      $('startBil').textContent = [merke, modell.toLowerCase().startsWith(merke.toLowerCase()) ? modell.slice(merke.length).trim() : modell].filter(Boolean).join(' ');
      $('startBil').hidden = false;
      await new Promise((r) => setTimeout(r, roligModus ? 0 : 700));
    } catch (err) {
      $('regnr').value = '';
      feil(err.message || tr('Fant ikke bilen.'));
      return;
    } finally {
      knapp.disabled = false;
    }
  }
  lukkStart();
});

// ------------------------------------------------------ Delbar lenke ------

const stedTilParam = (s) => `${s.lat.toFixed(5)},${s.lon.toFixed(5)},${s.navn}`;
function paramTilSted(p) {
  const m = String(p || '').match(/^(-?[\d.]+),(-?[\d.]+),(.*)$/);
  return m ? { lat: Number(m[1]), lon: Number(m[2]), navn: m[3] || `${m[1]}, ${m[2]}`, type: 'sted' } : null;
}
/** Legger søket i adressen, slik at siden kan deles eller lastes på nytt. Bilen (regnr) er ikke med. */
function oppdaterAdresse(svar) {
  const p = new URLSearchParams({ fra: stedTilParam(svar.fra), til: stedTilParam(svar.til), tid: svar.avreise });
  if (svar.retur) p.set('retur', 'auto');
  if (!tilstand.krevRegnr || tilstand.utenRegnr) p.set('bil', svar.kjoretoy.drivstoff);
  if (!svar.kjoretoy.avtale) p.set('brikke', 'nei');
  if (svar.ferjer === false) p.set('ferjer', 'nei');
  history.replaceState(null, '', `${location.pathname}?${p}`);
}
async function delLenke() {
  try { await navigator.clipboard.writeText(location.href); toast(tr('Lenke kopiert')); } catch { prompt(tr('Kopier lenken:'), location.href); }
}
/** Åpnet med en delt lenke: fyll ut skjemaet og søk. */
async function lesAdresse() {
  const p = new URLSearchParams(location.search);
  const fra = paramTilSted(p.get('fra')), til = paramTilSted(p.get('til'));
  if (!fra || !til) return;
  await metaKlar;
  tilstand.steder = { fra, til };
  $('fra').value = fra.navn; $('til').value = til.navn;
  if (/^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(p.get('tid') || '')) $('avreise').value = p.get('tid');
  if (p.get('retur')) $('turRetur').checked = true; // eldre lenker med klokkeslett regnes også som «ved ankomst»
  // Lenka har biltype når den ble laget uten registreringsnummer: da trengs ikke noe oppslag her heller
  if (tilstand.standardForbruk?.[p.get('bil')]) {
    if (tilstand.krevRegnr) { tilstand.utenRegnr = true; tilstand.bil = null; visBilfelt(); }
    $('drivstoff').value = p.get('bil');
  }
  if (p.get('brikke') === 'nei') $('avtale').value = 'nei';
  $('ferjer').checked = p.get('ferjer') !== 'nei';
  oppdaterForbruksfelt();
  if (!tilstand.krevRegnr || tilstand.bil || tilstand.utenRegnr) $('skjema').requestSubmit();
}
lesAdresse();

// --------------------------------------------------------------- Søk ------

function visFeil(tekst) { $('feil').textContent = tekst; $('feil').hidden = !tekst; }
const tallfelt = (id) => ($(id).value === '' ? undefined : Number($(id).value.replace(',', '.')));

$('skjema').addEventListener('submit', async (e) => {
  e.preventDefault();
  visFeil('');
  if (berøring) document.activeElement?.blur?.(); // skjul skjermtastaturet når søket starter
  for (const lukk of lukkSøk) lukk();
  const knapp = $('sokKnapp');
  knapp.disabled = true;
  $('resultat').replaceChildren(el('div', { class: 'skjelett' }), el('div', { class: 'skjelett' }), el('div', { class: 'skjelett' }));
  try {
    if (tilstand.krevRegnr && !tilstand.utenRegnr) await slåOppBil(); // bilen må være kjent før vi beregner
    const [fra, til] = [await løsSted('fra'), await løsSted('til')];
    const s = standardForbruk();
    const forbruk = { per100km: tallfelt('forbruk') ?? (s?.fraBil ? s.per100km : undefined), pris: tallfelt('energipris'), hurtigpris: tallfelt('hurtigpris'), rekkevidde: tilstand.bil?.rekkevidde ?? undefined };
    const res = await fetch('/api/ruter', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fra, til, avreise: $('avreise').value,
        retur: $('turRetur').checked ? 'auto' : null,
        ferjer: $('ferjer').checked,
        kjoretoy: { drivstoff: $('drivstoff').value, avtale: $('avtale').value === 'ja' },
        forbruk, strom: { avtale: $('stromavtale').value },
      }),
    });
    const svar = await res.json();
    if (!res.ok) throw new Error(tr(svar.feil || 'Noe gikk galt.'));
    lagreValg();
    tilstand.svar = svar;
    tilstand.valgt = svar.ruter[0].id; // raskeste rute er valgt når resultatet vises
    tilstand.tilpassKart = true;
    oppdaterAdresse(svar);
    tegnResultat();
    tegnKart();
    if (matchMedia('(max-width: 860px)').matches) $('resultat').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    $('resultat').replaceChildren();
    visFeil(err.message || tr('Noe gikk galt.'));
  } finally {
    knapp.disabled = false;
  }
});

function velgRute(id) {
  if (tilstand.valgt === id) return;
  tilstand.valgt = id;
  for (const kort of document.querySelectorAll('.kort')) kort.setAttribute('aria-pressed', String(kort.dataset.id === id));
  tegnKart();
}

// ---------------------------------------------------------- Resultat ------

const medIkon = (klasse, navn, tekst, tittel) => el('span', { class: klasse, title: tittel, 'aria-label': `${tittel}: ${tekst}` }, ikon(navn), tekst);

/** Teller prisen opp fra null – en liten animasjon når kortene dukker opp. */
function tellOpp(node, verdi, suffiks = '') {
  node.textContent = kr(verdi) + suffiks; // riktig verdi står der uansett, også om animasjonen aldri kjører (skjult fane)
  if (roligModus || tilstand.stille || !(verdi > 0) || document.hidden) return;
  const start = performance.now(), varighet = 550;
  const steg = (nå) => {
    const t = Math.min(1, (nå - start) / varighet), myk = 1 - (1 - t) ** 3;
    node.textContent = (t < 1 ? `${tall(verdi * myk, Number.isInteger(verdi) ? 0 : 2)} kr` : kr(verdi)) + suffiks;
    if (t < 1) requestAnimationFrame(steg);
  };
  requestAnimationFrame(steg);
}

function bomlinje(l) {
  const gratis = l.status === 'gratis-timesregel' || l.status === 'gratis';
  return el('li', { class: gratis ? 'gratis' : '' },
    el('span', { class: 'kl', text: l.tid }),
    el('span', { class: 'navn' }, l.navn,
      l.rush ? el('span', { class: 'tagg rush', text: tr('Rush') }) : null,
      l.status === 'gratis-timesregel' ? el('span', { class: 'tagg', text: tr('Timesregel'), title: tr(l.forklaring) }) : null,
      l.usikker ? el('span', { class: 'tagg usikker', text: tr('Usikker'), title: l.usikkerGrunner.join(' ') }) : null,
      // Utenlandske avgifter: vis også beløpet i landets valuta, og hvorfor det eventuelt er 0
      el('span', { class: 'under', text: [l.prosjektNavn, l.utenlandsk, !l.utenlandsk && l.status === 'gratis' && /denne dagen|dette tidspunktet/.test(l.forklaring) ? tr(l.forklaring) : null].filter(Boolean).join(' · ') })),
    el('span', { class: 'belop' },
      l.status === 'gratis-timesregel' && l.ordinarPris ? el('s', { text: kr(l.ordinarPris) }) : null,
      l.status === 'ukjent' ? tr('ukjent') : kr(l.pris)));
}

function ferjelinje(f) {
  const under = [f.avgang ? tr('Avgang {tid}, {min} min venting', { tid: f.avgang, min: f.ventMinutter }) : tr('Ferje'), f.forskuddPris != null && f.status === 'betalt' ? tr('{pris} med forskuddsavtale', { pris: kr(f.forskuddPris) }) : null].filter(Boolean).join(' · ');
  return el('li', { class: f.status === 'gratis' ? 'gratis' : '' },
    el('span', { class: 'kl' }, ikon('ferje')),
    el('span', { class: 'navn' }, f.navn,
      f.turRetur ? el('span', { class: 'tagg', text: tr('Tur/retur'), title: tr('Betales bare én vei. Prisen gjelder tur/retur.') }) : null,
      el('span', { class: 'under', text: under })),
    el('span', { class: 'belop', text: f.status === 'ukjent' ? tr('ukjent') : kr(f.pris) }));
}

/** Slik er energien regnet ut. */
function energiForklaring(r, elbil) {
  const e = r.energi;
  return elbil
    ? [tr('{km} hjemmeladet à {pris} kr/kWh', { km: km(e.hjemmeKm), pris: tall(e.pris, 2) }), e.hurtigKm > 0 ? tr('{km} hurtiglading à {pris} kr/kWh', { km: km(e.hurtigKm), pris: tall(e.hurtigpris, 2) }) : null, `${tall(e.per100km, 1)} kWh/100 km`].filter(Boolean).join(' · ')
    : `${km(r.km)} × ${tall(e.per100km, 1)} ${tr('liter/100 km')} × ${tall(e.pris, 2)} kr`;
}

/** Besparelse mot samme tur med bensinbil: bensinbilens bom, ferje og drivstoff minus elbilens sum. */
function besparelse(r) {
  const bb = r.bensinbil;
  if (!bb) return null;
  const bensin = bb.bompenger + bb.ferjekostnad + bb.energikostnad;
  const spart = Math.round(bensin - r.totalkostnad);
  return {
    klasse: spart >= 0 ? 'pluss' : 'minus',
    tekst: tr('Besparelse mot bensinbil: {kr} kr', { kr: `${spart < 0 ? '−' : ''}${tall(Math.abs(spart), 0)}` }),
    forklaring: tr('Bensinbil: {bom} i bom{ferje} + {bensin} kr bensin ({liter} l/100 km à {literpris} kr) = {sum} kr. Elbilen: {el} kr.', {
      bom: kr(bb.bompenger), ferje: bb.ferjekostnad ? tr(' + {pris} ferje', { pris: kr(bb.ferjekostnad) }) : '',
      bensin: tall(bb.energikostnad, 0), sum: tall(bensin, 0), el: tall(r.totalkostnad, 0),
      liter: tall(tilstand.standardForbruk?.bensin?.per100km ?? 7.4, 1), literpris: tall(tilstand.standardForbruk?.bensin?.pris ?? 25, 0),
    }),
  };
}

// Glidebryterne i rutekortet: forbruk, drivstoffpris (bensin/diesel) og hurtigladepris (elbil på langtur).
// felt = navnet i r.energi, skjema = det skjulte skjemafeltet verdien huskes i og sendes med i neste søk.
const GLIDERE = {
  per100km: { skjema: 'forbruk', desimaler: 1 },
  pris: { skjema: 'energipris', desimaler: 2 },
  hurtigpris: { skjema: 'hurtigpris', desimaler: 2 },
};
const gliderEnhet = (felt, elbil) => (felt === 'per100km' ? (elbil ? 'kWh/100 km' : tr('liter/100 km')) : felt === 'pris' ? tr('kr/liter') : 'kr/kWh');

/**
 * En glidebryter er flyttet: regn energikostnaden om på stedet, uten nytt søk (samme formler som src/pris.js).
 * Elbil har ingen bryter for forbruk: det følger bilen og årstiden.
 */
function settEnergi(felt, verdi, ferdig) {
  const { svar } = tilstand;
  const elbil = svar.kjoretoy.drivstoff === 'elbil';
  const r1 = (x) => Math.round(x * 10) / 10, r2 = (x) => Math.round(x * 100) / 100;
  for (const r of svar.ruter) {
    const e = r.energi;
    e[felt] = verdi;
    if (elbil) {
      const hjemme = Math.min(r.km, (tilstand.hjemmeladetAndel ?? 0.8) * e.rekkeviddeKm);
      e.hjemmeKm = r1(hjemme);
      e.hurtigKm = r1(r.km - hjemme);
      e.kostnad = r2(((e.hjemmeKm * e.pris + e.hurtigKm * e.hurtigpris) * e.per100km) / 100);
    } else {
      e.kostnad = r2((r.km / 100) * e.per100km * e.pris);
    }
    r.energikostnad = e.kostnad;
    r.totalkostnad = r2(r.bompenger.total + r.ferjekostnad + e.kostnad);
    const kort = document.querySelector(`.kort[data-id="${r.id}"]`);
    if (!kort) continue;
    const forklaring = energiForklaring(r, elbil);
    kort.querySelector('.stromtekst').textContent = tr('+ {kr} kr {energi}', { kr: tall(r.energikostnad, 0), energi: tr(elbil ? 'strøm' : 'drivstoff') });
    kort.querySelector('.tillegg .strom').title = forklaring;
    kort.querySelector('.d-energi').textContent = kr(r.energikostnad);
    kort.querySelector('.d-forklaring').textContent = forklaring;
    kort.querySelector('.d-sum').textContent = kr(r.totalkostnad);
    const b0 = besparelse(r), linje = kort.querySelector('.bensinbil');
    if (b0 && linje) { linje.className = `bensinbil ${b0.klasse}`; linje.title = b0.forklaring; linje.querySelector('.sparetekst').textContent = b0.tekst; }
    const bryter = kort.querySelector(`.hurtigvelger input[data-felt="${felt}"]`);
    if (bryter) {
      bryter.parentElement.querySelector('output').textContent = `${tall(verdi, GLIDERE[felt].desimaler)} ${gliderEnhet(felt, elbil)}`;
      if (bryter !== document.activeElement) bryter.value = String(verdi);
    }
  }
  if (svar.forbruk) svar.forbruk[felt] = verdi;
  if (!ferdig) return;
  $(GLIDERE[felt].skjema).value = String(verdi); // huskes, og brukes i neste søk
  lagreValg();
}

function rutekort(r, svar, nr, tidsklasse) {
  const b = r.bompenger;
  const drivstoff = svar.kjoretoy.drivstoff;
  const elbil = drivstoff === 'elbil';
  const energiNavn = tr(elbil ? 'strøm' : 'drivstoff');
  const bommer = `${b.antallBetalt}${b.antallPasseringer !== b.antallBetalt ? `/${b.antallPasseringer}` : ''}`;
  const e = r.energi;
  const ukjent = b.harUkjent || r.ferjeUkjent;
  const turRetur = r.etapper.length > 1;
  const stopp = (ev) => ev.stopPropagation();
  const forklaring = energiForklaring(r, elbil);

  const prisNode = el('div', { class: 'pris', title: tr('Bompenger') });
  tellOpp(prisNode, b.total, b.harUkjent ? ' +' : '');

  // Under hovedprisen: det som kommer i tillegg til bompengene
  const tillegg = [
    r.ferjer.length ? el('span', { class: 'ferje', title: r.ferjer.map((x) => x.navn).join(', ') }, ikon('ferje'), `+ ${r.ferjeUkjent ? `${kr(r.ferjekostnad)} +` : kr(r.ferjekostnad)} ${tr('ferje')}`) : null,
    el('span', { class: 'strom', title: forklaring }, ikon(energiIkon(drivstoff)), el('span', { class: 'stromtekst', text: tr('+ {kr} kr {energi}', { kr: tall(r.energikostnad, 0), energi: energiNavn }) })),
  ].filter(Boolean);

  // Glidebrytere: forbruk og drivstoffpris for bensin og diesel, hurtigladepris når elbilen må lade underveis
  const glider = (felt, ikonnavn, tekst, min, maks, tittel) => el('label', { class: 'hurtigvelger', onclick: stopp, title: tittel },
    ikon(ikonnavn), tekst,
    el('input', { type: 'range', min: String(min), max: String(maks), step: '0.1', 'data-felt': felt, value: String(Math.min(maks, Math.max(min, e[felt]))), 'aria-label': `${tekst} (${gliderEnhet(felt, elbil)})`,
      oninput: (ev) => settEnergi(felt, Number(ev.target.value), false), onchange: (ev) => settEnergi(felt, Number(ev.target.value), true), onkeydown: stopp }),
    el('output', { text: `${tall(e[felt], GLIDERE[felt].desimaler)} ${gliderEnhet(felt, elbil)}` }));
  const hurtigvelger = [
    !elbil ? glider('per100km', 'avstand', tr('Forbruk'), 2, drivstoff === 'tung' ? 60 : 15, tr('Dra for å endre forbruket.')) : null,
    !elbil ? glider('pris', 'drivstoff', tr('Drivstoffpris'), 10, 35, tr('Dra for å endre prisen.')) : null,
    elbil && e.hurtigKm > 0 ? glider('hurtigpris', 'strom', tr('Hurtiglading'), 0, 10, tr('{km} av turen må hurtiglades. Dra for å endre prisen.', { km: km(e.hurtigKm) })) : null,
  ].filter(Boolean);

  // Merkelapper: råd om avreisetid og ferjeavganger
  const brikker = [
    r.avreiseråd ? el('button', { type: 'button', class: 'brikke raad', title: tr('Trykk for å søke med dette tidspunktet'),
      onclick: (ev) => { ev.stopPropagation(); $('avreise').value = plussMinutter(svar.avreise, r.avreiseråd.minutter); $('skjema').requestSubmit(); } },
    ikon('klokke'), tr('Dra {tid} ({fortegn}{min} min): {kr} billigere', { tid: r.avreiseråd.avreise, fortegn: r.avreiseråd.minutter > 0 ? '+' : '−', min: Math.abs(r.avreiseråd.minutter), kr: kr(r.avreiseråd.spart) })) : null,
    // Lang ventetid på ferjekaia: dra senere og rekk samme avgang
    r.ferjeråd ? el('button', { type: 'button', class: 'brikke raad ferjeraad', title: tr('Du rekker samme avgang fra {ferje} kl. {tid}. Trykk for å søke med dette tidspunktet.', { ferje: r.ferjeråd.ferje, tid: r.ferjeråd.avgang }),
      onclick: (ev) => { ev.stopPropagation(); $('avreise').value = plussMinutter(svar.avreise, r.ferjeråd.minutter); $('skjema').requestSubmit(); } },
    ikon('ferje'), tr('Dra {tid} (+{min} min): {min} min mindre venting', { tid: r.ferjeråd.avreise, min: r.ferjeråd.minutter })) : null,
    ...r.ferjer.filter((f) => f.avgang).map((f) => el('span', { class: 'brikke ferje', title: tr('{navn}: framme {tid}', { navn: f.navn, tid: f.ankomst }) }, ikon('ferje'), `${f.navn.split(' – ')[0]} ${f.avgang} · ${tr('{min} min venting', { min: f.ventMinutter })}`)),
  ].filter(Boolean);

  // Elbil: hva du sparer mot samme tur med bensinbil (bom + ferje + drivstoff). Grønn når du sparer, rød ellers.
  const b0 = besparelse(r);
  const bensinlinje = b0 ? el('p', { class: `bensinbil ${b0.klasse}`, title: b0.forklaring }, ikon('spart'), el('span', { class: 'sparetekst', text: b0.tekst })) : null;

  // Utregningen, delt på tur og retur når det er aktuelt
  const liste = (etappe) => [
    ...b.linjer.filter((l) => !etappe || l.etappe === etappe).map(bomlinje),
    ...r.ferjer.filter((f) => !etappe || f.etappe === etappe).map(ferjelinje),
  ];
  const linjer = turRetur
    ? [el('li', { class: 'overskrift', text: tr('Tur') }), ...liste('tur'), el('li', { class: 'overskrift', text: r.returAvreise ? tr('Retur · avreise {tid}', { tid: r.returAvreise.slice(11) }) : tr('Retur') }), ...liste('retur')]
    : liste(null);

  const detaljer = el('details', { class: 'detaljer', onclick: (ev) => ev.stopPropagation() },
    el('summary', { text: tr('Utregning') }),
    el('div', { class: 'detaljer-innhold' },
      b.linjer.length || r.ferjer.length ? el('ul', { class: 'bomliste' }, linjer) : null,
      el('dl', { class: 'regnestykke' },
        b.antallGratisTimesregel ? [el('dt', { text: tr('Uten timesregel') }), el('dd', { text: kr(b.totalUtenTimesregel) })] : null,
        el('dt', { class: 'd-bom' }, ikon('bom'), tr('Bompenger')), el('dd', { text: b.harUkjent ? `${kr(b.total)} + ${tr('ukjent')}` : kr(b.total) }),
        r.ferjer.length ? [el('dt', { class: 'd-ferje' }, ikon('ferje'), tr('Ferje')), el('dd', { text: r.ferjeUkjent ? `${kr(r.ferjekostnad)} + ${tr('ukjent')}` : kr(r.ferjekostnad) })] : null,
        el('dt', { class: 'd-strom' }, ikon(energiIkon(drivstoff)), energiNavn[0].toUpperCase() + energiNavn.slice(1)), el('dd', { class: 'd-energi', text: kr(r.energikostnad) }),
        el('dd', { class: 'liten d-forklaring', text: forklaring }),
        el('dt', { class: 'sum', text: tr('Sum') }), el('dd', { class: 'sum d-sum', text: kr(r.totalkostnad) })),
      r.ikkeUnngått?.length ? el('ul', { class: 'grunner' }, r.ikkeUnngått.map((u) => el('li', {}, el('b', { text: u.navn }), ` – ${tr(u.grunn)}`))) : null));

  const lenker = r.etapper.map((et) => el('div', { class: 'lenker' },
    turRetur ? el('span', { class: 'etappe', text: tr(et.navn) }) : null,
    el('a', { class: 'lenke', href: et.lenker.google, target: '_blank', rel: 'noopener', onclick: stopp }, ikon('kart'), 'Google Maps'),
    el('a', { class: 'lenke', href: et.lenker.apple, target: '_blank', rel: 'noopener', onclick: stopp }, ikon('kart'), 'Apple Maps')));

  return el('article', { class: 'kort', tabindex: '0', role: 'button', 'aria-pressed': String(tilstand.valgt === r.id), 'data-id': r.id, style: `--farge:var(${FARGER[r.id]});animation-delay:${nr * 90}ms`,
    onclick: () => velgRute(r.id), onkeydown: (ev) => { if ((ev.key === 'Enter' || ev.key === ' ') && ev.target === ev.currentTarget) { ev.preventDefault(); velgRute(r.id); } } },
    el('div', { class: 'kort-topp' },
      el('h2', {}, el('span', { class: 'merke' }, ikon(RUTEIKON[r.id])), tr(r.tittel)),
      el('div', { class: 'prisblokk' }, prisNode, el('div', { class: 'tillegg' }, tillegg))),
    el('div', { class: 'nokkeltall' },
      medIkon(`tid ${tidsklasse}`, 'klokke', tid(r.sekunder), tr({ rask: 'Kjøretid – raskest', middels: 'Kjøretid – midt imellom', treg: 'Kjøretid – tregest' }[tidsklasse])),
      medIkon('km', 'avstand', km(r.km), tr('Avstand')),
      medIkon('bom', 'bom', bommer, tr(b.antallPasseringer !== b.antallBetalt ? 'Bommer betalt av passert' : 'Bommer betalt')),
      ukjent ? el('span', { class: 'advarsel', title: tr('Minst én bom eller ferje mangler kjent pris og er ikke med i summen') }, ikon('varsel'), tr('ukjent pris')) : null),
    brikker.length ? el('div', { class: 'brikker' }, brikker) : null,
    hurtigvelger,
    bensinlinje,
    lenker,
    detaljer);
}

/** @param stille  true = tegn på nytt uten inngangsanimasjon og opptelling (etter en glidebryter eller språkbytte) */
function tegnResultat(stille = false) {
  const { svar } = tilstand;
  const s = svar.strøm;
  $('resultat').classList.toggle('stille', stille);
  tilstand.stille = stille;
  // Tiden farges etter rang: raskeste grønn, tregeste rød, resten gul. Ventetid på ferjekai holdes utenfor
  // rangeringen, siden den avhenger av avreisetiden.
  const kjøretid = (r) => r.sekunder - (r.ventSekunder || 0);
  const tider = svar.ruter.map(kjøretid);
  const tidsklasse = (r) => (kjøretid(r) === Math.min(...tider) ? 'rask' : kjøretid(r) === Math.max(...tider) ? 'treg' : 'middels');
  $('delKnapp').hidden = false;
  $('resultat').replaceChildren(...[
    svar.melding ? el('p', { class: 'melding', text: tr(svar.melding) }) : null,
    ...svar.ruter.map((r, i) => rutekort(r, svar, i, tidsklasse(r))),
    s ? el('p', { class: 'stromlinje', title: s.strøm == null ? null : tr('Strøm {a} kr + nettleie og avgifter {b} kr per kWh', { a: tall(s.strøm, 2), b: tall(s.nettleie, 2) }) }, ikon('strom'), el('span', {}, el('span', { class: 'hjemmepris', text: tr('Hjemmelading {pris} kr/kWh', { pris: tall(s.pris, 2) }) }), ` · ${tr(s.grunnlag)}`)) : null,
  ].filter(Boolean));
}
$('delKnapp').addEventListener('click', delLenke);

// ------------------------------------------------- Auto-søk ved brytere ---
// Slår du Tur/retur eller Ferjer av eller på etter et søk, søkes det på nytt av seg selv.
// Sperre mot misbruk: søket venter til bryteren har ligget i ro i 0,6 s, og det går minst 3 s mellom
// hvert automatiske søk. Vipper du fram og tilbake, blir det ett søk – med den siste stillingen.
const AUTOSØK_RO_MS = 600, AUTOSØK_PAUSE_MS = 3000;
let autosøkTidtaker = null, sisteAutosøk = 0;
function autosøk() {
  if (!tilstand.svar) return; // ikke før første søk
  clearTimeout(autosøkTidtaker);
  autosøkTidtaker = setTimeout(() => {
    if ($('sokKnapp').disabled) { autosøk(); return; } // et søk pågår: prøv igjen etterpå
    sisteAutosøk = Date.now();
    $('skjema').requestSubmit();
  }, Math.max(AUTOSØK_RO_MS, sisteAutosøk + AUTOSØK_PAUSE_MS - Date.now()));
}
$('turRetur').addEventListener('change', autosøk);
$('ferjer').addEventListener('change', autosøk);

// --------------------------------------------------------- Språkbryter ----

function visOppdatert() {
  if (tilstand.priserOppdatert) $('oppdatert').textContent = tr('Priser oppdatert {dato}', { dato: dato(tilstand.priserOppdatert) });
}
/** Setter alle faste tekster i HTML-en. data-t = tekstinnholdet, data-ta = attributter (mellomromsdelt). */
function brukSpråk() {
  document.documentElement.lang = språk === 'en' ? 'en' : 'nb';
  document.title = tr('Rutepris – hva koster turen?');
  for (const n of document.querySelectorAll('[data-t]')) {
    for (const c of n.childNodes) {
      if (c.nodeType !== 3 || !c.textContent.trim()) continue;
      c.norsk ??= c.textContent.trim();
      c.textContent = tr(c.norsk);
    }
  }
  for (const n of document.querySelectorAll('[data-ta]')) {
    for (const a of n.dataset.ta.split(' ')) {
      const nøkkel = `nb-${a}`;
      if (!n.hasAttribute(`data-${nøkkel}`)) n.setAttribute(`data-${nøkkel}`, n.getAttribute(a) || '');
      n.setAttribute(a, tr(n.getAttribute(`data-${nøkkel}`)));
    }
  }
  // Knappen viser språket du bytter til
  for (const k of document.querySelectorAll('.sprakknapp')) {
    k.textContent = språk === 'en' ? 'NO' : 'EN';
    k.title = språk === 'en' ? 'Bytt til norsk' : 'Switch to English';
    k.setAttribute('aria-label', k.title);
  }
  visOppdatert();
  oppdaterForbruksfelt();
  if (tilstand.svar) { tegnResultat(true); tegnKart(false); }
}
for (const k of document.querySelectorAll('.sprakknapp')) {
  k.addEventListener('click', () => {
    språk = språk === 'en' ? 'nb' : 'en';
    try { localStorage.setItem('rutepris-sprak', språk); } catch { /* lagring er valgfri */ }
    brukSpråk();
  });
}
brukSpråk();
