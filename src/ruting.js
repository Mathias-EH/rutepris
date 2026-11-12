// Rutetjenester basert på OpenStreetMap. Begge støtter «unngå områder» og brukes kun med
// bilprofil, så ruta går aldri på gang-/sykkelveier eller veier stengt for motortrafikk.
//
//   Valhalla        – standard, åpen server uten nøkkel (exclude_polygons)
//   OpenRouteService – brukes når ORS_API_KEY er satt (avoid_polygons)

import { dekodPolyline, meter } from './geo.js';

export class RuteFeil extends Error {
  constructor(melding, kode) { super(melding); this.kode = kode; } // kode: 'ingen-rute' | 'grense' | 'tjeneste'
}

const UA = 'bompenge-kalkulator/1.0';

/** Fordeler kjøretiden til et rutesteg på punktene i steget, proporsjonalt med avstand. */
function fordelTid(punkter, tider, fraIdx, tilIdx, startTid, varighet) {
  let total = 0;
  const lengder = [];
  for (let i = fraIdx; i < tilIdx; i++) { const l = meter(punkter[i], punkter[i + 1]); lengder.push(l); total += l; }
  let akk = 0;
  tider[fraIdx] = startTid;
  for (let i = fraIdx; i < tilIdx; i++) {
    akk += lengder[i - fraIdx];
    tider[i + 1] = startTid + (total > 0 ? (akk / total) * varighet : varighet);
  }
}

// ------------------------------------------------------------------ Valhalla

async function valhalla({ fra, til, unngaa, unngaaPunkter, unngåBomveier, mykBom, unngåFerje, tung }, { url }) {
  const profil = tung ? 'truck' : 'auto';
  // use_tolls 1 = ikke straff bomveier (ren raskeste rute)
  // use_tolls 0 = «myk» unngåelse: bomveier veies ned, men brukes når omveien blir for lang
  // exclude_tolls = unngå alle veier merket som bomvei i OSM
  // use_ferry 0 = bruk ferje bare når det ikke finnes vei
  const valg = unngåBomveier ? { exclude_tolls: true } : { use_tolls: mykBom ? 0 : 1 };
  if (unngåFerje) valg.use_ferry = 0;
  const body = {
    locations: [{ lat: fra.lat, lon: fra.lon }, { lat: til.lat, lon: til.lon }],
    costing: profil,
    units: 'kilometers',
    directions_options: { language: 'nb-NO' },
    costing_options: { [profil]: valg },
  };
  // Den åpne serveren tillater maks 100 hjørner totalt, så ringene sendes uten gjentatt sluttpunkt.
  if (unngaa.length) body.exclude_polygons = unngaa.map((p) => p.slice(0, -1));
  // Punkter er «billigere» enn polygoner: Valhalla sperrer veilenken nærmest hvert punkt.
  if (unngaaPunkter.length) body.exclude_locations = unngaaPunkter.map(([lat, lon]) => ({ lat, lon }));
  let res;
  try {
    res = await fetch(`${url.replace(/\/$/, '')}/route`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(45000),
    });
  } catch (e) {
    throw new RuteFeil(`Rutetjenesten svarte ikke (${e.message})`, 'tjeneste');
  }
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.trip) {
    const kode = json?.error_code;
    if (kode === 442 || kode === 171 || kode === 170) throw new RuteFeil('Fant ingen kjørbar rute', 'ingen-rute');
    if (kode === 167 || /exceed/i.test(json?.error || '')) throw new RuteFeil(json?.error || 'For mange unngå-områder', 'grense');
    if (res.status === 429) throw new RuteFeil('Rutetjenesten er opptatt, prøv igjen om litt', 'tjeneste');
    throw new RuteFeil(json?.error || `Rutetjenesten svarte ${res.status}`, 'tjeneste');
  }
  const punkter = [], tider = [], ferjer = [];
  let tidSum = 0;
  for (const etappe of json.trip.legs) {
    const form = dekodPolyline(etappe.shape, 6);
    const forskyv = punkter.length;
    punkter.push(...form);
    for (const m of etappe.maneuvers) {
      fordelTid(punkter, tider, forskyv + m.begin_shape_index, forskyv + m.end_shape_index, tidSum, m.time);
      if (m.ferry || m.type === 28 || m.travel_mode === 'water') {
        ferjer.push({
          navn: (m.street_names || []).find((n) => / - /.test(n)) || null, // f.eks. «Halhjem - Sandvikvåg»
          fra: punkter[forskyv + m.begin_shape_index],
          til: punkter[forskyv + m.end_shape_index],
          km: Math.round(m.length * 10) / 10,
          sekunder: Math.round(m.time),
          startSekunder: Math.round(tidSum),
        });
      }
      tidSum += m.time;
    }
  }
  return {
    punkter, tider, ferjer,
    sekunder: json.trip.summary.time,
    km: json.trip.summary.length,
    leverandor: 'Valhalla (OpenStreetMap)',
  };
}

// ---------------------------------------------------------- OpenRouteService

async function ors({ fra, til, unngaa, unngåBomveier, unngåFerje, tung }, { nokkel, url }) {
  const body = {
    coordinates: [[fra.lon, fra.lat], [til.lon, til.lat]],
    instructions: true,
    extra_info: ['waytype'],
  };
  if (unngaa.length || unngåBomveier || unngåFerje) {
    body.options = {};
    if (unngaa.length) body.options.avoid_polygons = { type: 'MultiPolygon', coordinates: unngaa.map((p) => [p]) };
    const unngå = [unngåBomveier && 'tollways', unngåFerje && 'ferries'].filter(Boolean);
    if (unngå.length) body.options.avoid_features = unngå;
  }
  let res;
  try {
    res = await fetch(`${url.replace(/\/$/, '')}/v2/directions/${tung ? 'driving-hgv' : 'driving-car'}/geojson`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: nokkel, 'User-Agent': UA },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(45000),
    });
  } catch (e) {
    throw new RuteFeil(`Rutetjenesten svarte ikke (${e.message})`, 'tjeneste');
  }
  const json = await res.json().catch(() => null);
  const f = json?.features?.[0];
  if (!res.ok || !f) {
    const kode = json?.error?.code;
    if (kode === 2009 || kode === 2010) throw new RuteFeil('Fant ingen kjørbar rute', 'ingen-rute');
    if (kode === 2003 || kode === 2004) throw new RuteFeil(json.error.message, 'grense');
    throw new RuteFeil(json?.error?.message || `Rutetjenesten svarte ${res.status}`, 'tjeneste');
  }
  const punkter = f.geometry.coordinates.map(([lon, lat]) => [lat, lon]);
  const tider = new Array(punkter.length).fill(0);
  let tidSum = 0;
  for (const seg of f.properties.segments || []) {
    for (const steg of seg.steps || []) {
      fordelTid(punkter, tider, steg.way_points[0], steg.way_points[1], tidSum, steg.duration);
      tidSum += steg.duration;
    }
  }
  const ferjer = [];
  for (const [a, b, type] of f.properties.extras?.waytype?.values || []) {
    if (type !== 9) continue; // 9 = ferje
    let m = 0;
    for (let i = a; i < b; i++) m += meter(punkter[i], punkter[i + 1]);
    ferjer.push({ navn: null, fra: punkter[a], til: punkter[b], km: Math.round(m / 100) / 10, sekunder: Math.round(tider[b] - tider[a]), startSekunder: Math.round(tider[a]) });
  }
  return {
    punkter, tider, ferjer,
    sekunder: f.properties.summary.duration,
    km: f.properties.summary.distance / 1000,
    leverandor: 'OpenRouteService (OpenStreetMap)',
  };
}

// ---------------------------------------------------------------- Fabrikk --

/**
 * Lager en hentRute-funksjon ut fra miljøvariabler:
 *   RUTETJENESTE=valhalla|ors, ORS_API_KEY, ORS_URL, VALHALLA_URL
 */
export function lagRutetjeneste(env = process.env, cache = null) {
  const valg = (env.RUTETJENESTE || (env.ORS_API_KEY ? 'ors' : 'valhalla')).toLowerCase();
  const oppsett = valg === 'ors'
    ? { navn: 'OpenRouteService', fn: ors, maksPolygoner: Number(env.ORS_MAKS_POLYGONER) || 100, maksPunkter: 0, mykBom: false, opts: { nokkel: env.ORS_API_KEY, url: env.ORS_URL || 'https://api.openrouteservice.org' } }
    // Den åpne Valhalla-serveren: maks 100 polygonhjørner (= 20 rektangler) og 50 unngå-punkter per kall.
    : { navn: 'Valhalla', fn: valhalla, maksPolygoner: Number(env.VALHALLA_MAKS_POLYGONER) || 20, maksPunkter: Number(env.VALHALLA_MAKS_PUNKTER) || 50, mykBom: true, opts: { url: env.VALHALLA_URL || 'https://valhalla1.openstreetmap.de' } };
  if (valg === 'ors' && !env.ORS_API_KEY) throw new Error('RUTETJENESTE=ors krever ORS_API_KEY');

  const r5 = (x) => Math.round(x * 1e5) / 1e5;
  const hentRute = async (spørring) => {
    const s = { fra: { lat: r5(spørring.fra.lat), lon: r5(spørring.fra.lon) }, til: { lat: r5(spørring.til.lat), lon: r5(spørring.til.lon) }, unngaa: spørring.unngaa || [], unngaaPunkter: spørring.unngaaPunkter || [], unngåBomveier: !!spørring.unngåBomveier, mykBom: !!spørring.mykBom, unngåFerje: !!spørring.unngåFerje, tung: !!spørring.tung };
    const lag = () => oppsett.fn(s, oppsett.opts);
    return cache ? cache.eller(`v2|${oppsett.navn}|${JSON.stringify(s)}`, lag) : lag();
  };
  return { navn: oppsett.navn, hentRute, maksPolygoner: oppsett.maksPolygoner, maksPunkter: oppsett.maksPunkter, mykBom: oppsett.mykBom, kanUnngåFerje: true };
}
