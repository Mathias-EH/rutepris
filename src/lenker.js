// Lenker til Google Maps og Apple Maps som følger samme rute som kartet viser.
//
// Navigasjonsappene regner ruta selv. For at de skal kjøre samme vei som kartet viser, legger vi inn
// via-punkter: ved ferjekaier, der ruta avviker fra den raskeste, og med jevne mellomrom på lange ruter.
// Appene viser dem som stopp, og mellom punktene velger de fortsatt veien selv.
//   Google Maps: inntil 9 via-punkter (3 i mobilnettleser uten appen) – developers.google.com/maps/documentation/urls
//   Apple Maps:  gjentatt «waypoint»-parameter – developer.apple.com/documentation/mapkit/unified-map-urls

import { meter, avstandTilLinje } from './geo.js';

const k = ([lat, lon]) => `${lat.toFixed(5)},${lon.toFixed(5)}`;

/** Tynner en linje til omtrent `maks` punkter. */
function tynn(punkter, maks) {
  if (punkter.length <= maks) return punkter;
  const steg = punkter.length / maks;
  return Array.from({ length: maks }, (_, i) => punkter[Math.floor(i * steg)]).concat([punkter.at(-1)]);
}

/**
 * Velger via-punkter på `rute` der den går en annen vei enn `referanse` (raskeste rute).
 * Returnerer punkter i kjørerekkefølge, viktigste strekninger først representert.
 */
export function viaPunkter(rute, referanse, maks = 9) {
  if (!referanse || rute === referanse || maks < 1) return [];
  const ref = tynn(referanse, 500);
  // Gå langs ruta med ca. 400 m mellom prøvepunktene
  const prøver = [];
  let akk = 0, neste = 0;
  for (let i = 1; i < rute.length; i++) {
    akk += meter(rute[i - 1], rute[i]);
    if (akk >= neste) { prøver.push({ p: rute[i], m: akk }); neste = akk + 400; }
  }
  // Sammenhengende strekninger som ligger mer enn 250 m fra referanseruta
  const strekninger = [];
  let aktiv = null;
  for (const pr of prøver) {
    const borte = avstandTilLinje(pr.p, ref) > 250;
    if (borte) { (aktiv ||= { punkter: [] }).punkter.push(pr); } else if (aktiv) { strekninger.push(aktiv); aktiv = null; }
  }
  if (aktiv) strekninger.push(aktiv);
  if (!strekninger.length) return [];

  // Fordel via-punktene på strekningene etter lengde, minst ett per strekning (lengste først)
  for (const s of strekninger) s.lengde = s.punkter.at(-1).m - s.punkter[0].m + 400;
  const etterLengde = [...strekninger].sort((a, b) => b.lengde - a.lengde).slice(0, maks);
  const total = etterLengde.reduce((sum, s) => sum + s.lengde, 0);
  let igjen = maks - etterLengde.length;
  for (const s of etterLengde) {
    const ekstra = Math.min(igjen, Math.max(0, Math.round((s.lengde / total) * maks) - 1), Math.floor(s.lengde / 8000));
    s.antall = 1 + ekstra;
    igjen -= ekstra;
  }
  const valgt = [];
  for (const s of etterLengde) {
    for (let j = 1; j <= s.antall; j++) valgt.push(s.punkter[Math.min(s.punkter.length - 1, Math.floor((j / (s.antall + 1)) * s.punkter.length))]);
  }
  return valgt.sort((a, b) => a.m - b.m).map((v) => v.p);
}

export function googleMapsLenke(fra, til, via = []) {
  const p = new URLSearchParams({ api: '1', origin: k([fra.lat, fra.lon]), destination: k([til.lat, til.lon]), travelmode: 'driving' });
  if (via.length) p.set('waypoints', via.map(k).join('|'));
  return `https://www.google.com/maps/dir/?${p}`;
}

export function appleMapsLenke(fra, til, via = []) {
  const deler = [`source=${k([fra.lat, fra.lon])}`, `destination=${k([til.lat, til.lon])}`, ...via.map((v) => `waypoint=${k(v)}`), 'mode=driving'];
  return `https://maps.apple.com/directions?${deler.join('&')}`;
}

const MAKS_VIA = 9;

/** Hvor langt ut på ruta (i meter) et punkt ligger: avstanden langs ruta til nærmeste rutepunkt. */
function langsRuta(rute, punkt) {
  let best = 0, bestD = Infinity, akk = 0;
  for (let i = 0; i < rute.length; i++) {
    if (i) akk += meter(rute[i - 1], rute[i]);
    const d = meter(rute[i], punkt);
    if (d < bestD) { bestD = d; best = akk; }
  }
  return best;
}

/**
 * Punktene navigasjonsappen må innom for å kjøre samme rute som kartet viser, i kjørerekkefølge:
 *   1. ferjekaiene der ruta går om bord – ellers kan appen velge veien rundt (eller omvendt)
 *   2. midt på strekningene der ruta avviker fra den raskeste (omveiene rundt bommer)
 *   3. på lange ruter: noen jevnt fordelte støttepunkter, så appen ikke velger en annen hovedvei
 * Korte ruter uten ferje og omvei får ingen punkter: da er appens raskeste rute den samme som vår.
 */
export function rutepunkter(rute, referanse, ferjekaier = []) {
  const lengde = langsRuta(rute, rute.at(-1));
  const valgt = ferjekaier.slice(0, MAKS_VIA).map((p) => ({ p, m: langsRuta(rute, p) }));
  for (const p of viaPunkter(rute, referanse, MAKS_VIA - valgt.length)) valgt.push({ p, m: langsRuta(rute, p) });
  // Støttepunkter: ett per 60 km, høyst 4, og aldri nærmere enn 5 km fra start, mål eller et annet punkt
  const antall = Math.min(4, Math.floor(lengde / 60000), MAKS_VIA - valgt.length);
  for (let i = 1; i <= antall; i++) {
    const mål = (lengde * i) / (antall + 1);
    if (mål < 5000 || lengde - mål < 5000 || valgt.some((v) => Math.abs(v.m - mål) < 5000)) continue;
    let akk = 0;
    for (let j = 1; j < rute.length; j++) {
      akk += meter(rute[j - 1], rute[j]);
      if (akk >= mål) { valgt.push({ p: rute[j], m: akk }); break; }
    }
  }
  return valgt.sort((a, b) => a.m - b.m).map((v) => v.p);
}

/** Alle lenkevarianter for én rute. `ferjekaier` = der ruta går om bord i en ferje, som [lat, lon]. */
export function navigasjonslenker(fra, til, rutePunkter, referansePunkter, ferjekaier = []) {
  const via = rutepunkter(rutePunkter, referansePunkter, ferjekaier);
  // Mobilnettlesere uten Google Maps-appen støtter bare 3 via-punkter: velg jevnt fordelt
  const viaMobil = via.length <= 3 ? via : [via[Math.floor(via.length / 6)], via[Math.floor(via.length / 2)], via[Math.floor((via.length * 5) / 6)]];
  return {
    google: googleMapsLenke(fra, til, via),
    googleMobil: googleMapsLenke(fra, til, viaMobil),
    apple: appleMapsLenke(fra, til, via),
    viaPunkter: via.map(([lat, lon]) => [Math.round(lat * 1e5) / 1e5, Math.round(lon * 1e5) / 1e5]),
    antallViaMobil: viaMobil.length,
  };
}
