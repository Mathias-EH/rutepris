// Tester for strømpris, råd om avreisetid, ferjetider og tur/retur. Ingen nettverkskall.

import test from 'node:test';
import assert from 'node:assert/strict';
import { planleggRuter, byggGrupper } from '../src/ruteplan.js';
import { kombinerTurRetur } from '../src/turretur.js';
import { lesVeggklokke } from '../src/pris.js';
import { meter } from '../src/geo.js';
import { prisområde, timeprisEtterStøtte, døgnsnittEtterStøtte, hjemmepris, norgespris, nettleie } from '../src/strom.js';
import { norskForskyvning, tilIso, fraIso } from '../src/ferjetid.js';

const kl = (t) => lesVeggklokke(t);

// ------------------------------------------------------------------ strøm ---

test('strømstøtte: staten dekker 90 % av spotprisen over 77 øre uten mva, time for time', () => {
  // 50 øre: ingen støtte. Med 25 % mva = 62,5 øre.
  assert.equal(timeprisEtterStøtte(0.5, 'NO1'), 0.625);
  // 1,77 kr: 1,00 over terskelen, 90 øre dekkes -> 0,87 uten mva = 1,0875 med mva
  assert.ok(Math.abs(timeprisEtterStøtte(1.77, 'NO1') - 1.0875) < 1e-9);
  // Nord-Norge (NO4) har ikke mva på strøm
  assert.ok(Math.abs(timeprisEtterStøtte(1.77, 'NO4') - 0.87) < 1e-9);
  const timer = [{ NOK_per_kWh: 0.5 }, { NOK_per_kWh: 1.77 }];
  assert.equal(døgnsnittEtterStøtte(timer, 'NO1'), 0.86); // (0,625 + 1,0875) / 2
  assert.equal(døgnsnittEtterStøtte([], 'NO1'), null);
});

test('Norgespris og nettleie: 50 øre + 34 øre med mva, 40 + 27 i Nord-Norge', () => {
  assert.equal(norgespris('NO1'), 0.5);
  assert.equal(norgespris('NO4'), 0.4);
  assert.equal(nettleie('NO1'), 0.34);
  assert.equal(nettleie('NO4'), 0.27);
});

test('hjemmeladepris: spot med strømstøtte, Norgespris, og reserve når spotprisen mangler', async () => {
  const timer = async () => [{ NOK_per_kWh: 0.5 }, { NOK_per_kWh: 1.77 }];
  const spot = await hjemmepris({ avtale: 'spot', område: 'NO1', dato: '2026-11-12', hentTimer: timer });
  assert.equal(spot.pris, 1.2); // 0,86 strøm + 0,34 nettleie
  assert.equal(spot.avtale, 'spot');
  const np = await hjemmepris({ avtale: 'norgespris', område: 'NO1', dato: '2026-11-12', hentTimer: timer });
  assert.equal(np.pris, 0.84);
  const nede = await hjemmepris({ avtale: 'spot', område: 'NO1', dato: '2026-11-12', hentTimer: async () => { throw new Error('nede'); } });
  assert.equal(nede.pris, 0.84);
  assert.equal(nede.avtale, 'norgespris');
  assert.match(nede.grunnlag, /ikke tilgjengelig/);
});

test('prisområde ut fra posisjon', () => {
  assert.equal(prisområde(59.91, 10.75), 'NO1'); // Oslo
  assert.equal(prisområde(58.15, 8.0), 'NO2');   // Kristiansand
  assert.equal(prisområde(58.97, 5.73), 'NO2');  // Stavanger
  assert.equal(prisområde(63.43, 10.4), 'NO3');  // Trondheim
  assert.equal(prisområde(69.65, 18.96), 'NO4'); // Tromsø
  assert.equal(prisområde(60.39, 5.32), 'NO5');  // Bergen
});

// ------------------------------------------------------- felles testoppsett ---

const A = { lat: 59.0, lon: 10.0, navn: 'A' }, B = { lat: 59.0, lon: 10.2, navn: 'B' };
function linje(hjørner) {
  const ut = [];
  for (let i = 0; i < hjørner.length - 1; i++) {
    const n = Math.max(1, Math.round(meter(hjørner[i], hjørner[i + 1]) / 100));
    for (let j = 0; j < n; j++) ut.push([hjørner[i][0] + ((hjørner[i + 1][0] - hjørner[i][0]) * j) / n, hjørner[i][1] + ((hjørner[i + 1][1] - hjørner[i][1]) * j) / n]);
  }
  ut.push(hjørner.at(-1));
  return ut;
}
const somRute = (punkter, ferjer = []) => {
  let m = 0;
  const tider = punkter.map((p, i) => (i ? (m += meter(punkter[i - 1], p)) / 20 : 0));
  return { punkter, tider, ferjer, sekunder: tider.at(-1), km: m / 1000, leverandor: 'test' };
};
const rush = { vinduer: [['06:30', '09:00'], ['15:00', '17:00']], ukedager: [1, 2, 3, 4, 5], unntattHelligdager: true, unntattJuli: false };
const rushbom = (id, lon, gruppe = 'g') => ({
  id, navn: `Bom ${id}`, lat: 59.0, lon, retning: 'begge', belastesKurs: null, vegretning: 90, prosjekt: 'ring', prosjektNavn: 'Testringen',
  takster: { bensin: { full: 30, avtale: 24, rushFull: 50, rushAvtale: 40 }, diesel: { full: 30, avtale: 24, rushFull: 50, rushAvtale: 40 }, elbil: { full: 30, avtale: 16.8, rushFull: 50, rushAvtale: 28 }, tung: { full: 60, avtale: 60, rushFull: 100, rushAvtale: 100 } },
  rush, timesregel: { aktiv: true, minutter: 60, gruppe, regel: 'dyreste' }, prisUsikker: false, usikkerGrunner: [],
});
/** Rett vei mellom fra og til, uansett retning. Ingen omvei finnes. */
const rettVei = { hentRute: async (s) => { if (s.unngåBomveier || s.unngaa.length || s.unngaaPunkter.length) throw Object.assign(new (await import('../src/ruting.js')).RuteFeil('Fant ingen kjørbar rute', 'ingen-rute')); return somRute(linje([[s.fra.lat, s.fra.lon], [s.til.lat, s.til.lon]])); } };
const miljø = (stasjoner, ekstra = {}) => ({ stasjoner, grupper: byggGrupper(stasjoner), hentRute: rettVei.hentRute, maksPolygoner: 20, maksPunkter: 50, ...ekstra });
const bensin = { drivstoff: 'bensin', avtale: true };

// ------------------------------------------------------------ avreiseråd ---

test('råd om avreisetid: dra litt senere og slipp rushtidstaksten', async () => {
  // Bommen passeres ca. 5 minutter etter avreise. Avreise 08:50 gir passering 08:55 (rush, 40 kr).
  const r = await planleggRuter({ fra: A, til: B, avreise: kl('2026-11-11T08:50'), kjoretoy: bensin }, miljø([rushbom(1, 10.1)]));
  const rute = r.ruter[0];
  assert.equal(rute.bompenger.total, 40);
  assert.deepEqual(rute.avreiseråd, { minutter: 10, spart: 16, pris: 24, avreise: '09:00' }); // passering ca. 09:05; fem minutter senere er ikke nok
});

test('råd om avreisetid: dra tidligere når det er nærmest, og ikke noe råd utenom rush', async () => {
  // Avreise 06:30 gir passering 06:35 (rush). Fem minutter tidligere er nok til å komme før rushet starter.
  const tidlig = await planleggRuter({ fra: A, til: B, avreise: kl('2026-11-11T06:30'), kjoretoy: bensin }, miljø([rushbom(1, 10.1)]));
  assert.equal(tidlig.ruter[0].avreiseråd.minutter, -5); // passering rett før 06:30
  assert.equal(tidlig.ruter[0].avreiseråd.spart, 16);
  const midtPåDagen = await planleggRuter({ fra: A, til: B, avreise: kl('2026-11-11T12:00'), kjoretoy: bensin }, miljø([rushbom(1, 10.1)]));
  assert.equal(midtPåDagen.ruter[0].avreiseråd, null);
});

// ------------------------------------------------------------ ferjetider ---

test('norsk tid: sommertid fra siste søndag i mars til siste søndag i oktober', () => {
  assert.equal(norskForskyvning(kl('2026-01-15T12:00')), '+01:00');
  assert.equal(norskForskyvning(kl('2026-07-01T12:00')), '+02:00');
  assert.equal(norskForskyvning(kl('2026-03-29T03:00')), '+02:00'); // sommertid startet kl. 02
  assert.equal(norskForskyvning(kl('2026-03-28T12:00')), '+01:00');
  assert.equal(norskForskyvning(kl('2026-10-25T12:00')), '+01:00'); // vintertid fra kl. 03
  assert.equal(tilIso(kl('2026-11-13T10:07')), '2026-11-13T10:07:00+01:00');
  assert.equal(fraIso('2026-11-13T10:15:00+01:00').getTime(), kl('2026-11-13T10:15').getTime());
});

test('ferjeavgang: ventetid og overfart legges til kjøretiden, og bommer etter ferja prises på nytt tidspunkt', async () => {
  const ferjedata = [{ strekning: 'V ferjekai - Ø ferjekai', samband: 'V - Ø', turRetur: false, a: { navn: 'V ferjekai', lat: 59.0, lon: 10.04, id: 'kai:V' }, b: { navn: 'Ø ferjekai', lat: 59.0, lon: 10.08, id: 'kai:Ø' }, priser: [{ fra: '2026-01-01', til: '2027-01-01', full: 100, fullNull: 70, brikke: 90, brikkeNull: 63, forskudd: 50, forskuddNull: 35 }] }];
  // Ferje fra lon 10,04 til 10,08: ruta kommer til kaia etter ca. 115 s og bruker 115 s på overfarten.
  const medFerje = async (s) => somRute(linje([[s.fra.lat, s.fra.lon], [s.til.lat, s.til.lon]]), s.unngåFerje ? [] : [{ navn: null, fra: [59.0, 10.04], til: [59.0, 10.08], km: 2.3, sekunder: 115, startSekunder: 115 }]);
  const spurt = [];
  const nesteAvgang = async (fraId, tilId, tid) => { spurt.push([fraId, tilId]); return { avgang: new Date(tid.getTime() + 10 * 60000), ankomst: new Date(tid.getTime() + 30 * 60000) }; };
  // Bom etter ferja. Uten ferjetider passeres den 08:55 (rush); med 10 min venting og 20 min overfart blir det ca. 09:23.
  const r = await planleggRuter({ fra: A, til: B, avreise: kl('2026-11-11T08:47'), kjoretoy: bensin },
    { ...miljø([rushbom(1, 10.16)]), hentRute: medFerje, ferjer: ferjedata, kanUnngåFerje: false, nesteAvgang });
  const rute = r.ruter[0];
  assert.deepEqual(spurt[0], ['kai:V', 'kai:Ø']); // riktig vei
  assert.equal(rute.ferjer[0].navn, 'V – Ø');
  assert.equal(rute.ferjer[0].ventMinutter, 10);
  assert.equal(rute.ferjer[0].avgang, '08:58');
  assert.equal(rute.ferjer[0].ankomst, '09:18');
  assert.equal(rute.bompenger.linjer[0].rush, false);
  assert.equal(rute.bompenger.total, 24);
  // Kjøretiden øker med ventetid (600 s) og lengre overfart (1200 − 115 s)
  assert.ok(Math.abs(rute.sekunder - (573 + 600 + 1085)) <= 2, `sekunder ${rute.sekunder}`);
});

test('ferje eller vei rundt: ferjeruta er «Raskeste» uansett ventetid, med råd om avreisetid', async () => {
  const ferjedata = [{ strekning: 'V ferjekai - Ø ferjekai', samband: 'V - Ø', turRetur: false, a: { navn: 'V ferjekai', lat: 59.0, lon: 10.04, id: 'kai:V' }, b: { navn: 'Ø ferjekai', lat: 59.0, lon: 10.08, id: 'kai:Ø' }, priser: [{ fra: '2026-01-01', til: '2027-01-01', full: 100, fullNull: 70, brikke: 90, brikkeNull: 63, forskudd: 50, forskuddNull: 35 }] }];
  // Rett vei med ferje tar ca. 10 min. Veien rundt (uten ferje) tar ca. 25 min.
  const rundt = linje([[59.0, 10.0], [59.12, 10.1], [59.0, 10.2]]);
  const hentRute = async (s) => (s.unngåFerje ? somRute(rundt) : somRute(linje([[s.fra.lat, s.fra.lon], [s.til.lat, s.til.lon]]), [{ navn: null, fra: [59.0, 10.04], til: [59.0, 10.08], km: 2.3, sekunder: 115, startSekunder: 115 }]));
  const medVenting = (minutter) => ({ ...miljø([]), hentRute, ferjer: ferjedata, kanUnngåFerje: true, nesteAvgang: async (a, b, tid) => ({ avgang: new Date(tid.getTime() + minutter * 60000), ankomst: new Date(tid.getTime() + (minutter + 2) * 60000) }) });
  const spørring = { fra: A, til: B, avreise: kl('2026-11-11T12:00'), kjoretoy: bensin };

  // 5 min venting: ferjeruta er raskest. Veien rundt koster mindre og vises som billigste.
  const kort = await planleggRuter(spørring, medVenting(5));
  assert.deepEqual(kort.ruter.map((r) => r.id), ['raskeste', 'billigste']);
  assert.equal(kort.ruter[0].ferjer[0].ventMinutter, 5);
  assert.equal(kort.ruter[0].ventSekunder, 300);
  assert.equal(kort.ruter[0].ferjeråd, null); // kort ventetid: ikke noe å hente
  assert.equal(kort.ruter[1].ferjer.length, 0);

  // 30 min venting: ferjeruta er fortsatt «Raskeste» (ventetiden avhenger av når du drar), aldri et eget kort.
  // Kjøretiden i kortet har ventetiden med, og rådet sier hvor mye senere du kan dra.
  const middels = await planleggRuter(spørring, medVenting(30));
  assert.deepEqual(middels.ruter.map((r) => r.id), ['raskeste', 'billigste']);
  assert.equal(middels.ruter[0].ferjer[0].ventMinutter, 30);
  assert.equal(middels.ruter[0].ventSekunder, 1800);
  assert.deepEqual(middels.ruter[0].ferjeråd, { minutter: 25, avreise: '12:25', ferje: 'V', avgang: '12:31' });
  assert.ok(middels.ruter[0].sekunder - middels.ruter[0].ventSekunder < middels.ruter[1].sekunder); // uten venting er ferja raskest

  // Ferjer slått av: ingen ferje, selv om den er raskest.
  const av = await planleggRuter({ ...spørring, ferjer: false }, medVenting(5));
  assert.deepEqual(av.ruter.map((r) => r.id), ['raskeste']);
  assert.equal(av.ruter[0].ferjer.length, 0);
});

test('ferjer slått av, men ingen vei uten ferje: ruta med ferje brukes, med melding', async () => {
  const { RuteFeil } = await import('../src/ruting.js');
  const hentRute = async (s) => { if (s.unngåFerje) throw new RuteFeil('Fant ingen kjørbar rute', 'ingen-rute'); return somRute(linje([[s.fra.lat, s.fra.lon], [s.til.lat, s.til.lon]]), [{ navn: 'Øyferja', fra: [59.0, 10.04], til: [59.0, 10.08], km: 2.3, sekunder: 115, startSekunder: 115 }]); };
  const r = await planleggRuter({ fra: A, til: B, avreise: kl('2026-11-11T12:00'), kjoretoy: bensin, ferjer: false }, { ...miljø([]), hentRute, ferjer: [], kanUnngåFerje: true });
  assert.equal(r.ruter[0].ferjer.length, 1);
  assert.equal(r.melding, 'Det finnes ingen vei uten ferje.');
});

// ------------------------------------------------- Sverige og Danmark ---

const sek = 0.95;
const gbg = { rader: [['06:00', '06:30', 9], ['06:30', '07:00', 16], ['07:00', '08:00', 22], ['08:00', '08:30', 16], ['08:30', '15:00', 9], ['15:00', '15:30', 16], ['15:30', '17:00', 22], ['17:00', '18:00', 16], ['18:00', '18:30', 9]], fridager: 'goteborg', sesonger: false, dagstak: [60], valuta: 'SEK', kurs: sek };
const sthlm = { rader: [['06:00', '06:30', 15, 15], ['06:30', '07:00', 30, 25], ['07:00', '08:30', 45, 35], ['08:30', '09:00', 30, 25], ['09:00', '09:30', 20, 15], ['09:30', '15:00', 11, 11], ['15:00', '15:30', 20, 15], ['15:30', '16:00', 30, 25], ['16:00', '17:30', 45, 35], ['17:30', '18:00', 30, 25], ['18:00', '18:30', 20, 15]], fridager: 'stockholm', sesonger: true, dagstak: [135, 105], valuta: 'SEK', kurs: sek };
const portal = (id, by, tidstakst, timesregel = { aktiv: false }) => ({ id, navn: `Portal ${id}`, prosjekt: by, prosjektNavn: by, tidstakst, timesregel, prisUsikker: false });

test('trängselskatt: beløpet følger klokka og er likt for alle kjøretøy', async () => {
  const { tidstakstFor, takstFor } = await import('../src/pris.js');
  assert.deepEqual(tidstakstFor(gbg, kl('2026-11-13T07:30')), { pris: 20.9, rush: true, forklaring: '22 SEK', beløp: 22 }); // 22 SEK × 0,95
  assert.equal(tidstakstFor(gbg, kl('2026-11-13T10:00')).pris, 8.55);
  assert.equal(tidstakstFor(gbg, kl('2026-11-13T18:30')).pris, 0); // etter 18:29
  assert.equal(tidstakstFor(gbg, kl('2026-11-13T05:59')).pris, 0);
  const s = portal(1, 'se-goteborg', gbg);
  assert.equal(takstFor(s, { drivstoff: 'elbil', avtale: true }, kl('2026-11-13T07:30')).pris, 20.9); // ingen rabatt for elbil eller brikke
  assert.equal(takstFor(s, { drivstoff: 'tung', avtale: false }, kl('2026-11-13T07:30')).pris, 20.9);
});

test('trängselskatt: fridager i Göteborg og Stockholm følger Transportstyrelsens lister for 2026', async () => {
  const { svenskFridag } = await import('../src/pris.js');
  const fri = (regel, dag) => svenskFridag(regel, kl(`${dag}T08:00`));
  // Göteborg 2026: 1.1, 5.–6.1, 2.–3.4, 6.4, 30.4, 1.5, 13.–14.5, 5.6, 19.6, 30.10, 24.–25.12, 31.12
  for (const d of ['2026-01-01', '2026-01-05', '2026-01-06', '2026-04-02', '2026-04-03', '2026-04-06', '2026-04-30', '2026-05-01', '2026-05-13', '2026-05-14', '2026-06-05', '2026-06-19', '2026-10-30', '2026-12-24', '2026-12-25', '2026-12-31']) assert.equal(fri('goteborg', d), true, `Göteborg ${d}`);
  for (const d of ['2026-01-02', '2026-04-01', '2026-04-07', '2026-05-12', '2026-06-04', '2026-06-18', '2026-10-29', '2026-11-13', '2026-12-23']) assert.equal(fri('goteborg', d), false, `Göteborg ${d}`);
  assert.equal(fri('goteborg', '2026-07-15'), true);  // hele juli
  assert.equal(fri('goteborg', '2026-11-14'), true);  // lørdag
  // Stockholm 2026: 1.1, 5.–6.1, 3.4, 6.4, 1.5, 14.5, 19.6, 24.–25.12, 31.12 – men ikke 2.4, 30.4, 13.5, 5.6 og 30.10
  for (const d of ['2026-01-01', '2026-01-05', '2026-01-06', '2026-04-03', '2026-04-06', '2026-05-01', '2026-05-14', '2026-06-19', '2026-12-24', '2026-12-25', '2026-12-31']) assert.equal(fri('stockholm', d), true, `Stockholm ${d}`);
  for (const d of ['2026-04-02', '2026-04-30', '2026-05-13', '2026-06-05', '2026-10-30', '2026-11-13']) assert.equal(fri('stockholm', d), false, `Stockholm ${d}`);
  // Juli i Stockholm: bare de fem første hverdagene er avgiftsbelagt (1.–3. og 6.–7. juli 2026)
  assert.equal(fri('stockholm', '2026-07-01'), false);
  assert.equal(fri('stockholm', '2026-07-07'), false);
  assert.equal(fri('stockholm', '2026-07-08'), true);
  assert.equal(fri('stockholm', '2026-07-31'), true);
});

test('trängselskatt Stockholm: høy- og lavsesong, og dagstak', async () => {
  const { tidstakstFor, erHøysesong, beregnBompenger } = await import('../src/pris.js');
  assert.equal(erHøysesong(kl('2026-11-13T08:00')), true);  // 15.8–30.11
  assert.equal(erHøysesong(kl('2026-12-01T08:00')), false);
  assert.equal(erHøysesong(kl('2026-03-02T08:00')), true);  // fra 1.3 …
  assert.equal(erHøysesong(kl('2026-06-18T08:00')), true);  // … til dagen før midsommarafton (19.6.2026)
  assert.equal(erHøysesong(kl('2026-06-22T08:00')), false);
  assert.equal(tidstakstFor(sthlm, kl('2026-11-13T07:30')).beløp, 45);
  assert.equal(tidstakstFor(sthlm, kl('2026-12-01T07:30')).beløp, 35);
  // Fire passeringer à 45 SEK på samme dag: dagstaket på 135 SEK stopper regningen
  const s = portal(1, 'se-stockholm', sthlm);
  const r = beregnBompenger(['07:10', '07:40', '16:10', '16:40'].map((t) => ({ stasjon: s, tid: kl(`2026-11-13T${t}`) })), bensin);
  assert.deepEqual(r.linjer.map((l) => l.pris), [42.75, 42.75, 42.75, 0]);
  assert.equal(r.total, 128.25); // 135 SEK × 0,95
  assert.match(r.linjer[3].forklaring, /dagstaket på 135 SEK/);
  assert.equal(r.linjer[0].utenlandsk, '45 SEK');
});

test('trängselskatt Göteborg: flere passeringer innen 60 minutter gir én skatt, den høyeste', async () => {
  const { beregnBompenger } = await import('../src/pris.js');
  const regel = { aktiv: true, minutter: 60, gruppe: 'flerpassasje', regel: 'dyreste' };
  const a = portal(1, 'se-goteborg', gbg, regel), b = portal(2, 'se-goteborg', gbg, regel);
  const r = beregnBompenger([{ stasjon: a, tid: kl('2026-11-13T06:50') }, { stasjon: b, tid: kl('2026-11-13T07:10') }, { stasjon: a, tid: kl('2026-11-13T08:40') }], bensin);
  assert.deepEqual(r.linjer.map((l) => [l.pris, l.status]), [[0, 'gratis-timesregel'], [20.9, 'betalt'], [8.55, 'betalt']]); // 16 og 22 SEK innen timen -> 22; 9 SEK senere
});

test('Sverige og Danmark: portaler fra OpenStreetMap blir stasjoner med riktig takst', async () => {
  const { klassifiser, byggUtland, tolkGratisferjer } = await import('../scripts/lib/utland.js');
  const el = (id, lat, lon, tags) => ({ id, lat, lon, tags });
  const elementer = [
    el(1, 59.3139, 18.1034, { highway: 'toll_gantry', name: 'Danvikstull', operator: 'Transportstyrelsen' }),
    el(2, 59.3317, 18.0107, { highway: 'toll_gantry', name: 'Essingeleden', operator: 'Transportstyrelsen' }),
    el(3, 59.3337, 18.0101, { highway: 'toll_gantry', name: 'Kristineberg', operator: 'Transportstyrelsen' }),
    el(4, 57.7258, 11.9754, { highway: 'toll_gantry', name: 'Ringömotet', operator: 'Transportstyrelsen' }),
    el(5, 58.5393, 15.0174, { highway: 'toll_gantry', name: 'Motalabron', operator: 'Transportstyrelsen' }),
    el(6, 55.3499, 11.1088, { barrier: 'toll_booth', operator: 'A/S STOREBÆLTSFORBINDELSEN' }),
    el(7, 55.5660, 12.9000, { barrier: 'toll_booth' }),
    el(8, 55.0565, 11.7469, { barrier: 'toll_booth', name: 'Knudskov', charge: '20 DKK/car/day' }), // privat vei: ikke med
  ];
  assert.equal(klassifiser(elementer[7]), null);
  const u = byggUtland(elementer, { SEK: 0.95, DKK: 1.4 });
  assert.equal(u.stasjoner.length, 7);
  const finn = (navn) => u.stasjoner.find((s) => s.navn === navn);
  assert.equal(finn('Danvikstull').tidstakstId, 'se-stockholm-innerstad');
  assert.equal(finn('Essingeleden').tidstakstId, 'se-stockholm-essingeleden');
  assert.equal(finn('Kristineberg').prisUsikker, true);
  assert.equal(finn('Essingeleden').snitt, finn('Kristineberg').snitt); // Fredhäll og Kristineberg = én passering
  assert.equal(finn('Ringömotet').timesregel.minutter, 60);
  assert.deepEqual(finn('Motalabron').takster.bensin, { full: 4.75, avtale: 4.75, rushFull: null, rushAvtale: null });
  assert.equal(finn('Motalabron').takster.tung.full, 10.45); // 11 SEK
  const stb = finn('Storebæltsbroen');
  assert.equal(stb.takster.elbil.full, 329);   // 235 DKK
  assert.equal(stb.takster.elbil.avtale, 287); // 205 DKK med brikke eller skiltgjenkjenning
  assert.equal(stb.takster.tung.full, null);   // prises etter lengde: ukjent
  assert.equal(finn('Øresundsbron').takster.bensin.avtale, 658); // 470 DKK, ingen rabatt uten egen avtale
  assert.equal(u.tidstakster['se-goteborg'].kurs, 0.95);
  assert.ok(u.stasjoner.every((s) => s.id > 1e13));
  // Svenske vegferjer er gratis; ferjer med avgift eller uten biler tas ikke med
  const ferjer = tolkGratisferjer([
    { id: 9, tags: { name: 'Gullmarsleden', route: 'ferry' }, geometry: [{ lat: 58.27, lon: 11.43 }, { lat: 58.26, lon: 11.45 }] },
    { id: 10, tags: { name: 'Betalferje', fee: 'yes' }, geometry: [{ lat: 58, lon: 11 }, { lat: 58.1, lon: 11 }] },
    { id: 11, tags: { name: 'Gangferje', motor_vehicle: 'no' }, geometry: [{ lat: 58, lon: 11 }, { lat: 58.1, lon: 11 }] },
  ]);
  assert.deepEqual(ferjer.map((f) => f.samband), ['Gullmarsleden']);
  assert.equal(ferjer[0].priser[0].full, 0);
});

test('valutakurs: Norges Banks svar tolkes, og nye kurser regner om alle utenlandske takster', async () => {
  const { tolkValutakurser, fasteTakster, brukKurser } = await import('../src/valuta.js');
  const { byggUtland } = await import('../scripts/lib/utland.js');
  // Slik svarer Norges Bank: kursen gjelder 100 SEK / 100 DKK (UNIT_MULT = 2)
  const svar = { data: {
    dataSets: [{ series: { '0:0:0:0': { attributes: [0, 0, 0, 0], observations: { 0: ['141.30'] } }, '0:1:0:0': { attributes: [0, 0, 0, 0], observations: { 0: ['95.48'] } } } }],
    structure: {
      dimensions: { series: [{ id: 'FREQ', values: [{ id: 'B' }] }, { id: 'BASE_CUR', values: [{ id: 'DKK' }, { id: 'SEK' }] }, { id: 'QUOTE_CUR', values: [{ id: 'NOK' }] }, { id: 'TENOR', values: [{ id: 'SP' }] }], observation: [{ id: 'TIME_PERIOD', values: [{ id: '2026-11-12' }] }] },
      attributes: { series: [{ id: 'DECIMALS', values: [{ id: '2' }] }, { id: 'CALCULATED', values: [{ id: 'false' }] }, { id: 'UNIT_MULT', values: [{ id: '2' }] }, { id: 'COLLECTION', values: [{ id: 'C' }] }] },
    },
  } };
  assert.deepEqual(tolkValutakurser(svar), { dato: '2026-11-12', kilde: 'Norges Bank', DKK: 1.413, SEK: 0.9548 });
  svar.data.dataSets[0].series['0:1:0:0'].observations[0] = ['9548'];
  assert.throws(() => tolkValutakurser(svar), /urimelig valutakurs/); // feil i kilden skal ikke gi ville priser

  assert.deepEqual(fasteTakster({ valuta: 'DKK', bil: 235, automatisk: 205, tung: null }, 1.4).elbil, { full: 329, avtale: 287, rushFull: null, rushAvtale: null });

  // Daglig oppdatering: samme data, ny kurs
  const u = byggUtland([
    { id: 1, lat: 55.3499, lon: 11.1088, tags: { barrier: 'toll_booth', operator: 'A/S STOREBÆLTSFORBINDELSEN' } },
    { id: 2, lat: 57.7258, lon: 11.9754, tags: { highway: 'toll_gantry', name: 'Ringömotet', operator: 'Transportstyrelsen' } },
  ], { SEK: 0.95, DKK: 1.4 });
  const data = { stasjoner: u.stasjoner, tidstakster: u.tidstakster, kurser: { SEK: 0.95, DKK: 1.4, dato: '2026-11-12' } };
  const bro = data.stasjoner.find((s) => s.navn === 'Storebæltsbroen');
  assert.deepEqual(bro.valutabeløp, { valuta: 'DKK', bil: 235, automatisk: 205, tung: null });
  assert.equal(bro.takster.bensin.full, 329);
  brukKurser(data, { SEK: 1.0, DKK: 1.5, dato: '2026-11-13', kilde: 'Norges Bank' });
  assert.equal(bro.takster.bensin.full, 352.5);   // 235 DKK × 1,5
  assert.equal(bro.takster.bensin.avtale, 307.5); // 205 DKK × 1,5
  assert.equal(bro.takster.tung.full, null);
  assert.equal(data.tidstakster['se-goteborg'].kurs, 1.0);
  assert.equal(data.kurser.dato, '2026-11-13');
});

test('strømpris og stedssøk utenfor Norge', async () => {
  const { landFor, utenlandskHjemmepris } = await import('../src/strom.js');
  assert.equal(landFor(59.91, 10.75), 'NO'); // Oslo
  assert.equal(landFor(58.94, 11.17), 'SE'); // Strömstad
  assert.equal(landFor(59.12, 11.39), 'NO'); // Halden
  assert.equal(landFor(57.71, 11.97), 'SE'); // Göteborg
  assert.equal(landFor(59.33, 18.07), 'SE'); // Stockholm
  assert.equal(landFor(63.18, 14.64), 'SE'); // Östersund
  assert.equal(landFor(63.43, 10.4), 'NO');  // Trondheim
  assert.equal(landFor(68.44, 17.43), 'NO'); // Narvik
  assert.equal(landFor(67.86, 20.23), 'SE'); // Kiruna
  assert.equal(landFor(55.68, 12.57), 'DK'); // København
  assert.equal(landFor(55.6, 13.0), 'SE');   // Malmö
  assert.equal(landFor(57.05, 9.92), 'DK');  // Aalborg
  assert.equal(landFor(57.72, 10.58), 'DK'); // Skagen
  assert.equal(landFor(57.11, 12.25), 'SE'); // Varberg
  assert.equal(landFor(56.05, 12.69), 'SE'); // Helsingborg
  assert.equal(landFor(56.03, 12.61), 'DK'); // Helsingør
  assert.equal(landFor(55.1, 14.7), 'DK');   // Rønne på Bornholm
  assert.equal(landFor(58.15, 8.0), 'NO');   // Kristiansand
  assert.equal(prisområde(57.71, 11.97), 'SE3');
  assert.equal(prisområde(55.6, 13.0), 'SE4');
  assert.equal(prisområde(55.68, 12.57), 'DK2');
  assert.equal(prisområde(56.15, 10.21), 'DK1'); // Aarhus
  // 1,00 SEK/kWh uten mva -> 1,25 med mva, pluss 0,45 i energiskatt, til kurs 0,95
  const p = utenlandskHjemmepris([{ SEK_per_kWh: 0.8 }, { SEK_per_kWh: 1.2 }], 'SE3', '2026-11-13', { SEK: 0.95, DKK: 1.4 });
  assert.equal(p.pris, 1.62); // 1,19 + 0,43
  assert.match(p.grunnlag, /uten nettavgift/);
  assert.equal(utenlandskHjemmepris(null, 'SE3', '2026-11-13', { SEK: 0.95 }), null);

  const { tolkPhoton } = await import('../src/geokoding.js');
  const treff = tolkPhoton({ features: [
    { properties: { name: 'Göteborg', osm_key: 'place', osm_value: 'city', county: 'Västra Götalands län', countrycode: 'SE' }, geometry: { coordinates: [11.967, 57.707] } },
    { properties: { name: 'Hamburg', osm_key: 'place', osm_value: 'city', countrycode: 'DE' }, geometry: { coordinates: [10, 53.5] } },
    { properties: { name: 'Vesterbrogade', osm_key: 'highway', osm_value: 'tertiary', type: 'street', city: 'København', countrycode: 'DK' }, geometry: { coordinates: [12.55, 55.67] } },
  ] }, 'göteborg');
  assert.deepEqual(treff.map((t) => [t.navn, t.detalj, t.type]), [['Göteborg', 'Västra Götalands län, Sverige', 'sted'], ['Vesterbrogade', 'København, Danmark', 'adresse']]);
  assert.equal(treff[0].rang, 1.9); // utenlandsk by, helt navn: etter norske byer, foran norske bydeler
});

test('stedssøk i Norge: daler, landskap og øyer er med, gårder og myrer er ikke', async () => {
  const { tolkStedsnavn } = await import('../src/geokoding.js');
  const navn = (skrivemåte, type, kommune, nord, øst) => ({ skrivemåte, navneobjekttype: type, kommuner: [{ kommunenavn: kommune }], fylker: [{ fylkesnavn: 'Innlandet' }], representasjonspunkt: { nord, øst } });
  const treff = tolkStedsnavn({ navn: [
    navn('Valdres', 'Dalføre', 'Nord-Aurdal', 60.915, 9.218),
    navn('Valdres', 'Bruk', 'Eidsvoll', 60.515, 11.175),
    navn('Valdresmyra', 'Myr', 'Gran', 60.466, 10.634),
    navn('Valdresflye', 'Vidde', 'Øystre Slidre', 61.386, 8.816),
    navn('Valdresgata', 'Adressenavn', 'Oslo', 59.929, 10.762),
    navn('Valdresdalen', 'Dal', 'Ringerike', 60.51, 9.867),
  ] }, 'valdres');
  assert.deepEqual(treff.sort((a, b) => a.rang - b.rang).map((t) => [t.navn, t.detalj, t.rang]), [
    ['Valdres', 'Dalføre, Nord-Aurdal, Innlandet', 0.4],     // helt navn: foran alt som bare begynner på søket
    ['Valdresflye', 'Vidde, Øystre Slidre, Innlandet', 6],
    ['Valdresdalen', 'Dal, Ringerike, Innlandet', 6],
    ['Valdresgata', 'Adressenavn, Oslo, Innlandet', 8],
  ]);
});

test('områder vises med nærmeste by eller tettsted: Valdres -> Fagernes', async () => {
  const { tolkStedsnavn, medNærmesteSted, nærmesteSted } = await import('../src/geokoding.js');
  const steder = [
    { navn: 'Fagernes', lat: 60.9861, lon: 9.23641, type: 'town' },
    { navn: 'Leira', lat: 60.97, lon: 9.29, type: 'village' },      // litt nærmere midtpunktet, men bare en bygd
    { navn: 'Lillehammer', lat: 61.115, lon: 10.466, type: 'city' },
    { navn: 'Gibostad', lat: 69.354, lon: 18.076, type: 'village' },
    { navn: 'Finnsnes', lat: 69.2296, lon: 17.9813, type: 'town' },
  ];
  const navn = (skrivemåte, type, kommune, fylke, nord, øst) => ({ skrivemåte, navneobjekttype: type, kommuner: [{ kommunenavn: kommune }], fylker: [{ fylkesnavn: fylke }], representasjonspunkt: { nord, øst } });
  const [valdres, senja, fjell, by] = tolkStedsnavn({ navn: [
    navn('Valdres', 'Dalføre', 'Nord-Aurdal', 'Innlandet', 60.915, 9.218),
    navn('Senja', 'Øy i sjø', 'Senja', 'Troms', 69.332, 17.623),
    navn('Saltfjellet', 'Fjellområde', 'Rana', 'Nordland', 66.6, 15.3),
    navn('Hamar', 'By', 'Hamar', 'Innlandet', 60.795, 11.068),
  ] }, 'valdres').map((t) => medNærmesteSted(t, steder));

  // By eller tettsted innen 15 km går foran en bygd som ligger nærmere. Ruta går til Fagernes.
  assert.equal(nærmesteSted(60.915, 9.218, steder).navn, 'Fagernes');
  assert.deepEqual([valdres.navn, valdres.detalj, valdres.lat, valdres.lon], ['Valdres', 'Fagernes, Innlandet', 60.9861, 9.23641]);
  // Ingen by innen 15 km: nærmeste sted av alle slag innen 30 km
  assert.deepEqual([senja.navn, senja.detalj], ['Senja', 'Gibostad, Troms']);
  // Ingenting innen 30 km: områdets eget punkt beholdes, med kommune og fylke – men uten typenavnet
  assert.deepEqual([fjell.detalj, fjell.lat], ['Rana, Nordland', 66.6]);
  // Vanlige steder er uendret
  assert.deepEqual([by.detalj, by.lat], ['By, Innlandet', 60.795]);

  // Gjelder alle områder og naturnavn, ikke bare dalfører: innsjø, fjell, fjord, foss, fylke …
  const flere = tolkStedsnavn({ navn: [
    navn('Mjøsa', 'Innsjø', 'Eidsvoll', 'Innlandet', 60.95, 9.3),
    navn('Preikestolen', 'Fjell', 'Strand', 'Rogaland', 60.99, 9.2),
    navn('Sognefjorden', 'Fjord', 'Gulen', 'Vestland', 61.0, 9.25),
    navn('Vøringsfossen', 'Foss', 'Eidfjord', 'Vestland', 60.98, 9.24),
    navn('Telemark', 'Fylke', 'Skien', 'Telemark', 60.97, 9.22),
    navn('Trolltunga', 'Fjellkant', 'Ullensvang', 'Vestland', 60.96, 9.23),
    navn('Valdresmyra', 'Myr', 'Gran', 'Innlandet', 60.466, 10.634), // småsteder i terrenget er fortsatt ikke med
  ] }, '').map((t) => medNærmesteSted(t, steder));
  assert.deepEqual(flere.map((t) => [t.navn, t.detalj.split(',')[0]]), [
    ['Mjøsa', 'Fagernes'], ['Preikestolen', 'Fagernes'], ['Sognefjorden', 'Fagernes'], ['Vøringsfossen', 'Fagernes'], ['Telemark', 'Fagernes'], ['Trolltunga', 'Fagernes'],
  ]);
});

test('stedssøk i Sverige og Danmark: lokalt register, norske skrivemåter og norske steder først', async () => {
  const { lagUtenlandssøk, foldNavn, tolkEnturUtland } = await import('../src/geokoding.js');
  const { tolkSted, leggTilNærmesteBy } = await import('../scripts/lib/utland.js');
  assert.equal(foldNavn('Gøteborg'), foldNavn('Göteborg'));
  assert.equal(foldNavn('Århus'), foldNavn('Aarhus'));
  assert.equal(foldNavn('Malmø'), foldNavn('Malmö'));
  assert.equal(foldNavn('Næstved'), foldNavn('Naestved'));

  const steder = leggTilNærmesteBy([
    tolkSted({ lat: 57.7072, lon: 11.9668, tags: { name: 'Göteborg', place: 'city', population: '587 549', 'name:no': 'Gøteborg' } }, 'SE'),
    tolkSted({ lat: 55.605, lon: 13.0038, tags: { name: 'Malmö', place: 'city', population: '325069' } }, 'SE'),
    tolkSted({ lat: 57.72, lon: 10.58, tags: { name: 'Skagen', place: 'town', population: '7500' } }, 'DK'),
    tolkSted({ lat: 56.1572, lon: 10.2107, tags: { name: 'Aarhus', place: 'city', population: '290598', alt_name: 'Århus' } }, 'DK'),
    tolkSted({ lat: 57.66, lon: 12.01, tags: { name: 'Mölndal', place: 'town', population: '42000' } }, 'SE'),
    tolkSted({ lat: 57.9, lon: 12.07, tags: { name: 'Åby', place: 'village' } }, 'SE'),
    tolkSted({ lat: 56.15, lon: 10.16, tags: { name: 'Åby', place: 'village' } }, 'DK'),
  ]);
  assert.deepEqual(steder[0].alt, ['Gøteborg']);
  assert.equal(steder[0].innb, 587549);
  const søk = lagUtenlandssøk(steder);
  const vis = (q) => søk(q).map((t) => `${t.navn} (${t.detalj})`);

  assert.deepEqual(vis('Gøteborg'), ['Göteborg (By, Sverige)']);           // norsk skrivemåte
  assert.deepEqual(vis('goteb'), ['Göteborg (By, Sverige)']);              // uten prikker, bare starten
  assert.deepEqual(vis('Århus'), ['Aarhus (By, Danmark)']);
  assert.deepEqual(vis('Skagen'), ['Skagen (Tettsted, Danmark)']);
  assert.deepEqual(vis('Åby'), ['Åby (Bygd, nær Göteborg, Sverige)', 'Åby (Bygd, nær Aarhus, Danmark)']); // like navn skilles med nærmeste by
  assert.deepEqual(vis('M'), []);                                          // for kort
  assert.deepEqual(vis('Mö'), ['Mölndal (Tettsted, nær Göteborg, Sverige)']);
  assert.deepEqual(vis('Mal'), ['Malmö (By, Sverige)']);

  // Rangering mot norske treff (Kartverket: by 1, tettsted 2, bydel 3; helt navn gir 0–0,8)
  const rang = (q, navn) => søk(q).find((t) => t.navn === navn).rang;
  assert.equal(rang('Mal', 'Malmö'), 2.4);    // bak norsk tettsted «Malm» (2) når bare starten er skrevet
  assert.equal(rang('Malmö', 'Malmö'), 1.9);  // foran det norske tettstedet når hele navnet er skrevet
  assert.equal(rang('Malmø', 'Malmö'), 2.1);  // bak den norske bydelen «Malmø» (0,8), som er skrevet akkurat slik
  assert.equal(rang('Skagen', 'Skagen'), 2.9);

  // Entur: stasjoner, flyplasser og ferjekaier i Sverige og Danmark. Bussholdeplasser og norske treff tas ikke med.
  const entur = tolkEnturUtland({ features: [
    { properties: { name: 'København H', category: ['railStation'], country_a: 'DNK' }, geometry: { coordinates: [12.56, 55.67] } },
    { properties: { name: 'Torp köpcenter', category: ['onstreetBus'], country_a: 'SWE', county: 'Västra Götalands län' }, geometry: { coordinates: [11.81, 58.35] } },
    { properties: { name: 'Malmø', category: ['bydel'], country_a: 'NOR' }, geometry: { coordinates: [7.46, 58.02] } },
  ] }, 'København');
  assert.deepEqual(entur.map((t) => [t.navn, t.detalj]), [['København H', 'Stasjon, Danmark']]);
});

test('omvei med ferje uten kjent pris kalles ikke billigste', async () => {
  // Rett vei koster 24 kr i bom. Omveien (bomfri) går med en ferje som ikke finnes i pristabellen.
  const rundt = linje([[59.0, 10.0], [59.03, 10.1], [59.0, 10.2]]);
  const hentRute = async (s) => (s.unngåBomveier || s.unngaa.length || s.unngaaPunkter.length
    ? somRute(rundt, [{ navn: 'Ukjent ferje', fra: [59.015, 10.05], til: [59.03, 10.1], km: 3, sekunder: 300, startSekunder: 200 }])
    : somRute(linje([[s.fra.lat, s.fra.lon], [s.til.lat, s.til.lon]])));
  const r = await planleggRuter({ fra: A, til: B, avreise: kl('2026-11-11T12:00'), kjoretoy: bensin }, { ...miljø([rushbom(1, 10.1)]), hentRute, ferjer: [] });
  assert.deepEqual(r.ruter.map((x) => x.id), ['raskeste']);
  assert.equal(r.ruter[0].bompenger.total, 24);
});

// -------------------------------------------------------------- tur/retur ---

test('tur/retur med retur ved ankomst: hvert alternativ får hjemreise fra sin egen ankomsttid', async () => {
  const stasjoner = [rushbom(1, 10.1)];
  const m = miljø(stasjoner);
  const avreise = kl('2026-11-11T12:00');
  const ut = await planleggRuter({ fra: A, til: B, avreise, kjoretoy: bensin }, m);
  const ankomst = new Date(Math.ceil((avreise.getTime() + ut.ruter[0].sekunder * 1000) / 60000) * 60000);
  const hjem = { ...(await planleggRuter({ fra: B, til: A, avreise: ankomst, kjoretoy: bensin }, m)), avreise: ankomst };
  const spurt = [];
  const r = kombinerTurRetur(ut, (u) => { spurt.push(u.id); return hjem; }, { stasjoner, ferjer: [], kjoretoy: bensin, forbruk: {}, avreise, retur: null });
  assert.ok(spurt.includes('raskeste'));
  const rute = r.ruter[0];
  assert.equal(rute.returAvreise, '2026-11-11T12:10'); // framme 12:09:33, returen starter neste hele minutt
  assert.equal(rute.bompenger.total, 24); // returen er innenfor timen
  assert.equal(r.rutekall, ut.rutekall + hjem.rutekall); // samme hjemreiseplan telles én gang
});

test('tur/retur: timesregelen gjelder på tvers – retur innen timen blir gratis', async () => {
  const stasjoner = [rushbom(1, 10.1)];
  const m = miljø(stasjoner);
  const avreise = kl('2026-11-11T12:00'), retur = kl('2026-11-11T12:30');
  const ut = await planleggRuter({ fra: A, til: B, avreise, kjoretoy: bensin }, m);
  const hjem = await planleggRuter({ fra: B, til: A, avreise: retur, kjoretoy: bensin }, m);
  assert.equal(ut.ruter[0].bompenger.total + hjem.ruter[0].bompenger.total, 48); // priset hver for seg
  const r = kombinerTurRetur(ut, hjem, { stasjoner, ferjer: [], kjoretoy: bensin, forbruk: {}, avreise, retur });
  assert.equal(r.turRetur, true);
  assert.equal(r.ruter.length, 1);
  const rute = r.ruter[0];
  assert.equal(rute.bompenger.total, 24); // passering 12:05 betales, 12:35 er innenfor timen
  assert.deepEqual(rute.bompenger.linjer.map((l) => [l.etappe, l.status]), [['tur', 'betalt'], ['retur', 'gratis-timesregel']]);
  assert.deepEqual(rute.etapper.map((e) => e.navn), ['Tur', 'Retur']);
  assert.equal(rute.etapper[1].markører[0].status, 'gratis-timesregel'); // kartet viser det samme som utregningen
  assert.ok(Math.abs(rute.km - 2 * ut.ruter[0].km) < 0.11);
  assert.equal(rute.sekunder, ut.ruter[0].sekunder + hjem.ruter[0].sekunder);
});

test('tur/retur: retur etter mer enn en time betales på nytt, og energien regnes for hele turen', async () => {
  const stasjoner = [rushbom(1, 10.1)];
  const m = miljø(stasjoner);
  const avreise = kl('2026-11-11T12:00'), retur = kl('2026-11-11T14:00');
  const kjoretoy = { drivstoff: 'elbil', avtale: true };
  const ut = await planleggRuter({ fra: A, til: B, avreise, kjoretoy }, m);
  const hjem = await planleggRuter({ fra: B, til: A, avreise: retur, kjoretoy }, m);
  const r = kombinerTurRetur(ut, hjem, { stasjoner, ferjer: [], kjoretoy, forbruk: {}, avreise, retur });
  const rute = r.ruter[0];
  assert.equal(rute.bompenger.total, 33.6); // 2 x 16,80
  assert.equal(rute.bensinbil.bompenger, 48);
  assert.ok(Math.abs(rute.energikostnad - 2 * ut.ruter[0].energikostnad) < 0.05);
  assert.equal(rute.totalkostnad, Math.round((33.6 + rute.energikostnad) * 100) / 100);
});
