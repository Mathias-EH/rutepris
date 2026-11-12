// Ferjepriser: kobler ferjestrekningene på en rute til prisene i data/ferjer.json.

import { meter } from './geo.js';

export const FERJE_TREFF_METER = 3000; // maks avstand fra rutas ferjestart/-slutt til registrert kai

/**
 * Finner ferja som går mellom to punkter, og hvilken vei ruta kjører den.
 * @returns { ferje, snudd } der snudd = true når ruta går fra kai b til kai a, eller null
 */
export function finnFerjeMedRetning(ferjer, fra, til) {
  let beste = null;
  for (const f of ferjer) {
    if (!f.a || !f.b) continue;
    const a = [f.a.lat, f.a.lon], b = [f.b.lat, f.b.lon];
    const rett = Math.max(meter(fra, a), meter(til, b)), snudd = Math.max(meter(fra, b), meter(til, a));
    const d = Math.min(rett, snudd);
    if (d <= FERJE_TREFF_METER && (!beste || d < beste.d)) beste = { ferje: f, snudd: snudd < rett, d };
  }
  return beste ? { ferje: beste.ferje, snudd: beste.snudd } : null;
}

/** Finner ferja som går mellom to punkter (rekkefølgen er likegyldig). */
export const finnFerje = (ferjer, fra, til) => finnFerjeMedRetning(ferjer, fra, til)?.ferje || null;

/**
 * Pris for én overfart med kjøretøy inntil 6 m (takstklasse AP1).
 * Med AutoPASS-brikke gis 10 % rabatt. Forskuddsavtale (50 %) oppgis som egen opplysning.
 * Returnerer { pris, forskuddPris } der pris er null når den ikke kan fastsettes.
 */
export function ferjepris(ferje, kjoretoy, dato) {
  if (!ferje || kjoretoy.drivstoff === 'tung') return { pris: null, forskuddPris: null }; // tunge kjøretøy prises etter lengde
  const dag = dato.toISOString().slice(0, 10);
  const p = ferje.priser.find((x) => x.fra <= dag && dag < x.til) || null;
  if (!p) return { pris: null, forskuddPris: null };
  const nullutslipp = kjoretoy.drivstoff === 'elbil';
  return {
    pris: kjoretoy.avtale ? (nullutslipp ? p.brikkeNull : p.brikke) : (nullutslipp ? p.fullNull : p.full),
    forskuddPris: nullutslipp ? p.forskuddNull : p.forskudd,
  };
}

/**
 * Priser alle ferjestrekningene på en rute.
 * Hver linje har også posisjon (til kartet) og holdeplass-id-er (til oppslag av neste avgang).
 */
export function prisFerjer(ruteFerjer, ferjer, kjoretoy, avreise) {
  const linjer = ruteFerjer.map((r) => {
    const treff = finnFerjeMedRetning(ferjer, r.fra, r.til);
    const f = treff?.ferje || null;
    const { pris, forskuddPris } = ferjepris(f, kjoretoy, new Date(avreise.getTime() + r.startSekunder * 1000));
    const [fraKai, tilKai] = f ? (treff.snudd ? [f.b, f.a] : [f.a, f.b]) : [null, null];
    const kort = (s) => String(s || '').replace(/ ferjekai| kai/g, '');
    return {
      navn: f ? `${kort(fraKai.navn)} – ${kort(tilKai.navn)}` : r.navn || 'Ferje',
      samband: f?.samband || null,
      km: r.km,
      pris,
      forskuddPris,
      turRetur: !!f?.turRetur,
      status: pris == null ? 'ukjent' : pris === 0 ? 'gratis' : 'betalt',
      fra: r.fra, til: r.til,
      fraId: fraKai?.id || null, tilId: tilKai?.id || null,
      startSekunder: r.startSekunder, sekunder: r.sekunder,
    };
  });
  return {
    total: Math.round(linjer.reduce((s, l) => s + (l.pris ?? 0), 0) * 100) / 100,
    harUkjent: linjer.some((l) => l.status === 'ukjent'),
    linjer,
  };
}
