// Tester for tolkerne som leser bompengeselskapenes takstsider (scripts/lib/selskaper.js).
//
// Testene kjører mot øyeblikksbilder i test/fixtures/ (hentet 12.11.2026), ikke mot nettet.
// De fanger feil i tolkerne. At et selskap legger om siden sin, oppdages av oppdateringsscriptet
// (som melder FEIL for kilden) – da rettes tolkeren, og øyeblikksbildet fornyes med
// «node scripts/lag-testdata.js».

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tolkFerde, tolkVegamot, tolkBpsNord, tolkFjellinjen, tolkVegfinans } from '../scripts/lib/selskaper.js';
import { tilTekst, tall, normNavn } from '../scripts/lib/hent.js';
import { finnEndringer } from '../scripts/oppdater-data.js';

const les = (navn) => fs.readFileSync(new URL(`./fixtures/${navn}`, import.meta.url), 'utf8');

test('Ferde, bypakke med drivstoffdifferensiering og rushtid (Bergen)', () => {
  const d = tolkFerde(les('ferde-bergen.txt'));
  assert.deepEqual(d.felles.bensin, { avtale: 25.6, rushAvtale: 51.2, full: 32, rushFull: 64 });
  assert.deepEqual(d.felles.diesel, { avtale: 30.4, rushAvtale: 56, full: 38, rushFull: 70 });
  assert.deepEqual(d.felles.elbil, { avtale: 17.6, rushAvtale: 35.2, full: 22, rushFull: 44 });
  assert.deepEqual(d.felles.tung, { full: 47, avtale: 47, rushFull: 94 }); // Euro VI
  assert.deepEqual(d.rush.vinduer, [['06:30', '09:00'], ['14:30', '16:30']]);
  assert.equal(d.rushAlleStasjoner, false); // rushtid bare på markerte stasjoner
  assert.deepEqual(d.timesregel, { aktiv: true, minutter: 60, regel: 'dyreste', kreverAvtale: false });
  assert.equal(d.maanedstak, 60);
});

test('Ferde, felles takst uten rushtid (Nord-Jæren): elbil 70 % av avtalepris', () => {
  const d = tolkFerde(les('ferde-nord-jaeren.txt'));
  assert.deepEqual(d.felles.bensin, { avtale: 24, full: 30 });
  assert.deepEqual(d.felles.elbil, { avtale: 16.8, full: 30 }); // elbil uten avtale betaler full pris
  assert.equal(d.felles.diesel, null);
  assert.equal(d.rush, null);
  assert.equal(d.gyldigFra, 'Fra 4. august 2026');
});

test('Ferde, takst per stasjon (Ryfast): én rad for to stasjoner deles opp', () => {
  const d = tolkFerde(les('ferde-ryfast.txt'));
  assert.deepEqual(d.stasjoner.map((s) => s.navn), ['Rv. 13 Hundvågtunnel', 'Rv.13 Buøy', 'Rv. 13 Ryfylketunnel']);
  assert.deepEqual(d.stasjoner[0].bensin, { avtale: 19.2, full: 24 });
  assert.deepEqual(d.stasjoner[1].elbil, { avtale: 13.44, full: 24 });
  assert.deepEqual(d.stasjoner[2], { navn: 'Rv. 13 Ryfylketunnel', bensin: { avtale: 95.2, full: 119 }, elbil: { avtale: 66.64, full: 119 }, tung: { full: 357, avtale: 357 } });
  assert.equal(d.felles, null);
});

test('Ferde, Kristiansand: rushtid på alle stasjoner og egen elbiltakst uten avtale', () => {
  const d = tolkFerde(les('ferde-kristiansand.txt'));
  assert.deepEqual(d.felles.bensin, { avtale: 20, rushAvtale: 30.4, full: 25, rushFull: 38 });
  assert.deepEqual(d.felles.elbil, { avtale: 10.4, rushAvtale: 15.2, full: 13, rushFull: 19 });
  assert.equal(d.rushAlleStasjoner, true);
  assert.deepEqual(d.rush?.vinduer, [['06:30', '09:00'], ['14:30', '17:00']]);
});

test('Vegamot, Miljøpakken Trondheim: stasjonsnummer, rushtid og nullutslipp', () => {
  const d = tolkVegamot(les('vegamot-trondheim.txt'));
  assert.equal(d.stasjoner.length, 22);
  assert.deepEqual(d.stasjoner[0], {
    nr: 51, navn: 'Fv707 Klett',
    bensin: { full: 22, rushFull: 44, avtale: 17.6, rushAvtale: 35.2 },
    elbil: { full: 22, rushFull: 44, avtale: 12.32, rushAvtale: 24.64 },
    tung: { full: 53, rushFull: 106, avtale: 53 },
  });
  const tempe = d.stasjoner.find((s) => s.nr === 66);
  assert.deepEqual(tempe.bensin, { full: 16, rushFull: 21, avtale: 12.8, rushAvtale: 16.8 });
  assert.deepEqual(d.rush.vinduer, [['07:00', '09:00'], ['15:00', '17:00']]);
  assert.equal(d.maanedstak, 110);
  assert.equal(new Set(d.stasjoner.map((s) => s.nr)).size, 22, 'hver stasjon skal bare leses én gang');
});

test('Vegamot uten rushtid (Ålesund): tre kolonner per stasjon', () => {
  const d = tolkVegamot(les('vegamot-alesund.txt'));
  assert.equal(d.stasjoner.length, 12);
  assert.deepEqual(d.stasjoner[0], { nr: 1, navn: 'Klipra', bensin: { full: 31, avtale: 24.8 }, elbil: { full: 31, avtale: 17.36 }, tung: { full: 61, avtale: 61 } });
  assert.equal(d.rush, null);
});

test('BPS Nord, felles takst (Bodø) og rushtid med «første passering»-regel (Tromsø)', () => {
  const bodø = tolkBpsNord(les('bpsnord-bodo.txt'));
  assert.deepEqual(bodø.felles.bensin, { full: 22, avtale: 17.6, rushFull: null, rushAvtale: null });
  assert.equal(bodø.felles.elbil.avtale, 12.32);
  assert.deepEqual(bodø.timesregel, { aktiv: true, minutter: 60, regel: null });
  assert.equal(bodø.maanedstak, 80);

  const tromsø = tolkBpsNord(les('bpsnord-tromso.txt'));
  assert.deepEqual(tromsø.felles.bensin, { full: 14, avtale: 11.2, rushFull: 42, rushAvtale: 33.6 });
  assert.deepEqual(tromsø.felles.elbil, { full: 14, avtale: 7.84, rushFull: 42, rushAvtale: 23.52 });
  assert.deepEqual(tromsø.rush.vinduer, [['06:30', '09:00'], ['15:00', '17:00']]);
  assert.equal(tromsø.timesregel.regel, 'forste');
});

test('Fjellinjen (Oslo): bensin, diesel og elbil, med 20 % brikkerabatt og juli-unntak', () => {
  const d = tolkFjellinjen(les('fjellinjen.txt'));
  assert.deepEqual(d.felles.bensin, { full: 38, rushFull: 47, avtale: 30.4, rushAvtale: 37.6 });
  assert.deepEqual(d.felles.diesel, { full: 42, rushFull: 50, avtale: 33.6, rushAvtale: 40 });
  assert.deepEqual(d.felles.elbil, { full: 21, rushFull: 26, avtale: 16.8, rushAvtale: 20.8 });
  assert.deepEqual(d.felles.tung, { full: 109, rushFull: 162, avtale: 109 }); // Euro 6
  assert.deepEqual(d.rush, { vinduer: [['06:30', '09:00'], ['15:00', '17:00']], unntattJuli: true });
});

test('Vegfinans: stasjoner med nøkkel som kobles mot NVDB (operatør:stasjonsnummer)', () => {
  const d = tolkVegfinans(les('vegfinans-grenland.html'));
  assert.equal(d.stasjoner.length, 13);
  assert.deepEqual(d.stasjoner[0], { nokkel: '100113:1', navn: 'Elstrømbrua', bensin: { full: 21, avtale: 16.8 }, elbil: { full: 21, avtale: 11.76 }, tung: { full: 42, avtale: 42 } });
  assert.equal(d.stasjoner.at(-1).nokkel, '100113:13');
  assert.equal(d.maanedstak, 60);
});

test('tolkerne gir null i stedet for gale tall når siden ikke har en pristabell', () => {
  const tom = '<html><body><h1>Vi oppgraderer nettsiden</h1></body></html>';
  assert.equal(tolkFerde(tom), null);
  assert.equal(tolkVegamot(tom), null);
  assert.equal(tolkBpsNord(tom), null);
  assert.equal(tolkFjellinjen(tom), null);
  assert.equal(tolkVegfinans(tom), null);
});

test('hjelpefunksjoner: HTML til tekst, tall og navnesammenligning', () => {
  assert.equal(tilTekst('<table><tr><td>Med&nbsp;avtale</td><td>25,60</td></tr></table><script>x()</script>'), '|Med avtale|25,60|');
  assert.equal(tall('kr 22,00'), 22);
  assert.equal(tall('11.20'), 11.2);
  assert.equal(tall('38 kr'), 38);
  assert.equal(tall('–'), null);
  assert.equal(normNavn('Rv. 13 Hundvågtunnel'), normNavn('hundvågtunnel'));
  assert.equal(normNavn('E18 Bjørndalsletta'), 'bjørndalsletta');
});

test('endringsrapport: prisendring, ny og fjernet bom beskrives i klartekst', () => {
  const bom = (id, navn, bensin, elbil) => ({ id, navn, prosjektNavn: 'Testpakken', retning: 'begge', belastesKurs: null, prisUsikker: false, takster: { bensin: { full: bensin, avtale: bensin * 0.8, rushFull: null, rushAvtale: null }, diesel: { full: bensin, avtale: bensin * 0.8, rushFull: null, rushAvtale: null }, elbil: { full: bensin, avtale: elbil, rushFull: null, rushAvtale: null }, tung: { full: 60, avtale: 60, rushFull: null, rushAvtale: null } } });
  const før = [bom(1, 'A', 30, 16.8), bom(2, 'B', 20, 11.2), bom(3, 'C', 10, 5.6)];
  const etter = [bom(1, 'A', 32, 17.92), bom(2, 'B', 20, 11.2), bom(4, 'D', 15, 8.4)];
  const e = finnEndringer(før, etter);
  assert.ok(e.includes('A (Testpakken): bensin uten avtale 30 → 32 kr'));
  assert.ok(e.includes('A (Testpakken): elbil med avtale 16.8 → 17.92 kr'));
  assert.ok(e.includes('Ny bom: D (Testpakken)'));
  assert.ok(e.includes('Fjernet: C (Testpakken)'));
  assert.ok(!e.some((x) => x.startsWith('B ')), 'uendret bom skal ikke nevnes');
  assert.ok(!e.some((x) => /diesel/.test(x)), 'diesel som følger bensin skal ikke gjentas');
  assert.deepEqual(finnEndringer(før, før), []);
});
