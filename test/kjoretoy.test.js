// Tester for ferjepriser og tolkingen av kjøretøyoppslag.
//
// NB: Eksempelsvarene fra kjøretøyregisteret er bygget etter den publiserte spesifikasjonen
// (https://akfell-datautlevering.atlas.vegvesen.no/v3/api-docs), ikke hentet fra tjenesten,
// siden det krever API-nøkkel.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tolkKjøretøydata, gyldigRegnr, normaliserRegnr, slåOppKjøretøy } from '../src/kjoretoy.js';
import { finnFerje, ferjepris } from '../src/ferje.js';
import { lesVeggklokke } from '../src/pris.js';

/** Bygger et svar med samme struktur som KjoretoydataResponse. `utslipp` er ett ForbrukOgUtslipp-objekt. */
const svar = ({ drivstoff, utslipp = {}, hybrid = null, totalvekt = 2100, klasse = 'M1', merke = 'VOLKSWAGEN', modell = 'ID.4' }) => ({
  kjoretoydataListe: [{
    kjoretoyId: { kjennemerke: 'EL12345', understellsnummer: 'X' },
    godkjenning: { tekniskGodkjenning: {
      kjoretoyklassifisering: { beskrivelse: 'Personbil', tekniskKode: { kodeVerdi: klasse } },
      tekniskeData: {
        generelt: { merke: [{ merke, merkeKode: '1' }], handelsbetegnelse: [modell] },
        vekter: { egenvekt: 1900, tekniskTillattTotalvekt: totalvekt },
        motorOgDrivverk: { ...(hybrid ? { hybridKategori: { kodeNavn: hybrid } } : {}), motor: drivstoff.map((d) => ({ drivstoff: [{ drivstoffKode: { kodeNavn: d } }] })) },
        miljodata: { miljoOgdrivstoffGruppe: [{ drivstoffKodeMiljodata: { kodeNavn: drivstoff[0] }, forbrukOgUtslipp: [utslipp] }] },
      },
    } },
  }],
});

test('kjøretøyoppslag: elbil – energiforbruk i Wh/km regnes om til kWh/100 km', () => {
  const bil = tolkKjøretøydata(svar({ drivstoff: ['Elektrisk'], utslipp: { wltpKjoretoyspesifikk: { elEnergiforbruk: 169, rekkeviddeKmBlandetkjoring: 533 } } }));
  assert.deepEqual(bil, { regnr: 'EL12345', merke: 'VOLKSWAGEN', modell: 'ID.4', drivstoff: 'elbil', wltp: 16.9, enhet: 'kWh', rekkevidde: 533, totalvekt: 2100 });
});

test('kjøretøyoppslag: slik registeret faktisk svarer for en elbil uten forbrukstall', () => {
  // Formen er hentet fra et ekte svar (2019-modell): kjennemerke med mellomrom, totalvekt i
  // «tillattTotalvekt», to elmotorer, hybridkategori «Ingen» og bare rekkevidde under WLTP.
  const ekte = { kjoretoydataListe: [{
    kjoretoyId: { kjennemerke: 'EB 11111', understellsnummer: 'X' },
    godkjenning: { tekniskGodkjenning: {
      kjoretoyklassifisering: { beskrivelse: 'Personbil', tekniskKode: { kodeNavn: 'Personbil', kodeVerdi: 'M1' } },
      tekniskeData: {
        generelt: { merke: [{ merke: 'AUDI', merkeKode: '1230' }], handelsbetegnelse: ['Audi e-tron'] },
        vekter: { egenvekt: 2591, tillattTotalvekt: 3130 },
        motorOgDrivverk: { hybridKategori: { kodeNavn: 'Ingen', kodeVerdi: 'INGEN' }, motor: [{ drivstoff: [{ drivstoffKode: { kodeNavn: 'Elektrisk', kodeVerdi: '5' } }] }, { drivstoff: [{ drivstoffKode: { kodeNavn: 'Elektrisk', kodeVerdi: '5' } }] }] },
        miljodata: { miljoOgdrivstoffGruppe: [{ drivstoffKodeMiljodata: { kodeNavn: 'Elektrisk', kodeVerdi: '5' }, forbrukOgUtslipp: [{ malemetode: { kodeVerdi: 'WLTP' }, wltpKjoretoyspesifikk: { rekkeviddeKmBlandetkjoring: 372, nedcRekkeviddeKm: 372 } }] }] },
      },
    } },
  }] };
  assert.deepEqual(tolkKjøretøydata(ekte), { regnr: 'EB11111', merke: 'AUDI', modell: 'Audi e-tron', drivstoff: 'elbil', wltp: null, enhet: 'kWh', rekkevidde: 372, totalvekt: 3130 });
});

test('kjøretøyoppslag: bensin og diesel med WLTP, eldre bil med NEDC-tall', () => {
  const bensin = tolkKjøretøydata(svar({ drivstoff: ['Bensin'], utslipp: { wltpKjoretoyspesifikk: { forbrukKombinert: 6.1 } } }));
  assert.equal(bensin.drivstoff, 'bensin');
  assert.equal(bensin.wltp, 6.1);
  assert.equal(bensin.enhet, 'liter');
  assert.equal(tolkKjøretøydata(svar({ drivstoff: ['Diesel'], utslipp: { wltpTypegodkjenningMedium: { forbrukKombinert: 5.2 } } })).wltp, 5.2);
  const gammel = tolkKjøretøydata(svar({ drivstoff: ['Diesel'], utslipp: { forbrukBlandetKjoring: 7.2 } }));
  assert.equal(gammel.drivstoff, 'diesel');
  assert.equal(gammel.wltp, 7.2);
  assert.equal(tolkKjøretøydata(svar({ drivstoff: ['Bensin'], utslipp: {} })).wltp, null); // ingen forbrukstall: standardverdi brukes
});

test('kjøretøyoppslag: ladbar hybrid har elektrisk rekkevidde, vanlig hybrid regnes som fossilbil', () => {
  const ladbar = tolkKjøretøydata(svar({ drivstoff: ['Bensin', 'Elektrisk'], utslipp: { wltpKjoretoyspesifikk: { forbrukKombinert: 1.4, rekkeviddeKmBlandetkjoring: 55 } } }));
  assert.equal(ladbar.drivstoff, 'hybrid');
  assert.equal(tolkKjøretøydata(svar({ drivstoff: ['Bensin', 'Elektrisk'], hybrid: 'Ekstern lading (OVC-HEV)', utslipp: {} })).drivstoff, 'hybrid');
  const vanlig = tolkKjøretøydata(svar({ drivstoff: ['Bensin', 'Elektrisk'], hybrid: 'Ikke ekstern lading (NOVC-HEV)', utslipp: { wltpKjoretoyspesifikk: { forbrukKombinert: 4.6 } } }));
  assert.equal(vanlig.drivstoff, 'bensin');
  assert.equal(vanlig.wltp, 4.6);
});

test('kjøretøyoppslag: tungt kjøretøy, men bobil i gruppe M1 regnes som takstgruppe 1', () => {
  assert.equal(tolkKjøretøydata(svar({ drivstoff: ['Diesel'], totalvekt: 12000, klasse: 'N2' })).drivstoff, 'tung');
  assert.equal(tolkKjøretøydata(svar({ drivstoff: ['Diesel'], utslipp: { forbrukBlandetKjoring: 9 }, totalvekt: 4200, klasse: 'M1' })).drivstoff, 'diesel');
});

test('kjøretøyoppslag: tomt svar, ugyldig registreringsnummer og manglende nøkkel', async () => {
  assert.equal(tolkKjøretøydata({ feilmelding: 'OPPLYSNINGER_IKKE_TILGJENGELIGE', kjoretoydataListe: [] }), null);
  assert.equal(tolkKjøretøydata(null), null);
  assert.equal(normaliserRegnr(' el 12345 '), 'EL12345');
  assert.equal(gyldigRegnr('EL12345'), true);
  assert.equal(gyldigRegnr('AB1234'), true);
  assert.equal(gyldigRegnr('MINBIL'), true); // personlig kjennemerke
  assert.equal(gyldigRegnr('A'), false);
  assert.equal(gyldigRegnr('EL12345678'), false);
  await assert.rejects(() => slåOppKjøretøy('EL12345', ''), /SVV_API_KEY/);
  await assert.rejects(() => slåOppKjøretøy('!!', 'nøkkel'), /Ugyldig/);
});

// ------------------------------------------------------------------ ferje ---

const ferje = {
  strekning: 'A ferjekai - B ferjekai', turRetur: false,
  a: { lat: 59.0, lon: 10.0 }, b: { lat: 59.0, lon: 10.1 },
  priser: [
    { fra: '2026-01-01', til: '2026-07-01', full: 100, fullNull: 70, brikke: 90, brikkeNull: 63, forskudd: 50, forskuddNull: 35 },
    { fra: '2026-07-01', til: '2027-01-01', full: 110, fullNull: 77, brikke: 99, brikkeNull: 69.3, forskudd: 55, forskuddNull: 38.5 },
  ],
};

test('ferje finnes uansett kjøreretning, men ikke når kaiene ligger langt unna', () => {
  assert.equal(finnFerje([ferje], [59.001, 10.001], [59.0, 10.099]), ferje);
  assert.equal(finnFerje([ferje], [59.0, 10.1], [59.0, 10.0]), ferje);
  assert.equal(finnFerje([ferje], [59.2, 10.0], [59.2, 10.1]), null);
  assert.equal(finnFerje([{ ...ferje, a: null }], [59.0, 10.0], [59.0, 10.1]), null);
});

test('ferjepris: brikke gir 10 %, nullutslipp egen takst, og prisen følger datoen', () => {
  const vår = lesVeggklokke('2026-03-01T12:00'), høst = lesVeggklokke('2026-11-12T12:00');
  assert.deepEqual(ferjepris(ferje, { drivstoff: 'bensin', avtale: false }, vår), { pris: 100, forskuddPris: 50 });
  assert.deepEqual(ferjepris(ferje, { drivstoff: 'bensin', avtale: true }, vår), { pris: 90, forskuddPris: 50 });
  assert.deepEqual(ferjepris(ferje, { drivstoff: 'elbil', avtale: true }, vår), { pris: 63, forskuddPris: 35 });
  assert.deepEqual(ferjepris(ferje, { drivstoff: 'elbil', avtale: true }, høst), { pris: 69.3, forskuddPris: 38.5 });
  assert.equal(ferjepris(ferje, { drivstoff: 'hybrid', avtale: false }, høst).pris, 110);
  // Tunge kjøretøy prises etter lengde, og dato utenfor prislista gir ukjent
  assert.equal(ferjepris(ferje, { drivstoff: 'tung', avtale: true }, vår).pris, null);
  assert.equal(ferjepris(ferje, { drivstoff: 'bensin', avtale: true }, lesVeggklokke('2028-01-01T12:00')).pris, null);
});

test('data/ferjer.json: ferjestrekninger med posisjon og AP1-pris', () => {
  const d = JSON.parse(fs.readFileSync(new URL('../data/ferjer.json', import.meta.url), 'utf8'));
  assert.ok(d.ferjer.length > 300, `bare ${d.ferjer.length} strekninger`);
  assert.ok(d.ferjer.filter((f) => f.a && f.b).length / d.ferjer.length > 0.85, 'for få ferjekaier med posisjon');
  for (const f of d.ferjer) {
    for (const p of f.priser) {
      assert.ok(p.full >= 0 && p.brikke <= p.full && p.forskudd <= p.brikke && p.fullNull <= p.full, `${f.strekning}: ${JSON.stringify(p)}`);
      assert.ok(p.fra < p.til);
    }
    if (f.a) assert.ok(f.a.lat > 57 && f.a.lat < 72 && f.a.lon > 4 && f.a.lon < 32, f.strekning);
  }
  const mortavika = d.ferjer.find((f) => /Mortavika/.test(f.strekning) && /Arsvågen/.test(f.strekning));
  assert.ok(mortavika?.a && mortavika.priser.length, 'Mortavika–Arsvågen mangler');
  const mossHorten = d.ferjer.find((f) => f.samband === 'Moss - Horten');
  assert.ok(mossHorten?.a && mossHorten.b, 'Moss–Horten mangler');
});

test('Moss–Horten (lagt inn for hånd): 10 % med brikke og 30 % med avtale, også for elbil', async () => {
  const { EKSTRA_SAMBAND, ekstraSamband } = await import('../scripts/lib/ferjer.js');
  const f = ekstraSamband(EKSTRA_SAMBAND.find((e) => e.samband === 'Moss - Horten'));
  const dag = lesVeggklokke('2026-11-13T10:00');
  assert.equal(ferjepris(f, { drivstoff: 'bensin', avtale: false }, dag).pris, 304);
  assert.deepEqual(ferjepris(f, { drivstoff: 'bensin', avtale: true }, dag), { pris: 273.6, forskuddPris: 212.8 });
  assert.equal(ferjepris(f, { drivstoff: 'elbil', avtale: false }, dag).pris, 213);
  assert.deepEqual(ferjepris(f, { drivstoff: 'elbil', avtale: true }, dag), { pris: 191.7, forskuddPris: 149.1 });
  assert.equal(ferjepris(f, { drivstoff: 'bensin', avtale: true }, lesVeggklokke('2026-12-31T23:00')).pris, 273.6); // gjelder ut året
  assert.equal(ferjepris(f, { drivstoff: 'bensin', avtale: true }, lesVeggklokke('2027-01-01T10:00')).pris, null); // ukjent til nye takster er lagt inn
  // Kaiene ligger der ferja faktisk går, så ruta mellom dem kobles til riktig samband
  assert.equal(finnFerje([f], [59.4305, 10.6543], [59.4122, 10.4881])?.samband, 'Moss - Horten');
});
