// Tester for rutevalget (raskeste / billigste / kompromiss) med en liten, kunstig rutetjeneste,
// og for kartlenkene. Ingen nettverkskall.

import test from 'node:test';
import assert from 'node:assert/strict';
import { planleggRuter, byggGrupper } from '../src/ruteplan.js';
import { RuteFeil } from '../src/ruting.js';
import { lesVeggklokke } from '../src/pris.js';
import { viaPunkter, googleMapsLenke, appleMapsLenke } from '../src/lenker.js';
import { meter, avstandTilLinje } from '../src/geo.js';

const fra = { lat: 59.0, lon: 10.0, navn: 'A' }, til = { lat: 59.0, lon: 10.2, navn: 'B' };

/** Linje gjennom gitte hjørner med ca. 100 m mellom punktene. */
function linje(hjørner) {
  const ut = [];
  for (let i = 0; i < hjørner.length - 1; i++) {
    const n = Math.max(1, Math.round(meter(hjørner[i], hjørner[i + 1]) / 100));
    for (let j = 0; j < n; j++) ut.push([hjørner[i][0] + ((hjørner[i + 1][0] - hjørner[i][0]) * j) / n, hjørner[i][1] + ((hjørner[i + 1][1] - hjørner[i][1]) * j) / n]);
  }
  ut.push(hjørner.at(-1));
  return ut;
}
const somRute = (punkter, mPerSek = 20) => {
  let m = 0;
  const tider = punkter.map((p, i) => (i ? (m += meter(punkter[i - 1], p)) / mPerSek : 0));
  return { punkter, tider, sekunder: tider.at(-1), km: m / 1000, ferje: false, ferjeKm: 0, leverandor: 'test' };
};

const rett = linje([[59.0, 10.0], [59.0, 10.2]]);                         // ca. 11,5 km
const omvei = linje([[59.0, 10.0], [59.02, 10.05], [59.02, 10.15], [59.0, 10.2]]); // ca. 12,5 km

const bom = (id, lat, lon, ekstra = {}) => ({
  id, navn: `Bom ${id}`, lat, lon, retning: 'begge', belastesKurs: null, vegretning: 90, prosjekt: `p${id}`, prosjektNavn: `Prosjekt ${id}`,
  takster: { bensin: { full: 30, avtale: 24, rushFull: null, rushAvtale: null }, diesel: { full: 30, avtale: 24, rushFull: null, rushAvtale: null }, elbil: { full: 30, avtale: 16.8, rushFull: null, rushAvtale: null }, tung: { full: 60, avtale: 60, rushFull: null, rushAvtale: null } },
  rush: null, timesregel: { aktiv: false }, prisUsikker: false, usikkerGrunner: [], ...ekstra,
});

/** Rutetjeneste som tar omveien så snart noe skal unngås. */
function tjeneste({ omveiFart = 20, omveiFeil = false } = {}) {
  const kall = [];
  const hentRute = async (s) => {
    kall.push(s);
    const unngår = s.unngåBomveier || s.unngaa.length > 0 || s.unngaaPunkter.length > 0;
    if (!unngår) return somRute(rett);
    if (omveiFeil) throw new RuteFeil('Fant ingen kjørbar rute', 'ingen-rute');
    return somRute(omvei, omveiFart);
  };
  return { hentRute, kall };
}

const spørring = (kjoretoy = { drivstoff: 'bensin', avtale: true }) => ({ fra, til, avreise: lesVeggklokke('2026-11-11T12:00'), kjoretoy });
const miljø = (stasjoner, t) => ({ stasjoner, grupper: byggGrupper(stasjoner), hentRute: t.hentRute, maksPolygoner: 20, maksPunkter: 50 });

test('bom på raskeste rute: billigste rute går utenom og sparer bompengene', async () => {
  const stasjoner = [bom(1, 59.0, 10.1)];
  const t = tjeneste();
  const r = await planleggRuter(spørring(), miljø(stasjoner, t));
  assert.deepEqual(r.ruter.map((x) => x.id), ['raskeste', 'billigste']);
  const [rask, billig] = r.ruter;
  assert.equal(rask.bompenger.total, 24);
  assert.equal(billig.bompenger.total, 0);
  assert.equal(billig.spartBompenger, 24);
  assert.ok(billig.ekstraSekunder > 0 && billig.ekstraKm > 0);
  assert.ok(billig.ekstraEnergikostnad > 0, 'omveien koster ekstra drivstoff');
  assert.equal(billig.nettoSpart, Math.round((24 - billig.ekstraEnergikostnad) * 100) / 100);
  assert.deepEqual(billig.etapper[0].markører.map((m) => m.status), ['unngaatt']);
  assert.deepEqual(rask.etapper[0].markører.map((m) => m.status), ['betalt']);
  assert.equal(r.anbefalt, 'billigste');
});

test('første forsøk bruker «unngå bomveier», og raskeste rute beregnes uten begrensninger', async () => {
  const t = tjeneste();
  await planleggRuter(spørring(), miljø([bom(1, 59.0, 10.1)], t));
  assert.equal(t.kall[0].unngåBomveier, false);
  assert.equal(t.kall[0].unngaa.length, 0);
  assert.equal(t.kall[1].unngåBomveier, true);
});

test('omvei som tar mer enn dobbelt så lang tid forkastes', async () => {
  const t = tjeneste({ omveiFart: 8 }); // omveien tar ca. 2,7 x tiden
  const r = await planleggRuter(spørring(), miljø([bom(1, 59.0, 10.1)], t));
  assert.equal(r.ruter.length, 1);
  assert.match(r.melding, /ingen billigere rute/i);
  assert.match(r.ruter[0].ikkeUnngått[0].grunn, /over 2×/);
});

// ------------------------------------------------------------ kompromiss ---

/** Rutetjeneste der hver sperret bom gir en lokal omvei rundt akkurat den bommen. */
function tjenesteMedLokaleOmveier(stasjoner) {
  const kall = [];
  const nær = (st, lat, lon) => meter([st.lat, st.lon], [lat, lon]) < 60;
  const hentRute = async (s) => {
    kall.push(s);
    const sperret = (st) => s.unngåBomveier
      || s.unngaa.some((p) => nær(st, p.reduce((sum, q) => sum + q[1], 0) / p.length, p.reduce((sum, q) => sum + q[0], 0) / p.length))
      || s.unngaaPunkter.some(([lat, lon]) => nær(st, lat, lon));
    const hjørner = [[59.0, 10.0]];
    for (const st of [...stasjoner].sort((a, b) => a.lon - b.lon)) {
      if (sperret(st)) hjørner.push([59.0, st.lon - 0.012], [59.006, st.lon - 0.006], [59.006, st.lon + 0.006], [59.0, st.lon + 0.012]);
    }
    hjørner.push([59.0, 10.2]);
    return somRute(linje(hjørner));
  };
  return { hentRute, kall };
}
const medPris = (full) => ({ bensin: { full, avtale: full * 0.8, rushFull: null, rushAvtale: null }, diesel: { full, avtale: full * 0.8, rushFull: null, rushAvtale: null }, elbil: { full, avtale: full * 0.56, rushFull: null, rushAvtale: null }, tung: { full, avtale: full, rushFull: null, rushAvtale: null } });

test('kompromiss sparer omtrent halvparten av forskjellen mellom raskeste og billigste', async () => {
  // Tre bommer: 40, 20 og 20 kr med avtale. Raskeste 80 kr, billigste 0 kr -> kompromiss ca. 40 kr.
  const stasjoner = [bom(1, 59.0, 10.05, { takster: medPris(50) }), bom(2, 59.0, 10.1, { takster: medPris(25) }), bom(3, 59.0, 10.15, { takster: medPris(25) })];
  const r = await planleggRuter(spørring(), miljø(stasjoner, tjenesteMedLokaleOmveier(stasjoner)));
  assert.deepEqual(r.ruter.map((x) => x.id), ['raskeste', 'kompromiss', 'billigste']);
  const [rask, kompromiss, billig] = r.ruter;
  assert.equal(rask.bompenger.total, 80);
  assert.equal(billig.bompenger.total, 0);
  assert.equal(kompromiss.bompenger.total, 40);
  assert.equal(kompromiss.spartBompenger, 40);
  assert.ok(kompromiss.sekunder > rask.sekunder && kompromiss.sekunder < billig.sekunder);
  // Av de to måtene å spare 40 kr på (unngå den dyre, eller de to billige) velges den raskeste
  assert.deepEqual(kompromiss.etapper[0].markører.filter((m) => m.status === 'unngaatt').map((m) => m.id), [1]);
});

test('kompromiss vises ikke når ingen rute sparer mellom 30 og 70 %', async () => {
  // Én dyr og én nesten gratis bom: det finnes ikke noe «halvveis».
  const stasjoner = [bom(1, 59.0, 10.05, { takster: medPris(75) }), bom(2, 59.0, 10.15, { takster: medPris(5) })];
  const r = await planleggRuter(spørring(), miljø(stasjoner, tjenesteMedLokaleOmveier(stasjoner)));
  assert.deepEqual(r.ruter.map((x) => x.id), ['raskeste', 'billigste']);
});

test('elbil: strømkostnad og hva samme tur koster med bensinbil', async () => {
  // Avreise 11. november = vinter: snittbilen bruker 17,4 kWh/100 km x 1,22 = 21,2 kWh/100 km på veien
  const r = await planleggRuter(spørring({ drivstoff: 'elbil', avtale: true }), miljø([bom(1, 59.0, 10.1)], tjeneste()));
  const rask = r.ruter[0];
  const km = 11.4694; // lengden på den rette ruta
  assert.equal(rask.bompenger.total, 16.8);
  assert.deepEqual(r.forbruk, { per100km: 21.2, pris: 0.84, enhet: 'kWh', hurtigpris: 5.9, rekkeviddeKm: 367 });
  assert.ok(Math.abs(rask.energikostnad - km * 0.212 * 0.84) < 0.05, `strøm ${rask.energikostnad}`);
  assert.equal(rask.energi.hurtigKm, 0); // kort tur: alt på hjemmeladet strøm
  assert.equal(rask.bensinbil.bompenger, 24);
  assert.equal(rask.bensinbil.ferjekostnad, 0);
  assert.ok(Math.abs(rask.bensinbil.energikostnad - km * 1.85) < 0.05, `bensin ${rask.bensinbil.energikostnad}`); // 7,4 l/100 km à 25 kr
  // Bensinbil får ingen slik sammenligning
  const bensin = await planleggRuter(spørring(), miljø([bom(1, 59.0, 10.1)], tjeneste()));
  assert.equal(bensin.ruter[0].bensinbil, null);
});

// ------------------------------------------------------------------ ferje ---

const ferjedata = [{
  id: '1:A kai - B kai', samband: 'A - B', strekning: 'A ferjekai - B ferjekai', turRetur: false,
  a: { navn: 'A ferjekai', lat: 59.0, lon: 10.08 }, b: { navn: 'B ferjekai', lat: 59.0, lon: 10.12 },
  priser: [{ fra: '2026-01-01', til: '2027-01-01', full: 100, fullNull: 70, brikke: 90, brikkeNull: 63, forskudd: 50, forskuddNull: 35 }],
}];
/** Rett vei med ferje midt på; uten ferje må man kjøre omveien. */
function tjenesteMedFerje(omveiFart, ferjeveiFart = 20) {
  const kall = [];
  const hentRute = async (s) => {
    kall.push(s);
    if (s.unngåFerje) return { ...somRute(omvei, omveiFart), ferjer: [] };
    const r = somRute(rett, ferjeveiFart);
    return { ...r, ferjer: [{ navn: null, fra: [59.0, 10.08], til: [59.0, 10.12], km: 2.3, sekunder: 115, startSekunder: 230 }] };
  };
  return { hentRute, kall };
}
const ferjemiljø = (t) => ({ stasjoner: [], grupper: byggGrupper([]), ferjer: ferjedata, hentRute: t.hentRute, kanUnngåFerje: true, maksPolygoner: 20, maksPunkter: 50 });

test('ferje prises: elbil med brikke, bensin uten brikke', async () => {
  const el = await planleggRuter(spørring({ drivstoff: 'elbil', avtale: true }), ferjemiljø(tjenesteMedFerje(2))); // omveien er svært treg
  assert.equal(el.ruter[0].ferjekostnad, 63);
  assert.equal(el.ruter[0].ferjer[0].navn, 'A – B');
  assert.equal(el.ruter[0].ferjer[0].forskuddPris, 35);
  assert.equal(el.ruter[0].bensinbil.ferjekostnad, 90);
  const bensin = await planleggRuter(spørring({ drivstoff: 'bensin', avtale: false }), ferjemiljø(tjenesteMedFerje(2)));
  assert.equal(bensin.ruter[0].ferjekostnad, 100);
  assert.equal(bensin.ruter[0].totalkostnad, Math.round((100 + bensin.ruter[0].energikostnad) * 100) / 100);
});

test('ferjeruta er raskeste også når veien rundt er nesten like rask, og veien rundt vises som billigste', async () => {
  const r = await planleggRuter(spørring(), ferjemiljø(tjenesteMedFerje(20))); // omveien tar under ett minutt ekstra
  assert.deepEqual(r.ruter.map((x) => x.id), ['raskeste', 'billigste']);
  assert.equal(r.ruter[0].ferjer.length, 1);
  assert.equal(r.ruter[1].ferjer.length, 0);
  assert.ok(r.ruter[1].sekunder > r.ruter[0].sekunder);
});

test('ferje beholdes når veien rundt er mye tregere, og veien rundt vises som billigste', async () => {
  const r = await planleggRuter(spørring(), ferjemiljø(tjenesteMedFerje(3, 4))); // ferjeveien tar ca. 48 min, omveien ca. 69
  assert.deepEqual(r.ruter.map((x) => x.id), ['raskeste', 'billigste']);
  assert.equal(r.ruter[0].ferjekostnad, 90);
  assert.equal(r.ruter[1].ferjekostnad, 0);
});

test('ferje som ikke finnes i pristabellen gir ukjent pris, ikke 0 kr', async () => {
  const m = { ...ferjemiljø(tjenesteMedFerje(2)), ferjer: [] };
  const r = await planleggRuter(spørring(), m);
  assert.equal(r.ruter[0].ferjeUkjent, true);
  assert.equal(r.ruter[0].ferjer[0].status, 'ukjent');
});

test('ingen vei utenom: bare raskeste rute, med forklaring', async () => {
  const t = tjeneste({ omveiFeil: true });
  const r = await planleggRuter(spørring(), miljø([bom(1, 59.0, 10.1)], t));
  assert.equal(r.ruter.length, 1);
  assert.match(r.ruter[0].ikkeUnngått[0].grunn, /ingen vei utenom/i);
});

test('ingen bom på raskeste rute: ett alternativ og ingen ekstra rutekall', async () => {
  const t = tjeneste();
  const r = await planleggRuter(spørring(), miljø([bom(1, 59.5, 10.1)], t));
  assert.equal(r.ruter.length, 1);
  assert.equal(r.ruter[0].bompenger.total, 0);
  assert.equal(t.kall.length, 1);
  assert.match(r.melding, /ingen bompenger/i);
});

test('bom som er gratis for kjøretøyet forsøkes ikke unngått', async () => {
  const gratisForElbil = bom(1, 59.0, 10.1, { takster: { ...bom(1, 0, 0).takster, elbil: { full: 30, avtale: 0, rushFull: null, rushAvtale: null } } });
  const t = tjeneste();
  const r = await planleggRuter(spørring({ drivstoff: 'elbil', avtale: true }), miljø([gratisForElbil], t));
  assert.equal(r.ruter.length, 1);
  assert.equal(t.kall.length, 1);
});

test('enveisbom mot kjøreretningen belastes ikke', async () => {
  const motsatt = bom(1, 59.0, 10.1, { retning: 'en', belastesKurs: 270 }); // krever inn vestover, vi kjører østover
  const r = await planleggRuter(spørring(), miljø([motsatt], tjeneste()));
  assert.equal(r.ruter[0].bompenger.total, 0);
});

test('start innenfor en bomring forklares som uunngåelig', async () => {
  // Seks bommer i ring rundt startpunktet, alle i samme timesregel-gruppe.
  // Både den rette veien (bom 1) og omveien (bom 2) krysser ringen.
  const ring = [[59.0, 10.1], [59.02, 10.1], [59.05, 10.0], [59.0, 9.9], [58.95, 10.0], [58.97, 10.08]].map(([lat, lon], i) =>
    bom(i + 1, lat, lon, { prosjekt: 'ring', prosjektNavn: 'Testringen', timesregel: { aktiv: true, minutter: 60, gruppe: 'g', regel: 'dyreste' } }));
  const t = tjeneste();
  const r = await planleggRuter(spørring(), miljø(ring, t));
  assert.equal(r.ruter.length, 1);
  assert.match(r.ruter[0].ikkeUnngått[0].grunn, /innenfor bomringen/);
});

// ------------------------------------------------------------------ lenker ---

test('via-punkter ligger på omveien, i kjørerekkefølge, og maks 9', () => {
  const via = viaPunkter(omvei, rett, 9);
  assert.ok(via.length >= 1 && via.length <= 9, `antall ${via.length}`);
  for (const p of via) {
    assert.ok(avstandTilLinje(p, rett) > 250, 'via-punktet skal ligge der ruta avviker fra raskeste');
    assert.ok(avstandTilLinje(p, omvei) < 5, 'via-punktet skal ligge på ruta');
  }
  const lon = via.map((p) => p[1]);
  assert.deepEqual(lon, [...lon].sort((a, b) => a - b));
  assert.deepEqual(viaPunkter(rett, rett), []);
  assert.deepEqual(viaPunkter(rett, null), []);
});

test('rutepunkter til kartappene: ferjekai, omvei og støttepunkter på lange ruter', async () => {
  const { rutepunkter, navigasjonslenker } = await import('../src/lenker.js');
  // Kort rute uten ferje og omvei: ingen punkter – appens raskeste rute er den samme
  assert.deepEqual(rutepunkter(rett, null), []);
  // Ferjekaia der ruta går om bord er alltid med, også på raskeste rute
  assert.deepEqual(rutepunkter(rett, null, [[59.0, 10.08]]), [[59.0, 10.08]]);
  // Omvei og ferje sammen: i kjørerekkefølge, høyst 9
  const blandet = rutepunkter(omvei, rett, [omvei[5]]);
  assert.ok(blandet.length >= 2 && blandet.length <= 9, `antall ${blandet.length}`);
  assert.deepEqual(blandet[0], omvei[5]); // ferjekaia ligger tidlig på ruta
  // Lang rute (ca. 290 km rett østover): støttepunkter jevnt fordelt, aldri helt ved start eller mål
  const lang = Array.from({ length: 501 }, (_, i) => [59.0, 10.0 + i * 0.01]);
  const støtte = rutepunkter(lang, null);
  assert.equal(støtte.length, 4);
  assert.ok(støtte.every((p) => p[1] > 10.5 && p[1] < 14.5));
  assert.deepEqual(støtte.map((p) => p[1]), [...støtte.map((p) => p[1])].sort((a, b) => a - b));
  // Lenkene bruker de samme punktene
  const lenker = navigasjonslenker(fra, til, rett, null, [[59.0, 10.08]]);
  assert.equal(new URL(lenker.google).searchParams.get('waypoints'), '59.00000,10.08000');
  assert.deepEqual(new URL(lenker.apple).searchParams.getAll('waypoint'), ['59.00000,10.08000']);
});

test('Google Maps-lenke: dokumentert format med via-punkter adskilt av |', () => {
  const url = new URL(googleMapsLenke(fra, til, [[59.02, 10.05], [59.02, 10.15]]));
  assert.equal(url.origin + url.pathname, 'https://www.google.com/maps/dir/');
  assert.equal(url.searchParams.get('api'), '1');
  assert.equal(url.searchParams.get('origin'), '59.00000,10.00000');
  assert.equal(url.searchParams.get('destination'), '59.00000,10.20000');
  assert.equal(url.searchParams.get('travelmode'), 'driving');
  assert.equal(url.searchParams.get('waypoints'), '59.02000,10.05000|59.02000,10.15000');
  assert.equal(new URL(googleMapsLenke(fra, til)).searchParams.has('waypoints'), false);
});

test('Apple Maps-lenke: ett waypoint-parameter per via-punkt', () => {
  const url = new URL(appleMapsLenke(fra, til, [[59.02, 10.05], [59.02, 10.15]]));
  assert.equal(url.origin + url.pathname, 'https://maps.apple.com/directions');
  assert.equal(url.searchParams.get('source'), '59.00000,10.00000');
  assert.equal(url.searchParams.get('destination'), '59.00000,10.20000');
  assert.deepEqual(url.searchParams.getAll('waypoint'), ['59.02000,10.05000', '59.02000,10.15000']);
  assert.equal(url.searchParams.get('mode'), 'driving');
});
