// Geometri: avstander, kurs, treff mellom rute og bomstasjoner, unngå-polygoner.

const R = 6371000;
const rad = (g) => (g * Math.PI) / 180;

export function meter(a, b) {
  const x = rad(b[1] - a[1]) * Math.cos(rad((a[0] + b[0]) / 2));
  const y = rad(b[0] - a[0]);
  return Math.sqrt(x * x + y * y) * R;
}

export function kurs(a, b) {
  const dLon = rad(b[1] - a[1]);
  const y = Math.sin(dLon) * Math.cos(rad(b[0]));
  const x = Math.cos(rad(a[0])) * Math.sin(rad(b[0])) - Math.sin(rad(a[0])) * Math.cos(rad(b[0])) * Math.cos(dLon);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

export const kursAvvik = (a, b) => Math.abs(((a - b + 540) % 360) - 180);

export function flytt([lat, lon], kursGrader, m) {
  const k = rad(kursGrader);
  return [lat + ((m * Math.cos(k)) / R) * (180 / Math.PI), lon + ((m * Math.sin(k)) / (R * Math.cos(rad(lat)))) * (180 / Math.PI)];
}

/** Dekoder Google/Valhalla-polyline til [[lat, lon], ...]. */
export function dekodPolyline(tekst, presisjon = 6) {
  const faktor = 10 ** presisjon, ut = [];
  let i = 0, lat = 0, lon = 0;
  while (i < tekst.length) {
    for (const akse of [0, 1]) {
      let resultat = 0, skift = 0, b;
      do { b = tekst.charCodeAt(i++) - 63; resultat |= (b & 0x1f) << skift; skift += 5; } while (b >= 0x20);
      const delta = resultat & 1 ? ~(resultat >> 1) : resultat >> 1;
      if (akse === 0) lat += delta; else lon += delta;
    }
    ut.push([lat / faktor, lon / faktor]);
  }
  return ut;
}

// ------------------------------------------------------------ Bomtreff ------

export const TREFF_AVSTAND_M = 30;   // NVDB-punktet kan ligge i nabokjørebanen
export const TREFF_KURS_GRADER = 70; // maks avvik mellom kjøreretning og innkrevingsretning

/**
 * Finner hvilke bomstasjoner en rute passerer, i kjørerekkefølge.
 *
 * @param punkter [[lat, lon], ...]
 * @param tider   sekunder fra start for hvert punkt (samme lengde som punkter)
 * @returns [{ stasjon, indeks, sekunder, avstand }]
 *
 * En bom teller når ruta går nærmere enn TREFF_AVSTAND_M og – for enveisbommer –
 * kjøreretningen stemmer med innkrevingsretningen.
 */
export function finnPasseringer(punkter, tider, stasjoner) {
  if (punkter.length < 2) return [];
  let minLat = 90, maxLat = -90, minLon = 180, maxLon = -180;
  for (const [la, lo] of punkter) { if (la < minLat) minLat = la; if (la > maxLat) maxLat = la; if (lo < minLon) minLon = lo; if (lo > maxLon) maxLon = lo; }
  const pad = 0.002;
  const treff = [];

  for (const s of stasjoner) {
    if (s.lat < minLat - pad || s.lat > maxLat + pad || s.lon < minLon - pad || s.lon > maxLon + pad) continue;
    const mPerLat = (Math.PI / 180) * R, mPerLon = mPerLat * Math.cos(rad(s.lat));
    const grenseLat = (TREFF_AVSTAND_M * 4) / mPerLat, grenseLon = (TREFF_AVSTAND_M * 4) / mPerLon;
    let aktiv = null; // pågående passering: { indeks, avstand, andel }
    const avslutt = () => {
      if (!aktiv) return;
      const a = punkter[aktiv.indeks], b = punkter[aktiv.indeks + 1];
      const retningOk = s.retning !== 'en' || s.belastesKurs == null || kursAvvik(kurs(a, b), s.belastesKurs) <= TREFF_KURS_GRADER;
      if (retningOk) {
        const t0 = tider[aktiv.indeks], t1 = tider[aktiv.indeks + 1];
        treff.push({ stasjon: s, indeks: aktiv.indeks, sekunder: t0 + (t1 - t0) * aktiv.andel, avstand: Math.round(aktiv.avstand * 10) / 10 });
      }
      aktiv = null;
    };
    let sistNær = 0;
    const nyPassering = (i) => aktiv && tider[i] - tider[sistNær] > 60; // mer enn ett minutt siden sist = ny passering
    for (let i = 0; i < punkter.length - 1; i++) {
      const a = punkter[i], b = punkter[i + 1];
      if ((a[0] < s.lat - grenseLat && b[0] < s.lat - grenseLat) || (a[0] > s.lat + grenseLat && b[0] > s.lat + grenseLat)
        || (a[1] < s.lon - grenseLon && b[1] < s.lon - grenseLon) || (a[1] > s.lon + grenseLon && b[1] > s.lon + grenseLon)) {
        if (nyPassering(i)) avslutt();
        continue;
      }
      const ax = (a[1] - s.lon) * mPerLon, ay = (a[0] - s.lat) * mPerLat, bx = (b[1] - s.lon) * mPerLon, by = (b[0] - s.lat) * mPerLat;
      const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
      const andel = l2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / l2));
      const d = Math.hypot(ax + dx * andel, ay + dy * andel);
      if (d <= TREFF_AVSTAND_M) {
        if (nyPassering(i)) avslutt();
        if (!aktiv || d < aktiv.avstand) aktiv = { indeks: i, avstand: d, andel };
        sistNær = i;
      }
    }
    avslutt();
  }

  treff.sort((a, b) => a.sekunder - b.sekunder);
  // Et bomsnitt krysses i én bom. Når flere bommer i samme snitt ligger innenfor rekkevidde samtidig
  // (hovedløp og ramper side om side, eller ett NVDB-objekt per kjørebane), teller bare den nærmeste.
  // Utenlandske stasjoner har `snitt` satt: én betalstasjon består der av flere portaler eller luker.
  const snitt = (s) => s.snitt || `${s.prosjekt}|${s.timesregel?.aktiv ? s.timesregel.gruppe : ''}`;
  return treff.filter((t, i) => !treff.some((u, j) => j !== i && snitt(u.stasjon) === snitt(t.stasjon) && Math.abs(u.sekunder - t.sekunder) < SAMME_SNITT_SEKUNDER
    && (u.avstand < t.avstand || (u.avstand === t.avstand && j < i))));
}

export const SAMME_SNITT_SEKUNDER = 45;

// ------------------------------------------------------- Unngå-polygoner ----

/**
 * Et lite rektangel rundt kjørebanen der bommen står, som rutetjenesten skal unngå.
 * Returnerer [[lon, lat], ...] (lukket ring). `skala` > 1 brukes når første forsøk ikke traff veien.
 */
export function unngaaPolygon(stasjon, skala = 1) {
  const retning = stasjon.vegretning ?? stasjon.belastesKurs ?? 0;
  const langs = 12 * skala;
  const tvers = (stasjon.retning === 'en' ? 7 : 12) * skala;
  const midt = [stasjon.lat, stasjon.lon];
  const hjorner = [[langs, tvers], [langs, -tvers], [-langs, -tvers], [-langs, tvers]].map(([l, t]) => flytt(flytt(midt, retning, l), retning + 90, t));
  return [...hjorner, hjorner[0]].map(([lat, lon]) => [Math.round(lon * 1e6) / 1e6, Math.round(lat * 1e6) / 1e6]);
}

// ------------------------------------------------------------ Konveks hylle --

export function konveksHylle(punkter) {
  const p = [...punkter].sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  if (p.length < 3) return p;
  const kryss = (o, a, b) => (a[1] - o[1]) * (b[0] - o[0]) - (a[0] - o[0]) * (b[1] - o[1]);
  const nedre = [], øvre = [];
  for (const q of p) { while (nedre.length >= 2 && kryss(nedre.at(-2), nedre.at(-1), q) <= 0) nedre.pop(); nedre.push(q); }
  for (const q of p.reverse()) { while (øvre.length >= 2 && kryss(øvre.at(-2), øvre.at(-1), q) <= 0) øvre.pop(); øvre.push(q); }
  return [...nedre.slice(0, -1), ...øvre.slice(0, -1)];
}

export function punktIPolygon([lat, lon], polygon) {
  let inne = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [yi, xi] = polygon[i], [yj, xj] = polygon[j];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inne = !inne;
  }
  return inne;
}

/** Korteste avstand (meter) fra et punkt til en polylinje. */
export function avstandTilLinje(punkt, linje) {
  const mPerLat = (Math.PI / 180) * R, mPerLon = mPerLat * Math.cos(rad(punkt[0]));
  let best = Infinity;
  for (let i = 0; i < linje.length - 1; i++) {
    const ax = (linje[i][1] - punkt[1]) * mPerLon, ay = (linje[i][0] - punkt[0]) * mPerLat;
    const dx = (linje[i + 1][1] - linje[i][1]) * mPerLon, dy = (linje[i + 1][0] - linje[i][0]) * mPerLat;
    const l2 = dx * dx + dy * dy, t = l2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / l2));
    const d = Math.hypot(ax + dx * t, ay + dy * t);
    if (d < best) best = d;
  }
  return best;
}
