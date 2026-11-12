// Tester for bomtreff langs en rute (retning, avstand) og unngå-polygoner.

import test from 'node:test';
import assert from 'node:assert/strict';
import { finnPasseringer, unngaaPolygon, flytt, kurs, kursAvvik, dekodPolyline, konveksHylle, punktIPolygon, meter } from '../src/geo.js';

const start = [59.9, 10.7];
/** Rett rute nordover fra `start`, 2 km, ett punkt per 100 m, 20 m/s. */
const ruteNord = () => {
  const punkter = Array.from({ length: 21 }, (_, i) => flytt(start, 0, i * 100));
  return { punkter, tider: punkter.map((_, i) => i * 5) };
};
const bom = (egenskaper) => ({ id: 1, navn: 'Testbom', prosjekt: 'test', retning: 'begge', belastesKurs: null, vegretning: 0, ...egenskaper });
const paaRuta = (m, sideM = 0) => { const [lat, lon] = flytt(flytt(start, 0, m), 90, sideM); return { lat, lon }; };

test('toveisbom på ruta gir én passering med riktig tidspunkt', () => {
  const { punkter, tider } = ruteNord();
  const treff = finnPasseringer(punkter, tider, [bom(paaRuta(1050))]);
  assert.equal(treff.length, 1);
  assert.ok(Math.abs(treff[0].sekunder - 52.5) < 0.5, `tid ${treff[0].sekunder}`);
});

test('bom 200 m til siden for ruta gir ingen passering', () => {
  const { punkter, tider } = ruteNord();
  assert.equal(finnPasseringer(punkter, tider, [bom(paaRuta(1000, 200))]).length, 0);
});

test('enveisbom belastes bare i innkrevingsretningen', () => {
  const { punkter, tider } = ruteNord();
  const nordover = bom({ ...paaRuta(1000), retning: 'en', belastesKurs: 5 });
  const sørover = bom({ ...paaRuta(1000), retning: 'en', belastesKurs: 185 });
  assert.equal(finnPasseringer(punkter, tider, [nordover]).length, 1);
  assert.equal(finnPasseringer(punkter, tider, [sørover]).length, 0);
  // Samme bommer, motsatt kjøreretning
  const tilbake = [...punkter].reverse();
  assert.equal(finnPasseringer(tilbake, tider, [nordover]).length, 0);
  assert.equal(finnPasseringer(tilbake, tider, [sørover]).length, 1);
});

test('enveisbom i nabokjørebanen (15 m til siden) treffes fortsatt i riktig retning', () => {
  const { punkter, tider } = ruteNord();
  const b = bom({ ...paaRuta(1000, 15), retning: 'en', belastesKurs: 0 });
  assert.equal(finnPasseringer(punkter, tider, [b]).length, 1);
});

test('to NVDB-objekter for samme bompunkt teller som én passering', () => {
  const { punkter, tider } = ruteNord();
  const a = bom({ id: 1, ...paaRuta(1000, 4) }), b = bom({ id: 2, ...paaRuta(1010, 14) });
  const treff = finnPasseringer(punkter, tider, [a, b]);
  assert.equal(treff.length, 1);
  assert.equal(treff[0].stasjon.id, 1);
});

test('bommer i ulike prosjekter på samme sted telles hver for seg', () => {
  const { punkter, tider } = ruteNord();
  const treff = finnPasseringer(punkter, tider, [bom({ id: 1, ...paaRuta(1000) }), bom({ id: 2, prosjekt: 'annet', ...paaRuta(1010) })]);
  assert.equal(treff.length, 2);
});

test('passeringer returneres i kjørerekkefølge', () => {
  const { punkter, tider } = ruteNord();
  const treff = finnPasseringer(punkter, tider, [bom({ id: 2, prosjekt: 'b', ...paaRuta(1500) }), bom({ id: 1, prosjekt: 'a', ...paaRuta(300) })]);
  assert.deepEqual(treff.map((t) => t.stasjon.id), [1, 2]);
});

test('samme bom passert to ganger med god tid mellom gir to passeringer', () => {
  const ut = ruteNord();
  const punkter = [...ut.punkter, ...[...ut.punkter].reverse()];
  const tider = punkter.map((_, i) => i * 5);
  assert.equal(finnPasseringer(punkter, tider, [bom(paaRuta(500))]).length, 2);
});

test('unngå-polygon er lite, lukket og ligger rundt bommen', () => {
  const s = bom({ ...paaRuta(1000), retning: 'en', vegretning: 0 });
  const p = unngaaPolygon(s);
  assert.equal(p.length, 5);
  assert.deepEqual(p[0], p[4]);
  for (const [lon, lat] of p) assert.ok(meter([lat, lon], [s.lat, s.lon]) < 20);
  // Smalere på tvers (øst–vest) enn på langs (nord–sør) for en enveisbom på en vei som går nordover
  const bredde = meter([p[0][1], p[0][0]], [p[1][1], p[1][0]]), lengde = meter([p[1][1], p[1][0]], [p[2][1], p[2][0]]);
  assert.ok(bredde < lengde, `bredde ${bredde} lengde ${lengde}`);
  assert.ok(punktIPolygon([s.lat, s.lon], p.map(([lon, lat]) => [lat, lon])));
});

test('hjelpefunksjoner: kurs, kursavvik, polyline og konveks hylle', () => {
  assert.ok(Math.abs(kurs(start, flytt(start, 90, 500)) - 90) < 0.5);
  assert.equal(kursAvvik(350, 10), 20);
  assert.deepEqual(dekodPolyline('_izlhA~rlgdF_{geC~ywl@', 6), [[38.5, -120.2], [40.7, -120.95]]);
  const hylle = konveksHylle([[0, 0], [0, 2], [2, 2], [2, 0], [1, 1]]);
  assert.equal(hylle.length, 4);
  assert.equal(punktIPolygon([1, 1], hylle), true);
  assert.equal(punktIPolygon([3, 3], hylle), false);
});
