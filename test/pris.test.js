// Enhetstester for prisberegningen. Kjør med: npm test
//
// Testene bruker faste eksempelbommer (takster per november 2026) slik at de ikke
// endrer seg når data/bomstasjoner.json oppdateres.

import test from 'node:test';
import assert from 'node:assert/strict';
import { beregnBompenger, takstFor, erRushtid, erHelligdag, lesVeggklokke, energikostnad, energiberegning, realistiskForbruk, erVinter, forbrukFor } from '../src/pris.js';

const kl = (tekst) => lesVeggklokke(tekst);
const takst = (full, rush = null, andel = 1) => ({
  full, avtale: +(full * 0.8 * andel).toFixed(2),
  rushFull: rush, rushAvtale: rush == null ? null : +(rush * 0.8 * andel).toFixed(2),
});

// Oslo: bensin 38/47, diesel 42/50, elbil 21/26 (elbiltakst gjelder også uten avtale), Euro 6 109/162
const osloTakster = {
  bensin: takst(38, 47), diesel: takst(42, 50),
  elbil: { full: 21, avtale: 16.8, rushFull: 26, rushAvtale: 20.8 },
  tung: { full: 109, avtale: 109, rushFull: 162, rushAvtale: 162 },
};
const osloRush = { vinduer: [['06:30', '09:00'], ['15:00', '17:00']], ukedager: [1, 2, 3, 4, 5], unntattHelligdager: true, unntattJuli: true };
const oslo = (id, navn, gruppe = '230301') => ({
  id, navn, prosjekt: 'oslo', prosjektNavn: 'Oslopakke 3', takster: osloTakster, rush: osloRush,
  timesregel: { aktiv: true, minutter: 60, gruppe, regel: 'dyreste' },
});
const bygrensen = oslo(1, 'E18 Lysaker (Bygrensen)', '230307');
const osloringen = oslo(2, 'E18 Maritim (Osloringen)');
const indreRing = oslo(3, 'Bygdøy allé (Indre ring)');

// Strekningsbom uten timesregel: 30 kr, elbil 70 % av avtalepris, krever avtale
const e18 = {
  id: 10, navn: 'E18 Mørland', prosjekt: 'e18-tvedestrand-arendal', prosjektNavn: 'E18 Tvedestrand – Arendal',
  takster: { bensin: takst(30), diesel: takst(30), elbil: { full: 30, avtale: 16.8, rushFull: null, rushAvtale: null }, tung: { full: 76, avtale: 76, rushFull: null, rushAvtale: null } },
  rush: null, timesregel: { aktiv: false },
};

const elbilAvtale = { drivstoff: 'elbil', avtale: true };
const bensinAvtale = { drivstoff: 'bensin', avtale: true };

// --------------------------------------------------------------- rabatter ---

test('standard: elbil med AutoPASS-avtale betaler elbiltakst med 20 % brikkerabatt', () => {
  assert.equal(takstFor(osloringen, elbilAvtale, kl('2026-11-11T12:00')).pris, 16.8);
});

test('bensin med avtale får 20 % rabatt, uten avtale full pris', () => {
  assert.equal(takstFor(osloringen, bensinAvtale, kl('2026-11-11T12:00')).pris, 30.4);
  assert.equal(takstFor(osloringen, { drivstoff: 'bensin', avtale: false }, kl('2026-11-11T12:00')).pris, 38);
});

test('diesel er dyrere enn bensin der takstene er miljødifferensiert', () => {
  assert.equal(takstFor(osloringen, { drivstoff: 'diesel', avtale: true }, kl('2026-11-11T12:00')).pris, 33.6);
});

test('ladbar hybrid belastes som bensinbil', () => {
  assert.equal(takstFor(osloringen, { drivstoff: 'hybrid', avtale: true }, kl('2026-11-11T12:00')).pris, 30.4);
});

test('tungt kjøretøy (takstgruppe 2) får ikke brikkerabatt', () => {
  assert.equal(takstFor(osloringen, { drivstoff: 'tung', avtale: true }, kl('2026-11-11T12:00')).pris, 109);
});

test('elbil uten avtale: full ordinær pris på strekningsbom, men elbiltakst i Oslo', () => {
  const utenAvtale = { drivstoff: 'elbil', avtale: false };
  assert.equal(takstFor(e18, utenAvtale, kl('2026-11-11T12:00')).pris, 30);
  assert.equal(takstFor(e18, elbilAvtale, kl('2026-11-11T12:00')).pris, 16.8); // 30 * 0,8 * 0,7
  assert.equal(takstFor(osloringen, utenAvtale, kl('2026-11-11T12:00')).pris, 21);
});

// ---------------------------------------------------------------- rushtid ---

test('rushtid: onsdag 07:30 er rush, 12:00 er ikke', () => {
  assert.equal(erRushtid(osloRush, kl('2026-11-11T07:30')), true);
  assert.equal(erRushtid(osloRush, kl('2026-11-11T12:00')), false);
});

test('rushtid: grensene er fra og med 06:30, til (ikke med) 09:00', () => {
  assert.equal(erRushtid(osloRush, kl('2026-11-11T06:29')), false);
  assert.equal(erRushtid(osloRush, kl('2026-11-11T06:30')), true);
  assert.equal(erRushtid(osloRush, kl('2026-11-11T08:59')), true);
  assert.equal(erRushtid(osloRush, kl('2026-11-11T09:00')), false);
});

test('rushtid gjelder ikke lørdag og søndag', () => {
  assert.equal(erRushtid(osloRush, kl('2026-11-14T07:30')), false); // lørdag
  assert.equal(erRushtid(osloRush, kl('2026-11-15T16:00')), false); // søndag
});

test('rushtid gjelder ikke på helligdager', () => {
  assert.equal(erHelligdag(kl('2026-05-14T08:00')), true);  // Kristi himmelfartsdag 2026 (torsdag)
  assert.equal(erHelligdag(kl('2026-04-03T08:00')), true);  // langfredag 2026
  assert.equal(erHelligdag(kl('2026-05-25T08:00')), true);  // 2. pinsedag 2026
  assert.equal(erHelligdag(kl('2026-11-11T08:00')), false);
  assert.equal(erRushtid(osloRush, kl('2026-05-14T07:30')), false);
  assert.equal(erRushtid(osloRush, kl('2026-12-25T07:30')), false);
});

test('rushtid: juli er unntatt i Oslo, men ikke i en bom uten juli-unntak', () => {
  assert.equal(erRushtid(osloRush, kl('2026-07-08T07:30')), false);
  assert.equal(erRushtid({ ...osloRush, unntattJuli: false }, kl('2026-07-08T07:30')), true);
});

test('rushtidstakst brukes når passeringen skjer i rush', () => {
  assert.deepEqual(takstFor(osloringen, elbilAvtale, kl('2026-11-11T07:30')), { pris: 20.8, rush: true });
  assert.deepEqual(takstFor(osloringen, bensinAvtale, kl('2026-11-11T07:30')), { pris: 37.6, rush: true });
});

// ------------------------------------------------------------- timesregel ---

test('timesregel: to bommer i samme ring innen 60 minutter – bare én betales', () => {
  const r = beregnBompenger([
    { stasjon: osloringen, tid: kl('2026-11-11T12:00') },
    { stasjon: indreRing, tid: kl('2026-11-11T12:10') },
  ], elbilAvtale);
  assert.equal(r.total, 16.8);
  assert.equal(r.totalUtenTimesregel, 33.6);
  assert.deepEqual(r.linjer.map((l) => l.status), ['betalt', 'gratis-timesregel']);
  assert.match(r.linjer[1].forklaring, /timesregel/);
});

test('timesregel: den dyreste passeringen i vinduet belastes', () => {
  // Første passering 14:50 (ordinær), andre 15:05 (rush) – rushpasseringen er dyrest.
  const r = beregnBompenger([
    { stasjon: osloringen, tid: kl('2026-11-11T14:50') },
    { stasjon: indreRing, tid: kl('2026-11-11T15:05') },
  ], bensinAvtale);
  assert.equal(r.total, 37.6);
  assert.deepEqual(r.linjer.map((l) => l.status), ['gratis-timesregel', 'betalt']);
});

test('timesregel med regel «første»: første passering bestemmer prisen', () => {
  const forste = (s) => ({ ...s, timesregel: { ...s.timesregel, regel: 'forste' } });
  const r = beregnBompenger([
    { stasjon: forste(osloringen), tid: kl('2026-11-11T14:50') },
    { stasjon: forste(indreRing), tid: kl('2026-11-11T15:05') },
  ], bensinAvtale);
  assert.equal(r.total, 30.4);
  assert.deepEqual(r.linjer.map((l) => l.status), ['betalt', 'gratis-timesregel']);
});

test('timesregel: vinduet regnes fra første passering og varer 60 minutter', () => {
  const r = beregnBompenger([
    { stasjon: osloringen, tid: kl('2026-11-11T12:00') },
    { stasjon: indreRing, tid: kl('2026-11-11T12:59') },  // innenfor
    { stasjon: osloringen, tid: kl('2026-11-11T13:00') }, // nytt vindu
    { stasjon: indreRing, tid: kl('2026-11-11T13:30') },  // innenfor det nye
  ], elbilAvtale);
  assert.deepEqual(r.linjer.map((l) => l.status), ['betalt', 'gratis-timesregel', 'betalt', 'gratis-timesregel']);
  assert.equal(r.total, 33.6);
});

test('timesregel gjelder ikke på tvers av ringer/pakker', () => {
  // Bygrensen og Osloringen er egne timesregel-grupper; E18-bommen er en annen pakke.
  const r = beregnBompenger([
    { stasjon: e18, tid: kl('2026-11-11T11:00') },
    { stasjon: bygrensen, tid: kl('2026-11-11T12:00') },
    { stasjon: osloringen, tid: kl('2026-11-11T12:10') },
  ], elbilAvtale);
  assert.equal(r.antallBetalt, 3);
  assert.equal(r.total, 50.4); // 3 x 16,80
});

test('bom uten timesregel belastes hver gang', () => {
  const r = beregnBompenger([
    { stasjon: e18, tid: kl('2026-11-11T12:00') },
    { stasjon: e18, tid: kl('2026-11-11T12:20') },
  ], bensinAvtale);
  assert.equal(r.total, 48);
});

test('timesregel som krever avtale gis ikke uten avtale', () => {
  const kvam = (id) => ({ ...e18, id, prosjekt: 'kvam', timesregel: { aktiv: true, minutter: 90, gruppe: '370017', regel: 'dyreste', kreverAvtale: true } });
  const pass = [{ stasjon: kvam(1), tid: kl('2026-11-11T12:00') }, { stasjon: kvam(2), tid: kl('2026-11-11T13:15') }];
  assert.equal(beregnBompenger(pass, bensinAvtale).total, 24);                       // 90 minutter, én betales
  assert.equal(beregnBompenger(pass, { drivstoff: 'bensin', avtale: false }).total, 60); // ingen timesregel
});

// ------------------------------------------------ hele turer (eksempler) ----

test('eksempel: gjennom Oslo i rushtid koster mer enn utenom rush', () => {
  // Inn fra vest: Bygrensen, så Osloringen, så Indre ring – ca. 8 minutter mellom hver.
  const tur = (start) => {
    const t0 = kl(start).getTime();
    return [bygrensen, osloringen, indreRing].map((stasjon, i) => ({ stasjon, tid: new Date(t0 + i * 8 * 60000) }));
  };
  const rush = beregnBompenger(tur('2026-11-11T07:40'), elbilAvtale);
  const utenom = beregnBompenger(tur('2026-11-11T11:00'), elbilAvtale);
  // Bygrensen er egen gruppe; Osloringen + Indre ring deler timesregel -> to betalte passeringer.
  assert.equal(rush.total, 41.6);   // 2 x 20,80
  assert.equal(utenom.total, 33.6); // 2 x 16,80
  assert.equal(rush.antallBetalt, 2);
  assert.equal(rush.antallGratisTimesregel, 1);
  // Samme tur med bensinbil uten avtale i rush: 2 x 47
  assert.equal(beregnBompenger(tur('2026-11-11T07:40'), { drivstoff: 'bensin', avtale: false }).total, 94);
});

test('eksempel: tur som starter før rush og passerer neste bom i rush', () => {
  // Avreise 06:20: Bygrensen 06:25 (ordinær), Osloringen 06:33 (rush).
  const r = beregnBompenger([
    { stasjon: bygrensen, tid: kl('2026-11-11T06:25') },
    { stasjon: osloringen, tid: kl('2026-11-11T06:33') },
  ], elbilAvtale);
  assert.deepEqual(r.linjer.map((l) => l.rush), [false, true]);
  assert.equal(r.total, 37.6); // 16,80 + 20,80
});

test('rute utenom bommene koster 0 kr', () => {
  const r = beregnBompenger([], elbilAvtale);
  assert.equal(r.total, 0);
  assert.equal(r.antallPasseringer, 0);
});

// ------------------------------------------------------------ usikre data ---

test('bom uten kjent takst gir «ukjent», ikke en gjettet pris', () => {
  const ukjent = { id: 99, navn: 'Ny bom', prosjekt: 'x', prosjektNavn: 'X', takster: null, rush: null, timesregel: { aktiv: false }, prisUsikker: true, usikkerGrunner: ['Takst mangler'] };
  const r = beregnBompenger([{ stasjon: ukjent, tid: kl('2026-11-11T12:00') }, { stasjon: e18, tid: kl('2026-11-11T12:30') }], bensinAvtale);
  assert.equal(r.total, 24);
  assert.equal(r.harUkjent, true);
  assert.equal(r.harUsikker, true);
  assert.equal(r.linjer[0].status, 'ukjent');
});

test('passeringer sorteres på tidspunkt før beregning', () => {
  const r = beregnBompenger([
    { stasjon: indreRing, tid: kl('2026-11-11T12:10') },
    { stasjon: osloringen, tid: kl('2026-11-11T12:00') },
  ], elbilAvtale);
  assert.deepEqual(r.linjer.map((l) => l.navn), ['E18 Maritim (Osloringen)', 'Bygdøy allé (Indre ring)']);
});

// ---------------------------------------------------------- energikostnad ---

test('energikostnad for omvei: 20 km ekstra med elbil og med bensinbil', () => {
  const sommer = kl('2026-07-01T12:00'), vinter = kl('2026-01-15T12:00');
  assert.equal(energikostnad(20, 'elbil', { pris: 2 }, sommer), 6.96);  // 20 km * 17,4 kWh/100 km (snittbil, sommer) * 2,00 kr
  assert.equal(energikostnad(20, 'elbil', { pris: 2 }, vinter), 8.48);  // vinter: 17,4 * 1,22 = 21,2 kWh/100 km
  assert.equal(energikostnad(20, 'elbil', {}, sommer), 2.92);           // standard hjemmepris 0,84 kr/kWh (Norgespris + nettleie)
  assert.equal(energikostnad(20, 'bensin', {}, vinter), 37);            // 20 km * 7,4 l/100 km * 25,00 kr, uavhengig av årstid
  assert.equal(energikostnad(100, 'elbil', { pris: 5 }, sommer), 87);
  assert.equal(energikostnad(100, 'bensin', { per100km: 6 }, sommer), 150);
});

test('elbil på langtur: hjemmeladet strøm først, hurtiglading for resten', () => {
  const sommer = kl('2026-07-01T12:00'), vinter = kl('2026-01-15T12:00');
  // Sommer: rekkevidde 448 km, 80 % = 358,4 km på hjemmeladet strøm
  const kort = energiberegning(200, 'elbil', { pris: 1 }, sommer);
  assert.equal(kort.hjemmeKm, 200);
  assert.equal(kort.hurtigKm, 0);
  assert.equal(kort.kostnad, 34.8); // 200 km * 17,4 kWh/100 km * 1,00 kr
  const lang = energiberegning(500, 'elbil', { pris: 1, hurtigpris: 6 }, sommer);
  assert.equal(lang.hjemmeKm, 358.4);
  assert.equal(lang.hurtigKm, 141.6);
  assert.equal(lang.kostnad, 210.19); // 358,4 km * 0,174 * 1,00 + 141,6 km * 0,174 * 6,00
  // Vinter: rekkevidden krymper til 448 / 1,22 = 367 km, så hurtigladingen starter tidligere
  const vinterTur = energiberegning(500, 'elbil', { pris: 1, hurtigpris: 6 }, vinter);
  assert.equal(vinterTur.rekkeviddeKm, 367);
  assert.equal(vinterTur.hjemmeKm, 293.6);
  assert.ok(vinterTur.kostnad > lang.kostnad);
  // Bilens egen rekkevidde fra kjøretøyregisteret overstyrer standarden
  assert.equal(energiberegning(500, 'elbil', { rekkevidde: 372 }, sommer).hjemmeKm, 297.6);
  // Fossilbiler har ingen slik deling
  assert.equal(energiberegning(500, 'bensin', {}, sommer).hurtigKm, null);
});

test('realistisk forbruk: WLTP regnes om til forbruk på veien', () => {
  const sommer = kl('2026-07-01T12:00'), vinter = kl('2026-12-01T12:00');
  assert.equal(realistiskForbruk(16.9, 'elbil', sommer), 16.9); // NAF sommer: omtrent WLTP
  assert.equal(realistiskForbruk(16.9, 'elbil', vinter), 20.6); // NAF vinter: 18 % kortere rekkevidde
  assert.equal(realistiskForbruk(6.0, 'bensin', sommer), 6.8);  // ICCT: 14 % over WLTP
  assert.equal(realistiskForbruk(5.0, 'diesel', vinter), 5.7);
  assert.equal(realistiskForbruk(1.5, 'hybrid', sommer), 4.2);  // ICCT: ladbare hybrider bruker ca. 4,2 l uansett WLTP
  assert.equal(realistiskForbruk(null, 'elbil', sommer), null);
  assert.equal(erVinter(kl('2026-03-31T12:00')), true);
  assert.equal(erVinter(kl('2026-04-01T12:00')), false);
  assert.deepEqual(forbrukFor('elbil', {}, vinter), { per100km: 21.2, pris: 0.84, enhet: 'kWh', hurtigpris: 5.9, rekkeviddeKm: 367 });
  assert.equal(forbrukFor('elbil', { per100km: 18 }, vinter).per100km, 18);
  assert.deepEqual(forbrukFor('bensin', {}, vinter), { per100km: 7.4, pris: 25, enhet: 'liter' });
});
