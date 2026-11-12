// Henter ferjepriser fra Statens vegvesens prismodul på autopassferje.no og finner
// posisjonen til hver ferjekai via Enturs holdeplassregister.
//
// Prismodulen ligger som én JSON-struktur («priceObject») i siden https://autopassferje.no/priser/
// og dekker alle samband som bruker AutoPASS-regulativet, med priser per takstklasse og dato.

import fs from 'node:fs/promises';
import path from 'node:path';
import { hent, hentJson, parallelt } from './hent.js';

export const FERJE_KILDE = 'https://autopassferje.no/priser/';
const ENTUR = 'https://api.entur.io/geocoder/v1/autocomplete';

const rad = (g) => (g * Math.PI) / 180;
const km = (a, b) => {
  const x = rad(b.lon - a.lon) * Math.cos(rad((a.lat + b.lat) / 2)), y = rad(b.lat - a.lat);
  return Math.sqrt(x * x + y * y) * 6371;
};

export function tolkPrismodul(html) {
  const m = html.match(/var priceObject = (\[[\s\S]*?\]);\s*(?:\/\/# sourceURL|<\/script>)/);
  if (!m) throw new Error('fant ikke priceObject på autopassferje.no');
  return JSON.parse(m[1]);
}

/** Finner posisjonen til en ferjekai. Foretrekker treff i riktig fylke som er merket som havn/ferjestopp. */
async function finnKai(navn, fylke) {
  // Prismodulen og holdeplassregisteret skriver ikke alltid navnet likt («X kai», «X ferjekai», «X»).
  const rot = navn.replace(/\s+(ferjekai|kai|ferjeleie)$/i, '');
  for (const variant of [...new Set([navn, `${rot} ferjekai`, `${rot} kai`, rot])]) {
    const d = await hentJson(`${ENTUR}?text=${encodeURIComponent(variant)}&layers=venue&lang=no&size=8&boundary.country=NOR`, { headers: { 'ET-Client-Name': 'bomruta-dataoppdatering' } });
    const kandidater = (d.features || []).map((f) => {
      const kat = f.properties.category || [];
      const havn = kat.some((k) => /harbour|ferry/i.test(k));
      const riktigFylke = (f.properties.county || '').toLowerCase().includes(fylke.toLowerCase().split(' ')[0]);
      const sammeNavn = f.properties.name.toLowerCase().startsWith(rot.toLowerCase());
      return { id: f.properties.id, navn: f.properties.name, lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0], ok: riktigFylke && havn && sammeNavn, poeng: (havn ? 2 : 0) + (riktigFylke ? 3 : 0) + (sammeNavn ? 1 : 0) };
    });
    kandidater.sort((a, b) => b.poeng - a.poeng);
    const beste = kandidater[0];
    // Krever riktig fylke. Første variant godtas også uten havnemerking (slik som før); de løsere variantene må være merket som havn.
    if (beste && (variant === navn ? beste.poeng >= 3 : beste.ok)) return { id: beste.id, navn: beste.navn, lat: beste.lat, lon: beste.lon };
  }
  return null;
}

const kr = (x) => (x == null ? null : Math.round(x * 100) / 100);

/**
 * Samband som ikke ligger i prismodulen på autopassferje.no. Prisene er lagt inn for hånd fra
 * rederiets takstside og gjelder bare ut gyldighetsperioden – etter den vises «ukjent pris» til
 * tallene er oppdatert her.
 *
 * Moss–Horten (Bastø Fosen, rv. 19), takster 2026 for kjøretøy 0–6 m:
 *   fullpris 304 kr, nullutslipp 213 kr. AutoPASS-brikke gir 10 % rabatt, egen avtale for
 *   sambandet gir 30 %. Rabattprisene under er regnet ut fra disse satsene.
 *   Kilde: https://torghatten.no/en/our-routes/Rv19 (lest 12.11.2026)
 */
export const EKSTRA_SAMBAND = [{
  id: 'rv19:Moss - Horten',
  samband: 'Moss - Horten',
  operator: 'Bastø Fosen',
  kilde: 'https://torghatten.no/en/our-routes/Rv19',
  turRetur: false,
  forskuddRabatt: 0.3,
  a: { navn: 'Moss ferjekai', fylke: 'Østfold', lat: 59.4319, lon: 10.6557 },
  b: { navn: 'Horten ferjekai', fylke: 'Vestfold', lat: 59.4132, lon: 10.4911 },
  priser: [{ fra: '2026-01-01', til: '2027-01-01', full: 304, fullNull: 213 }], // «til» er første dag prisen ikke gjelder
}];

/** Regner ut rabattprisene for et håndlagt samband: brikke 10 %, avtale etter sambandets egen sats. */
export function ekstraSamband(e, kaiA = null, kaiB = null) {
  const kai = (k, funnet) => ({ navn: k.navn, lat: funnet?.lat ?? k.lat, lon: funnet?.lon ?? k.lon, id: funnet?.id || null });
  return {
    id: e.id, samband: e.samband, strekning: `${e.a.navn} - ${e.b.navn}`, fylke: `${e.a.fylke}/${e.b.fylke}`, operator: e.operator,
    takstsone: null, turRetur: e.turRetur, kilde: e.kilde, forskuddRabatt: e.forskuddRabatt,
    a: kai(e.a, kaiA), b: kai(e.b, kaiB),
    priser: e.priser.map((p) => ({
      fra: p.fra, til: p.til, full: p.full, fullNull: p.fullNull,
      brikke: kr(p.full * 0.9), brikkeNull: kr(p.fullNull * 0.9),
      forskudd: kr(p.full * (1 - e.forskuddRabatt)), forskuddNull: kr(p.fullNull * (1 - e.forskuddRabatt)),
    })),
  };
}

/**
 * @returns { ferjer, statistikk }
 * Hver ferje: { id, samband, strekning, fylke, operator, takstsone, turRetur, a, b, priser: [{ fra, til, full, fullNull, brikke, brikkeNull, forskudd, forskuddNull }] }
 * Prisene gjelder takstklasse AP1 (kjøretøy inntil 6 m). brikke = AutoPASS-brikke uten forskuddsavtale (10 % rabatt),
 * forskudd = AutoPASS for ferje forskuddsavtale privat (50 %). *Null = nullutslippskjøretøy.
 */
export async function hentFerjer(cacheFil, frisk = false) {
  const samband = tolkPrismodul(await hent(FERJE_KILDE, { timeoutMs: 60000 }));
  let cache = {};
  if (!frisk) { try { cache = JSON.parse(await fs.readFile(cacheFil, 'utf8')); } catch { /* ingen cache ennå */ } }

  const strekninger = samband.flatMap((s) => s.strekninger.map((x) => ({ s, x })));
  const kaier = [...new Map(strekninger.flatMap(({ s, x }) => x.strekning.split(' - ').map((k) => [`${s.fylke}|${k.trim()}`, { navn: k.trim(), fylke: s.fylke }]))).entries()];
  await parallelt(kaier.filter(([nokkel]) => !(nokkel in cache)), 4, async ([nokkel, k]) => {
    try { cache[nokkel] = await finnKai(k.navn, k.fylke); } catch { /* prøves igjen neste kjøring */ }
  });
  // Kaiene til de håndlagte sambandene: posisjonen står i lista, holdeplass-id (for rutetider) hentes fra Entur
  for (const e of EKSTRA_SAMBAND) for (const k of [e.a, e.b]) {
    const nokkel = `${k.fylke}|${k.navn}`;
    if (!(nokkel in cache)) { try { cache[nokkel] = await finnKai(k.navn, k.fylke); } catch { /* prøves igjen neste kjøring */ } }
  }
  await fs.mkdir(path.dirname(cacheFil), { recursive: true });
  await fs.writeFile(cacheFil, JSON.stringify(cache));

  const iDag = Date.now();
  const ferjer = [];
  let utenPosisjon = 0;
  for (const { s, x } of strekninger) {
    const [navnA, navnB] = x.strekning.split(' - ').map((k) => k.trim());
    let a = cache[`${s.fylke}|${navnA}`] || null, b = cache[`${s.fylke}|${navnB}`] || null;
    if (a && b && km(a, b) > 120) { a = null; b = null; } // åpenbart feil treff
    if (!a || !b) utenPosisjon++;
    const priser = x.priser
      .filter((p) => p.takstklasse === 'AP1' && new Date(p.gyldig_til_dato).getTime() > iDag)
      .map((p) => ({
        fra: p.gyldig_fra_dato.slice(0, 10), til: p.gyldig_til_dato.slice(0, 10),
        full: kr(p.full_pris), fullNull: kr(p.full_pris_nullutslipp),
        brikke: kr(p.easygo), brikkeNull: kr(p.easygo_nullutslipp),
        forskudd: kr(p.stl_privat_avtale), forskuddNull: kr(p.stl_privat_avtale_nullutslipp),
      }))
      .sort((p, q) => p.fra.localeCompare(q.fra));
    ferjer.push({
      id: `${s.sambandsID}:${x.strekning}`,
      samband: s.sambandsnavn,
      strekning: x.strekning,
      fylke: s.fylke,
      operator: s['operatør_navn'],
      takstsone: x.takstsone,
      turRetur: /^F/i.test(x.takstsone), // innkreving bare én vei; prisen gjelder tur/retur
      // id = holdeplass-id hos Entur (NSR), brukes til å slå opp neste avgang
      a: a ? { navn: navnA, lat: a.lat, lon: a.lon, id: a.id || null } : null,
      b: b ? { navn: navnB, lat: b.lat, lon: b.lon, id: b.id || null } : null,
      priser,
    });
  }
  for (const e of EKSTRA_SAMBAND) {
    const funnet = (k) => { const f = cache[`${k.fylke}|${k.navn}`]; return f && km(f, k) < 3 ? f : null; }; // treffet må ligge ved kaia
    ferjer.push(ekstraSamband(e, funnet(e.a), funnet(e.b)));
  }
  return {
    ferjer,
    statistikk: {
      samband: samband.length + EKSTRA_SAMBAND.length,
      strekninger: ferjer.length,
      medPosisjon: ferjer.length - utenPosisjon,
      gratis: ferjer.filter((f) => f.priser.length && f.priser.every((p) => p.full === 0)).length,
      utenPris: ferjer.filter((f) => !f.priser.length).length,
    },
  };
}
