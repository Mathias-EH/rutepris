// Bom- og broavgifter i Sverige og Danmark.
//
// Posisjoner: betalstasjonene hentes fra OpenStreetMap (Overpass), der hver portal og hver luke i et
//             betalingsanlegg er registrert for seg.
// Takster:    lagt inn for hånd fra de offisielle sidene under, med dato for når de ble lest.
//             De endres sjelden (høyst årlig), men må kontrolleres når året skifter.
// Valuta:     beløpene står i SEK/DKK og regnes om med Norges Banks siste kurs.

import fs from 'node:fs/promises';
import path from 'node:path';
import { hentValutakurser, fasteTakster } from '../../src/valuta.js';

const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
const UA = { 'User-Agent': 'bomruta-dataoppdatering/1.0' };
const LEST = '2026-11-12';

/**
 * Trängselskatt: beløp i SEK etter klokkeslett. Rader er [fra, til, høysesong, lavsesong].
 * Likt for alle kjøretøy som er skattepliktige, også utenlandske. Ingen rabatt for brikke eller elbil.
 */
export const TIDSTAKSTER = {
  'se-stockholm-innerstad': {
    navn: 'Trängselskatt Stockholm (innerstaden)', valuta: 'SEK', fridager: 'stockholm', sesonger: true, dagstak: [135, 105],
    kilde: 'https://www.transportstyrelsen.se/sv/vagtrafik/Trangselskatt/Trangselskatt-i-Stockholm/tider-och-belopp/', lest: LEST,
    rader: [['06:00', '06:30', 15, 15], ['06:30', '07:00', 30, 25], ['07:00', '08:30', 45, 35], ['08:30', '09:00', 30, 25], ['09:00', '09:30', 20, 15], ['09:30', '15:00', 11, 11],
      ['15:00', '15:30', 20, 15], ['15:30', '16:00', 30, 25], ['16:00', '17:30', 45, 35], ['17:30', '18:00', 30, 25], ['18:00', '18:30', 20, 15]],
  },
  'se-stockholm-essingeleden': {
    navn: 'Trängselskatt Stockholm (Essingeleden)', valuta: 'SEK', fridager: 'stockholm', sesonger: true, dagstak: [135, 105],
    kilde: 'https://www.transportstyrelsen.se/sv/vagtrafik/Trangselskatt/Trangselskatt-i-Stockholm/tider-och-belopp/', lest: LEST,
    rader: [['06:00', '06:30', 15, 15], ['06:30', '07:00', 27, 22], ['07:00', '08:30', 40, 30], ['08:30', '09:00', 27, 22], ['09:00', '09:30', 20, 15], ['09:30', '15:00', 11, 11],
      ['15:00', '15:30', 20, 15], ['15:30', '16:00', 27, 22], ['16:00', '17:30', 40, 30], ['17:30', '18:00', 27, 22], ['18:00', '18:30', 20, 15]],
  },
  'se-goteborg': {
    navn: 'Trängselskatt Göteborg', valuta: 'SEK', fridager: 'goteborg', sesonger: false, dagstak: [60],
    kilde: 'https://www.transportstyrelsen.se/sv/vagtrafik/Trangselskatt/Trangselskatt-i-goteborg/tider-och-belopp/', lest: LEST,
    rader: [['06:00', '06:30', 9], ['06:30', '07:00', 16], ['07:00', '08:00', 22], ['08:00', '08:30', 16], ['08:30', '15:00', 9], ['15:00', '15:30', 16], ['15:30', '17:00', 22], ['17:00', '18:00', 16], ['18:00', '18:30', 9]],
  },
};

/**
 * Broer med fast pris. bil = personbil inntil 6 m / 3,5 t. tung = null betyr at prisen avhenger av
 * lengde og ikke er lagt inn. automatisk = pris med brikke eller skiltgjenkjenning der den er lavere.
 */
export const FASTE_AVGIFTER = {
  motalabron: { prosjekt: 'se-motalabron', navn: 'Motalabron', land: 'SE', valuta: 'SEK', bil: 5, tung: 11, lest: LEST,
    kilde: 'https://www.transportstyrelsen.se/sv/vagtrafik/fordon/skatter-och-avgifter/infrastrukturavgift/broavgift-motala/' },
  sundsvallsbron: { prosjekt: 'se-sundsvallsbron', navn: 'Sundsvallsbron', land: 'SE', valuta: 'SEK', bil: 9, tung: 20, lest: LEST,
    kilde: 'https://www.transportstyrelsen.se/sv/vagtrafik/fordon/skatter-och-avgifter/infrastrukturavgift/' },
  skurubron: { prosjekt: 'se-skurubron', navn: 'Skurubron', land: 'SE', valuta: 'SEK', bil: 4, tung: 4, lest: LEST,
    kilde: 'https://www.transportstyrelsen.se/sv/vagtrafik/fordon/skatter-och-avgifter/infrastrukturavgift/',
    usikker: 'Beløpet (4 SEK) er hentet fra andre nettsteder og er ikke bekreftet hos Transportstyrelsen.' },
  storebaelt: { prosjekt: 'dk-storebaelt', navn: 'Storebæltsbroen', land: 'DK', valuta: 'DKK', bil: 235, automatisk: 205, tung: null, lest: LEST,
    kilde: 'https://storebaelt.dk/priser/' },
  oresund: { prosjekt: 'dk-oresund', navn: 'Øresundsbron', land: 'DK', valuta: 'DKK', bil: 470, tung: null, lest: LEST,
    kilde: 'https://www.oresundsbron.com/da/priser',
    merknad: 'Normalpris i betalingsanlegget. Onlinebillett koster 420 DKK, og ØresundGO-avtale gir 182 DKK per tur.' },
};

// Valutakursen hentes av src/valuta.js, som serveren også bruker til den daglige oppdateringen.
export { hentValutakurser };

/** Alle bomportaler og betalingsluker i Sverige og Danmark fra OpenStreetMap. */
export async function hentBomportaler(cacheFil, frisk = false) {
  if (!frisk) {
    try {
      const c = JSON.parse(await fs.readFile(cacheFil, 'utf8'));
      if (Date.now() - new Date(c.hentet).getTime() < 30 * 86400000) return c.elementer; // stasjonene flyttes sjelden
    } catch { /* ingen cache ennå */ }
  }
  const q = '[out:json][timeout:120];area["ISO3166-1"~"^(SE|DK)$"][admin_level=2]->.a;(node["highway"="toll_gantry"](area.a);node["barrier"="toll_booth"](area.a););out;';
  let feil = null;
  for (const url of OVERPASS) {
    try {
      const res = await fetch(url, { method: 'POST', headers: { ...UA, 'Content-Type': 'application/x-www-form-urlencoded' }, body: `data=${encodeURIComponent(q)}`, signal: AbortSignal.timeout(180000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const elementer = (await res.json()).elements.map((e) => ({ id: e.id, lat: e.lat, lon: e.lon, tags: e.tags || {} }));
      if (elementer.length < 100 || elementer.some((e) => !Number.isFinite(e.lat) || !Number.isFinite(e.lon))) throw new Error(`ufullstendig svar (${elementer.length} elementer)`);
      await fs.mkdir(path.dirname(cacheFil), { recursive: true });
      await fs.writeFile(cacheFil, JSON.stringify({ hentet: new Date().toISOString(), elementer }));
      return elementer;
    } catch (e) { feil = e; }
  }
  throw new Error(`Overpass svarte ikke: ${feil?.message}`);
}

/**
 * Trafikverkets vegferjer (Färjerederiet) i Sverige. De er en del av vegnettet og gratis.
 * Hentes fra OpenStreetMap som ferjelinjer med operatør; endepunktene brukes som kaier.
 * Kilde for at de er avgiftsfrie: https://www.trafikverket.se/farjerederiet/
 */
export async function hentGratisferjer(cacheFil, frisk = false) {
  if (!frisk) {
    try {
      const c = JSON.parse(await fs.readFile(cacheFil, 'utf8'));
      if (Date.now() - new Date(c.hentet).getTime() < 30 * 86400000) return c.ferjer;
    } catch { /* ingen cache ennå */ }
  }
  const q = '[out:json][timeout:90];way["route"="ferry"]["operator"~"Trafikverket|Färjerederiet",i](55,10.5,69.1,24.3);out geom;';
  let feil = null;
  for (const url of OVERPASS) {
    try {
      const res = await fetch(url, { method: 'POST', headers: { ...UA, 'Content-Type': 'application/x-www-form-urlencoded' }, body: `data=${encodeURIComponent(q)}`, signal: AbortSignal.timeout(120000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const ferjer = tolkGratisferjer((await res.json()).elements);
      if (ferjer.length < 20) throw new Error(`bare ${ferjer.length} ferjer`);
      await fs.mkdir(path.dirname(cacheFil), { recursive: true });
      await fs.writeFile(cacheFil, JSON.stringify({ hentet: new Date().toISOString(), ferjer }));
      return ferjer;
    } catch (e) { feil = e; }
  }
  throw new Error(`Overpass svarte ikke: ${feil?.message}`);
}

/** OSM-ferjelinjer -> ferjer i samme form som data/ferjer.json, med pris 0. */
export function tolkGratisferjer(elementer) {
  const gratis = { fra: '2000-01-01', til: '2100-01-01', full: 0, fullNull: 0, brikke: 0, brikkeNull: 0, forskudd: 0, forskuddNull: 0 };
  return elementer
    .filter((e) => e.geometry?.length >= 2 && e.tags?.motor_vehicle !== 'no' && e.tags?.motorcar !== 'no' && e.tags?.fee !== 'yes' && !e.tags?.charge)
    .map((e) => {
      const a = e.geometry[0], b = e.geometry.at(-1);
      const navn = e.tags.name || 'Vegferje';
      return {
        id: `osm:${e.id}`, samband: navn, strekning: navn, land: 'SE', operator: 'Trafikverket Färjerederiet', turRetur: false,
        kilde: 'https://www.trafikverket.se/farjerederiet/',
        a: { navn, lat: a.lat, lon: a.lon, id: null }, b: { navn, lat: b.lat, lon: b.lon, id: null },
        priser: [gratis],
      };
    });
}

/**
 * Stedsnavn i Sverige og Danmark: alle byer, tettsteder og landsbyer i OpenStreetMap.
 * Lagres lokalt (data/steder-utland.json), slik at stedssøket er raskt og ikke avhenger av en
 * ekstern tjeneste for hvert tastetrykk.
 */
export const hentSteder = (cacheFil, frisk = false) => hentStederFor(['SE', 'DK'], cacheFil, frisk);

/**
 * Byer, tettsteder og bygder i Norge fra OpenStreetMap (data/steder-norge.json). Selve stedssøket i Norge
 * bruker Kartverket; denne lista brukes til å finne nærmeste by eller tettsted når søket treffer et
 * område (Valdres, Lofoten, Senja), slik at ruta går til et sted med vei og ikke til områdets midtpunkt.
 */
export const hentNorskeSteder = (cacheFil, frisk = false) => hentStederFor(['NO'], cacheFil, frisk);

async function hentStederFor(landliste, cacheFil, frisk) {
  if (!frisk) {
    try {
      const c = JSON.parse(await fs.readFile(cacheFil, 'utf8'));
      if (Date.now() - new Date(c.hentet).getTime() < 90 * 86400000) return c.steder; // stedsnavn endres sjelden
    } catch { /* ingen cache ennå */ }
  }
  const steder = [];
  for (const land of landliste) {
    const q = `[out:json][timeout:240];area["ISO3166-1"="${land}"][admin_level=2]->.a;node["place"~"^(city|town|village)$"]["name"](area.a);out;`;
    let feil = null, ok = false;
    for (const url of OVERPASS) {
      try {
        const res = await fetch(url, { method: 'POST', headers: { ...UA, 'Content-Type': 'application/x-www-form-urlencoded' }, body: `data=${encodeURIComponent(q)}`, signal: AbortSignal.timeout(300000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const elementer = (await res.json()).elements;
        if (elementer.length < 500) throw new Error(`bare ${elementer.length} steder i ${land}`);
        steder.push(...elementer.map((e) => tolkSted(e, land)));
        ok = true;
        break;
      } catch (e) { feil = e; }
    }
    if (!ok) throw new Error(`Overpass svarte ikke for ${land}: ${feil?.message}`);
  }
  leggTilNærmesteBy(steder);
  await fs.mkdir(path.dirname(cacheFil), { recursive: true });
  await fs.writeFile(cacheFil, JSON.stringify({ hentet: new Date().toISOString(), steder }));
  return steder;
}

/** OSM-node -> { navn, alt, lat, lon, type, land, innb }. alt = andre skrivemåter (norsk navn, eldre navn). */
export function tolkSted(e, land) {
  const t = e.tags || {};
  const alt = [t['name:no'], t['name:nb'], t['name:nn'], t['name:da'], t['name:sv'], t.alt_name, t.old_name]
    .flatMap((x) => String(x || '').split(';')).map((x) => x.trim()).filter((x, i, a) => x && x !== t.name && a.indexOf(x) === i);
  const innb = Number(String(t.population || '').replace(/\s/g, ''));
  return { navn: t.name, alt, lat: Math.round(e.lat * 1e5) / 1e5, lon: Math.round(e.lon * 1e5) / 1e5, type: t.place, land, innb: Number.isFinite(innb) && innb > 0 ? innb : null };
}

/** Småsteder får nærmeste by som tillegg («nær Göteborg»), så like navn kan skilles fra hverandre. */
export function leggTilNærmesteBy(steder) {
  const byer = steder.filter((s) => s.type === 'city' || (s.type === 'town' && (s.innb || 0) >= 20000));
  for (const s of steder) {
    if (s.type === 'city') continue;
    let best = null, bestKm = 80;
    for (const b of byer) {
      if (b === s || b.land !== s.land) continue;
      const dx = (b.lon - s.lon) * 111.2 * Math.cos((s.lat * Math.PI) / 180), dy = (b.lat - s.lat) * 111.2, km = Math.hypot(dx, dy);
      if (km < bestKm) { best = b; bestKm = km; }
    }
    if (best) s.nær = best.navn;
  }
  return steder;
}

const iBoks = (e, [lat0, lon0, lat1, lon1]) => e.lat >= lat0 && e.lat <= lat1 && e.lon >= lon0 && e.lon <= lon1;
const STOCKHOLM = [59.2, 17.8, 59.45, 18.25], GOTEBORG = [57.6, 11.8, 57.8, 12.15], ORESUND = [55.55, 12.86, 55.585, 12.94];
// Betalstasjonene på og ved Essingeleden (nr. 8 og 9 hos Transportstyrelsen, og rampene på Essingeøyene)
const ESSINGE = /^(Essingeleden|Kristineberg|Drottningholmsvägen|Stora Essingen|Lilla Essingen)$/;

/** Hvilken avgift en OSM-portal tilhører, eller null når den ikke er en av dem vi har takst for. */
export function klassifiser(e) {
  const t = e.tags, navn = t.name || '';
  if (/^Motalabron$/i.test(navn)) return { fast: 'motalabron' };
  if (/^Sundsvallsbron$/i.test(navn)) return { fast: 'sundsvallsbron' };
  if (/^Skurubron$/i.test(navn)) return { fast: 'skurubron' };
  if (/STOREB[ÆA]LT/i.test(t.operator || '')) return { fast: 'storebaelt' };
  if (t.barrier === 'toll_booth' && iBoks(e, ORESUND)) return { fast: 'oresund' };
  const trängsel = t.highway === 'toll_gantry' && (t.operator === 'Transportstyrelsen' || t['fee:conditional']);
  if (trängsel && iBoks(e, STOCKHOLM)) return { by: 'stockholm', essinge: ESSINGE.test(navn), hovedløp: navn === 'Essingeleden' };
  if (trängsel && iBoks(e, GOTEBORG)) return { by: 'goteborg' };
  return null;
}

const kr = (x) => Math.round(x * 100) / 100;
const ID_START = 1e13; // OSM-id-er forskyves, så de aldri kolliderer med NVDB-id-ene

/**
 * Bygger stasjonslista. Hver portal/luke blir én stasjon; `snitt` samler dem som står i samme
 * betalstasjon, slik at en passering bare telles én gang.
 */
export function byggUtland(elementer, kurser) {
  const stasjoner = [];
  const felles = (e, land) => ({
    id: ID_START + e.id, land, lat: e.lat, lon: e.lon, retning: 'begge', belastesKurs: null, vegretning: null, type: 'utland',
    rush: null, takster: null, sistVerifisert: LEST, merknader: [], usikkerGrunner: [], prisUsikker: false,
  });
  for (const e of elementer) {
    const k = klassifiser(e);
    if (!k) continue;
    if (k.fast) {
      const f = FASTE_AVGIFTER[k.fast], kurs = kurser[f.valuta];
      // Beløpene i landets valuta følger med, så serveren kan regne om når kursen endrer seg
      const valutabeløp = { valuta: f.valuta, bil: f.bil, automatisk: f.automatisk ?? null, tung: f.tung ?? null };
      const s = {
        ...felles(e, f.land), navn: f.navn, prosjekt: f.prosjekt, prosjektNavn: f.navn, selskap: f.land === 'SE' ? 'Transportstyrelsen' : f.navn,
        snitt: f.prosjekt, valutabeløp, takster: fasteTakster(valutabeløp, kurs),
        // Alle lukene i anlegget er samme bom: tell passeringen én gang, og sperr dem samlet når bommen skal unngås
        timesregel: { aktiv: true, minutter: 10, gruppe: 'anlegg', regel: 'dyreste' },
        valutapris: { full: `${f.bil} ${f.valuta}`, avtale: `${f.automatisk ?? f.bil} ${f.valuta}` },
        kilder: [f.kilde, 'https://www.openstreetmap.org'],
      };
      if (f.merknad) s.merknader.push(f.merknad);
      if (f.usikker) { s.prisUsikker = true; s.usikkerGrunner.push(f.usikker); }
      stasjoner.push(s);
      continue;
    }
    const navn = e.tags.name || 'Betalstation';
    if (k.by === 'stockholm') {
      // Hovedløpet på Essingeleden har egen tabell. Rampene inn mot innerstaden lar seg ikke skille sikkert fra
      // hovedløpet i OpenStreetMap, så de prises som innerstaden og merkes usikre (inntil 5 SEK forskjell).
      const s = {
        ...felles(e, 'SE'), navn, prosjekt: 'se-stockholm', prosjektNavn: 'Trängselskatt Stockholm', selskap: 'Transportstyrelsen',
        snitt: `se-stockholm|${k.essinge ? 'essingeleden' : navn}`, ring: 'se-stockholm',
        tidstakstId: k.hovedløp ? 'se-stockholm-essingeleden' : 'se-stockholm-innerstad',
        // Fredhäll og Kristineberg på Essingeleden regnes som én passering
        timesregel: k.essinge ? { aktiv: true, minutter: 20, gruppe: 'essingeleden', regel: 'dyreste' } : { aktiv: false },
        kilder: [TIDSTAKSTER['se-stockholm-innerstad'].kilde, 'https://www.openstreetmap.org'],
      };
      if (k.essinge) { s.prisUsikker = true; s.usikkerGrunner.push('Betalstasjonene ved Essingeleden har to beløpstabeller (Essingeleden og innerstaden). Beløpet kan avvike med inntil 5 SEK.'); }
      stasjoner.push(s);
    } else {
      stasjoner.push({
        ...felles(e, 'SE'), navn, prosjekt: 'se-goteborg', prosjektNavn: 'Trängselskatt Göteborg', selskap: 'Transportstyrelsen',
        snitt: `se-goteborg|${navn}`, ring: 'se-goteborg', tidstakstId: 'se-goteborg',
        // Flerpassasjeregelen: flere passeringer innen 60 minutter gir én skatt, den høyeste
        timesregel: { aktiv: true, minutter: 60, gruppe: 'flerpassasje', regel: 'dyreste' },
        kilder: [TIDSTAKSTER['se-goteborg'].kilde, 'https://www.openstreetmap.org'],
      });
    }
  }
  stasjoner.sort((a, b) => a.prosjektNavn.localeCompare(b.prosjektNavn, 'nb') || a.navn.localeCompare(b.navn, 'nb') || a.id - b.id);
  const tidstakster = Object.fromEntries(Object.entries(TIDSTAKSTER).map(([id, t]) => [id, { ...t, kurs: kurser[t.valuta] }]));
  const antall = (p) => stasjoner.filter((s) => s.prosjekt === p).length;
  return {
    stasjoner, tidstakster,
    statistikk: {
      portaler: stasjoner.length,
      stockholm: antall('se-stockholm'), goteborg: antall('se-goteborg'),
      broerSverige: ['se-motalabron', 'se-sundsvallsbron', 'se-skurubron'].filter(antall).length,
      storebaelt: antall('dk-storebaelt'), oresund: antall('dk-oresund'),
      betalstasjoner: new Set(stasjoner.map((s) => s.snitt)).size,
      prisUsikker: stasjoner.filter((s) => s.prisUsikker).length,
    },
  };
}
