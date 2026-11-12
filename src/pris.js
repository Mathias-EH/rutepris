// Prisberegning for bompasseringer. Ren logikk uten nettverk – se test/pris.test.js.
//
// Tid håndteres som «norsk veggklokke»: et Date-objekt der UTC-feltene er klokkeslettet
// i Norge. Slik blir rushtid og ukedag riktige uansett hvilken tidssone serveren står i.

export const DRIVSTOFF = ['elbil', 'bensin', 'diesel', 'hybrid', 'tung'];

/** «2026-11-12T07:30» -> veggklokke-Date. */
export function lesVeggklokke(tekst) {
  const m = String(tekst || '').match(/^(\d{4})-(\d\d)-(\d\d)[T ](\d\d):(\d\d)/);
  if (!m) return null;
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]));
}

/** Nåværende klokkeslett i Norge som veggklokke-Date. */
export function naaINorge(naa = new Date()) {
  const d = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Oslo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(naa).map((p) => [p.type, p.value]),
  );
  return new Date(Date.UTC(+d.year, +d.month - 1, +d.day, +d.hour, +d.minute));
}

export const klokke = (d) => `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;

// ---------------------------------------------------------------- Helligdager

function paaskedag(aar) {
  const a = aar % 19, b = Math.floor(aar / 100), c = aar % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const maaned = Math.floor((h + l - 7 * m + 114) / 31), dag = ((h + l - 7 * m + 114) % 31) + 1;
  return Date.UTC(aar, maaned - 1, dag);
}

const helligdagCache = new Map();

/** Offentlige fridager i Norge (ikke vanlige søndager). */
export function erHelligdag(d) {
  const aar = d.getUTCFullYear();
  if (!helligdagCache.has(aar)) {
    const paaske = paaskedag(aar), dag = 86400000;
    const faste = [[0, 1], [4, 1], [4, 17], [11, 25], [11, 26]].map(([m, dd]) => Date.UTC(aar, m, dd));
    const bevegelige = [-3, -2, 0, 1, 39, 49, 50].map((n) => paaske + n * dag);
    helligdagCache.set(aar, new Set([...faste, ...bevegelige]));
  }
  return helligdagCache.get(aar).has(Date.UTC(aar, d.getUTCMonth(), d.getUTCDate()));
}

// --------------------------------------------------------------------- Rushtid

const minutter = (hhmm) => { const [t, m] = hhmm.split(':').map(Number); return t * 60 + m; };
const kr = (x) => Math.round(x * 100) / 100;

/** Er tidspunktet i rushtid for denne bommen? Vinduer er [fra, til) i norsk tid. */
export function erRushtid(rush, tid) {
  if (!rush?.vinduer?.length) return false;
  const ukedag = tid.getUTCDay(); // 0 = søndag
  if (!(rush.ukedager || [1, 2, 3, 4, 5]).includes(ukedag)) return false;
  if (rush.unntattHelligdager !== false && erHelligdag(tid)) return false;
  if (rush.unntattJuli && tid.getUTCMonth() === 6) return false;
  const naa = tid.getUTCHours() * 60 + tid.getUTCMinutes();
  return rush.vinduer.some(([fra, til]) => naa >= minutter(fra) && naa < minutter(til));
}

// ------------------------------------------- Tidstakst (svensk trängselskatt)

const DAG = 86400000;
const svenskCache = new Map();

/** Svenske helgdager og dagene før dem. Sverige har samme klokkeslett som Norge. */
function svenskeDager(aar) {
  if (svenskCache.has(aar)) return svenskCache.get(aar);
  const paaske = paaskedag(aar);
  const lørdagFra = (m, d) => { const t = Date.UTC(aar, m, d); return t + ((6 - new Date(t).getUTCDay() + 7) % 7) * DAG; };
  const midsommardag = lørdagFra(5, 20), allaHelgons = lørdagFra(9, 31);
  const helgdager = [
    Date.UTC(aar, 0, 1), Date.UTC(aar, 0, 6), paaske - 2 * DAG, paaske, paaske + DAG, Date.UTC(aar, 4, 1), paaske + 39 * DAG,
    paaske + 49 * DAG, Date.UTC(aar, 5, 6), midsommardag, allaHelgons, Date.UTC(aar, 11, 25), Date.UTC(aar, 11, 26),
  ];
  const ut = {
    helgdager: new Set(helgdager),
    // Göteborg: alle dager før helgdag, pluss julaften og nyttårsaften
    dagFør: new Set([...helgdager.map((t) => t - DAG), Date.UTC(aar, 11, 24), Date.UTC(aar, 11, 31)]),
    // Stockholm: bare disse dagene før helgdag
    aftener: new Set([Date.UTC(aar, 0, 5), midsommardag - DAG, Date.UTC(aar, 11, 24), Date.UTC(aar, 11, 31)]),
    midsommarafton: midsommardag - DAG,
  };
  svenskCache.set(aar, ut);
  return ut;
}

/**
 * Dager uten trängselskatt.
 *   «goteborg»:  lørdag, søndag, helgdag, dagen før helgdag og hele juli.
 *   «stockholm»: lørdag, søndag, helgdag, trettondagsafton, midsommarafton, julaften, nyttårsaften,
 *                og juli unntatt de fem første hverdagene.
 */
export function svenskFridag(regel, tid) {
  const aar = tid.getUTCFullYear(), dag = Date.UTC(aar, tid.getUTCMonth(), tid.getUTCDate());
  const ukedag = tid.getUTCDay();
  if (ukedag === 0 || ukedag === 6) return true;
  const d = svenskeDager(aar);
  if (d.helgdager.has(dag)) return true;
  if (regel === 'goteborg') return d.dagFør.has(dag) || tid.getUTCMonth() === 6;
  if (d.aftener.has(dag)) return true;
  if (tid.getUTCMonth() !== 6) return false;
  let hverdager = 0; // hverdag nummer … i juli
  for (let n = 1; n <= tid.getUTCDate(); n++) { const u = new Date(Date.UTC(aar, 6, n)).getUTCDay(); if (u !== 0 && u !== 6) hverdager++; }
  return hverdager > 5;
}

/** Stockholm: høysesong 1. mars til dagen før midsommarafton, og 15. august til 30. november. */
export function erHøysesong(tid) {
  const aar = tid.getUTCFullYear(), dag = Date.UTC(aar, tid.getUTCMonth(), tid.getUTCDate());
  return (dag >= Date.UTC(aar, 2, 1) && dag < svenskeDager(aar).midsommarafton) || (dag >= Date.UTC(aar, 7, 15) && dag <= Date.UTC(aar, 10, 30));
}

/**
 * Takst som følger klokka: { rader: [[fra, til, beløp, beløpLavsesong?]], fridager, sesonger?, dagstak?, valuta, kurs }.
 * Beløpene står i landets valuta og regnes om til kroner med `kurs`. Lik for alle kjøretøy.
 */
export function tidstakstFor(t, tid) {
  if (svenskFridag(t.fridager, tid)) return { pris: 0, rush: false, forklaring: 'Ingen avgift denne dagen' };
  const naa = tid.getUTCHours() * 60 + tid.getUTCMinutes();
  const rad = t.rader.find(([fra, til]) => naa >= minutter(fra) && naa < minutter(til));
  if (!rad) return { pris: 0, rush: false, forklaring: 'Ingen avgift på dette tidspunktet' };
  const beløp = t.sesonger && !erHøysesong(tid) ? rad[3] : rad[2];
  const høyest = Math.max(...t.rader.map((r) => r[2]));
  return { pris: kr(beløp * t.kurs), rush: rad[2] === høyest, forklaring: `${beløp} ${t.valuta}`, beløp };
}
/** Dagstaket i kroner for datoen, eller null. */
const dagstakFor = (t, tid) => (t?.dagstak ? kr((t.sesonger && !erHøysesong(tid) ? t.dagstak[1] : t.dagstak[0]) * t.kurs) : null);

// ----------------------------------------------------------------------- Takst

/**
 * Taksten ett kjøretøy betaler i én bom på ett tidspunkt, før timesregel.
 * Returnerer { pris, rush } eller { pris: null } når taksten er ukjent.
 */
export function takstFor(stasjon, kjoretoy, tid) {
  if (stasjon.tidstakst) return tidstakstFor(stasjon.tidstakst, tid);
  const gruppe = kjoretoy.drivstoff === 'hybrid' ? 'bensin' : kjoretoy.drivstoff; // ladbar hybrid belastes som bensin
  const t = stasjon.takster?.[gruppe];
  if (!t || t.full == null) return { pris: null, rush: false };
  const rush = t.rushFull != null && erRushtid(stasjon.rush, tid);
  const pris = kjoretoy.avtale ? (rush ? t.rushAvtale : t.avtale) : (rush ? t.rushFull : t.full);
  return { pris: pris ?? null, rush };
}

// ------------------------------------------------------------------ Timesregel

/**
 * Beregner bompenger for en rekke passeringer.
 *
 * @param passeringer [{ stasjon, tid }] – tid er veggklokke-Date for estimert passering
 * @param kjoretoy    { drivstoff: 'elbil'|'bensin'|'diesel'|'hybrid'|'tung', avtale: boolean }
 *
 * Timesregel: innenfor samme timesregel-gruppe (samme bompengeprosjekt/ring) betales bare én
 * passering i vinduet som starter ved første passering. Regel «dyreste» belaster den dyreste
 * passeringen i vinduet, «forste» belaster den første. Gjelder aldri på tvers av grupper.
 */
export function beregnBompenger(passeringer, kjoretoy) {
  const sortert = [...passeringer].sort((a, b) => a.tid - b.tid);
  const vinduer = new Map(); // gruppe -> { slutt, betalt: linje }
  const linjer = [];
  const dagstak = []; // samme rekkefølge som linjer

  for (const { stasjon, tid } of sortert) {
    const { pris, rush, forklaring } = takstFor(stasjon, kjoretoy, tid);
    const linje = {
      stasjonId: stasjon.id,
      navn: stasjon.navn,
      prosjekt: stasjon.prosjekt,
      prosjektNavn: stasjon.prosjektNavn,
      tid: klokke(tid),
      rush,
      ordinarPris: pris,
      pris: pris ?? 0,
      status: pris == null ? 'ukjent' : pris === 0 ? 'gratis' : 'betalt',
      forklaring: forklaring ?? (pris == null ? 'Taksten er ukjent' : pris === 0 ? 'Ingen avgift for dette kjøretøyet' : rush ? 'Rushtidstakst' : 'Ordinær takst'),
      // Utenlandske bommer: beløpet i landets valuta, f.eks. «45 SEK»
      utenlandsk: stasjon.tidstakst ? (pris ? forklaring : null) : stasjon.valutapris?.[kjoretoy.avtale ? 'avtale' : 'full'] ?? null,
      usikker: !!stasjon.prisUsikker,
      usikkerGrunner: stasjon.usikkerGrunner || [],
    };
    linjer.push(linje);
    dagstak.push({ linje, tak: dagstakFor(stasjon.tidstakst, tid), nokkel: `${stasjon.prosjekt}|${tid.toISOString().slice(0, 10)}`, valuta: stasjon.tidstakst });

    const tr = stasjon.timesregel;
    if (pris == null || !tr?.aktiv || (tr.kreverAvtale && !kjoretoy.avtale)) continue;
    const nokkel = `${stasjon.prosjekt}|${tr.gruppe}`;
    const vindu = vinduer.get(nokkel);
    if (!vindu || tid.getTime() >= vindu.slutt) {
      vinduer.set(nokkel, { slutt: tid.getTime() + (tr.minutter || 60) * 60000, betalt: linje });
      continue;
    }
    const fri = (l, annen) => {
      l.pris = 0;
      l.status = 'gratis-timesregel';
      l.forklaring = `Gratis pga. timesregel (betalt i ${annen.navn} kl. ${annen.tid})`;
    };
    if (tr.regel !== 'forste' && pris > vindu.betalt.ordinarPris) {
      fri(vindu.betalt, linje); // denne er dyrere: den belastes, den forrige blir gratis
      vindu.betalt = linje;
    } else {
      fri(linje, vindu.betalt);
    }
  }

  // Dagstak (trängselskatt): det betales aldri mer enn taket per bil og dag i samme by.
  const brukt = new Map();
  for (const { linje, tak, nokkel, valuta } of dagstak) {
    if (tak == null || linje.status !== 'betalt') continue;
    const sum = brukt.get(nokkel) || 0;
    if (sum + linje.pris > tak + 0.005) {
      linje.pris = kr(Math.max(0, tak - sum));
      const takTekst = `${Math.round(tak / valuta.kurs)} ${valuta.valuta}`;
      if (linje.pris === 0) { linje.status = 'gratis-timesregel'; linje.forklaring = `Gratis – dagstaket på ${takTekst} er nådd`; } else linje.forklaring = `Redusert – dagstaket på ${takTekst} er nådd`;
    }
    brukt.set(nokkel, sum + linje.pris);
  }

  return {
    total: kr(linjer.reduce((s, l) => s + l.pris, 0)),
    totalUtenTimesregel: kr(linjer.reduce((s, l) => s + (l.ordinarPris ?? 0), 0)),
    antallPasseringer: linjer.length,
    antallBetalt: linjer.filter((l) => l.status === 'betalt').length,
    antallGratisTimesregel: linjer.filter((l) => l.status === 'gratis-timesregel').length,
    harUkjent: linjer.some((l) => l.status === 'ukjent'),
    harUsikker: linjer.some((l) => l.usikker),
    linjer,
  };
}

// --------------------------------------------------------------- Energikostnad

/**
 * Fra typegodkjent forbruk (WLTP) til forbruk på veien.
 *   elbil vinter (nov–mar): NAF El Prix vinter 2025 målte i snitt 18 % kortere rekkevidde enn WLTP
 *                           ved −6 til +8 °C, som gir 1 / (1 − 0,18) = 1,22 ganger forbruket.
 *   elbil sommer (apr–okt): NAF El Prix sommer 2025 (7–17 °C) lå bilene fra −13,7 % til +11,3 % mot WLTP,
 *                           altså omtrent på WLTP. Faktor 1,0.
 *   bensin/diesel:          ICCT (2024) fant 14 % høyere forbruk på veien enn WLTP.
 *   ladbar hybrid:          ICCT målte 4,0–4,4 l/100 km for privateide biler uansett WLTP-tall. Vi bruker 4,2.
 */
export const FORBRUKSFAKTOR = { elbilVinter: 1.22, elbilSommer: 1.0, fossil: 1.14, ladbarHybridLiter: 4.2 };

export const erVinter = (dato) => [10, 11, 0, 1, 2].includes(dato.getUTCMonth()); // november–mars

/** Regner WLTP-forbruk om til forventet forbruk på veien for gitt dato. */
export function realistiskForbruk(wltp, drivstoff, dato) {
  if (drivstoff === 'hybrid') return FORBRUKSFAKTOR.ladbarHybridLiter;
  if (!(wltp > 0)) return null;
  const faktor = drivstoff === 'elbil' ? (erVinter(dato) ? FORBRUKSFAKTOR.elbilVinter : FORBRUKSFAKTOR.elbilSommer) : FORBRUKSFAKTOR.fossil;
  return Math.round(wltp * faktor * 10) / 10;
}

/**
 * Standardverdier når bilen ikke er slått opp (biltype valgt uten registreringsnummer). Gjennomsnittstall
 * for forbruk på veien, ikke typegodkjente tall og ikke én bestemt modell:
 *
 *   elbil:  19 kWh/100 km i årssnitt – tallet NAF bruker i sine ladekostnadsberegninger (0,19 kWh/km).
 *           Fordelt på årstid med NAFs vintertillegg på 22 % (se FORBRUKSFAKTOR): 17,4 om sommeren
 *           (april–oktober) og 21,2 om vinteren, som gir (7 × 17,4 + 5 × 21,2) / 12 = 19,0.
 *           Feltet `wltp` under er altså sommerforbruket på veien, som årstidsfaktoren regnes fra.
 *           Rekkevidde 448 km om sommeren: nye elbiler har i snitt ca. 500 km typegodkjent rekkevidde
 *           (Norsk elbilforening) ved 15,6 kWh/100 km (Statens vegvesen), altså ca. 78 kWh batteri,
 *           og 78 kWh / 17,4 kWh per 100 km = 448 km. Om vinteren 448 / 1,22 = 367 km.
 *   bensin: 7,4 l/100 km – Statens vegvesens snitt for de mest solgte bensinbilene (kompakt 5,20,
 *           mellomklasse 7,67, SUV 6,50 = 6,46 typegodkjent) pluss 14 %, som er det ICCT måler at
 *           forbruket på veien ligger over typegodkjenningen. Pris 25 kr/l.
 *   diesel: 6,2 l/100 km – samme regnemåte: (5,35 + 5,60) / 2 = 5,48 typegodkjent, pluss 14 %.
 *   Forbruket oppgis som forbruk på veien og regnes ikke om en gang til.
 */
export const STANDARD_FORBRUK = {
  // pris = hjemmelading med Norgespris og nettleie (0,50 + 0,34). Serveren bytter den ut med spotpris når den finnes.
  // hurtigpris = typisk listepris hos de store kjedene (Circle K og Recharge 5,99, Kople 5,70 kr/kWh).
  elbil: { wltp: 17.4, rekkevidde: 448, enhet: 'kWh', pris: 0.84, hurtigpris: 5.9 },
  // Drivstoffpris: SSBs månedssnitt for september 2026 var 26,18 kr (bensin 95) og 27,52 kr (diesel);
  // Drivstoffappens snitt for oktober 25,5 og 27,7. Diesel har vært dyrere enn bensin siden avgiftskuttet falt bort 1.9.2026.
  bensin: { per100km: 7.4, enhet: 'liter', pris: 25.0 },
  diesel: { per100km: 6.2, enhet: 'liter', pris: 27.5 },
  hybrid: { per100km: FORBRUKSFAKTOR.ladbarHybridLiter, enhet: 'liter', pris: 25.0 },
  tung: { per100km: 30, enhet: 'liter', pris: 27.5 },
};

// Elbil på langtur: du starter med hjemmeladet batteri og bruker 80 % av rekkevidden før du må lade.
// Resten av turen lades på hurtiglader.
export const HJEMMELADET_ANDEL = 0.8;

/**
 * Forbruk og priser som brukes for en tur: standard for drivstofftypen, eventuelt overstyrt.
 * overstyr: { per100km, pris, hurtigpris, rekkevidde } – rekkevidde er WLTP-rekkevidde i km.
 */
export function forbrukFor(drivstoff, overstyr = {}, dato = new Date()) {
  const s = STANDARD_FORBRUK[drivstoff];
  const gyldig = (v) => Number.isFinite(v) && v >= 0;
  const ut = {
    per100km: gyldig(overstyr.per100km) ? overstyr.per100km : s.per100km ?? realistiskForbruk(s.wltp, drivstoff, dato),
    pris: gyldig(overstyr.pris) ? overstyr.pris : s.pris,
    enhet: s.enhet,
  };
  if (drivstoff === 'elbil') {
    const wltpRekkevidde = overstyr.rekkevidde > 0 ? overstyr.rekkevidde : s.rekkevidde;
    ut.hurtigpris = gyldig(overstyr.hurtigpris) ? overstyr.hurtigpris : s.hurtigpris;
    // Rekkevidden på veien krymper like mye som forbruket øker
    ut.rekkeviddeKm = Math.round(wltpRekkevidde / (erVinter(dato) ? FORBRUKSFAKTOR.elbilVinter : FORBRUKSFAKTOR.elbilSommer));
  }
  return ut;
}

/**
 * Energikostnad for en tur. For elbil deles turen i hjemmeladet strøm og hurtiglading underveis.
 * @returns { kostnad, per100km, pris, enhet, hjemmeKm, hurtigKm, hurtigpris }
 */
export function energiberegning(km, drivstoff, overstyr = {}, dato = new Date()) {
  const s = forbrukFor(drivstoff, overstyr, dato);
  if (drivstoff !== 'elbil') return { ...s, kostnad: kr((km / 100) * s.per100km * s.pris), hjemmeKm: null, hurtigKm: null };
  const hjemmeKm = Math.min(km, HJEMMELADET_ANDEL * s.rekkeviddeKm);
  const hurtigKm = km - hjemmeKm;
  return {
    ...s,
    kostnad: kr((hjemmeKm / 100) * s.per100km * s.pris + (hurtigKm / 100) * s.per100km * s.hurtigpris),
    hjemmeKm: Math.round(hjemmeKm * 10) / 10,
    hurtigKm: Math.round(hurtigKm * 10) / 10,
  };
}

export const energikostnad = (km, drivstoff, overstyr = {}, dato = new Date()) => energiberegning(km, drivstoff, overstyr, dato).kostnad;
