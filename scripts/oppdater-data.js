#!/usr/bin/env node
// Oppdaterer data/bomstasjoner.json.
//
//   node scripts/oppdater-data.js            vanlig oppdatering
//   node scripts/oppdater-data.js --frisk    henter også veggeometri på nytt (tregere)
//
// Kilder:
//   1. NVDB API Les v4, vegobjekttype 45 «Bomstasjon»  (posisjon, retning, takster, timesregel)
//   2. NVDB vegnett                                     (kjøreretning der bommen står)
//   3. Bompengeselskapenes takstsider                   (elbil, drivstofftype, ferske takster)

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hent, hentJson, r2, normNavn, parallelt } from './lib/hent.js';
import { TOLKERE, tolkVegfinans, vegfinansSlugs } from './lib/selskaper.js';
import { KILDER, VEGFINANS_INDEKS, GENERELLE_REGLER, PRIVATE_TAKSTER } from './lib/kilder.js';
import { hentFerjer, FERJE_KILDE } from './lib/ferjer.js';
import { hentValutakurser, hentBomportaler, hentGratisferjer, hentSteder, hentNorskeSteder, byggUtland } from './lib/utland.js';

const ROT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const UT = path.join(ROT, 'data', 'bomstasjoner.json');
const CACHE = path.join(ROT, 'data', 'cache', 'vegretning.json');
const FRISK = process.argv.includes('--frisk');
const NVDB = 'https://nvdbapiles.atlas.vegvesen.no';
const I_DAG = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Oslo' }).format(new Date()); // ÅÅÅÅ-MM-DD i norsk tid

// ------------------------------------------------------------------ NVDB ---

async function hentBomstasjoner() {
  let url = `${NVDB}/vegobjekter/api/v4/vegobjekter/45?inkluder=egenskaper,lokasjon,metadata&srid=4326&antall=1000`;
  const alle = [];
  while (url) {
    const side = await hentJson(url);
    alle.push(...(side.objekter || []));
    url = side.metadata?.returnert > 0 ? side.metadata?.neste?.href : null;
  }
  return alle;
}

const egenskap = (o, id) => o.egenskaper?.find((e) => e.id === id)?.verdi ?? null;

function lesNvdb(o) {
  const wkt = o.lokasjon?.geometri?.wkt || '';
  const k = wkt.match(/\(([-\d.]+) ([-\d.]+)/);
  const sted = o.lokasjon?.stedfestinger?.[0] || null;
  const vref = o.lokasjon?.vegsystemreferanser?.[0] || null;
  return {
    id: o.id,
    type: egenskap(o, 9390),
    status: egenskap(o, 13465),
    navn: egenskap(o, 1078),
    anlegg: egenskap(o, 10714),
    innkreving: egenskap(o, 9414),
    liten: egenskap(o, 1820),
    litenEl: egenskap(o, 13463),
    stor: egenskap(o, 1819),
    rushLiten: egenskap(o, 9410),
    rushStor: egenskap(o, 9411),
    rushVinduer: [[egenskap(o, 9407), egenskap(o, 9408)], [egenskap(o, 9405), egenskap(o, 9406)]],
    timesregel: egenskap(o, 9412),
    timesregelMin: egenskap(o, 10952),
    timesregelGruppe: egenskap(o, 10951),
    op: egenskap(o, 11883),
    bid: egenskap(o, 9595),
    lenke: egenskap(o, 10715),
    sistModifisert: o.metadata?.sist_modifisert?.slice(0, 10) || null,
    lat: k ? Number(k[1]) : null,
    lon: k ? Number(k[2]) : null,
    sted,
    vegref: vref?.kortform || null,
    kommune: o.lokasjon?.kommuner?.[0] ?? null,
  };
}

// --------------------------------------------------------- Kjøreretning ----

const rad = (g) => (g * Math.PI) / 180;

export function kurs(a, b) {
  const dLon = rad(b[1] - a[1]);
  const y = Math.sin(dLon) * Math.cos(rad(b[0]));
  const x = Math.cos(rad(a[0])) * Math.sin(rad(b[0])) - Math.sin(rad(a[0])) * Math.cos(rad(b[0])) * Math.cos(dLon);
  return (Math.atan2(y, x) * 180) / Math.PI;
}

function meter(a, b) {
  const x = rad(b[1] - a[1]) * Math.cos(rad((a[0] + b[0]) / 2));
  const y = rad(b[0] - a[0]);
  return Math.sqrt(x * x + y * y) * 6371000;
}

/** Finner veglenkens retning (grader fra nord) og metreringsretning der bommen står. */
async function vegretning(sted) {
  if (!sted?.veglenkesekvensid || sted.relativPosisjon == null) return null;
  const segmenter = await hentJson(`${NVDB}/vegnett/api/v4/veglenkesekvenser/segmentert/${sted.veglenkesekvensid}?srid=4326`);
  const pos = sted.relativPosisjon;
  const kandidater = segmenter.filter((s) => s.startposisjon <= pos && s.sluttposisjon >= pos && s.geometri?.wkt);
  if (!kandidater.length) return null;
  const felt = new Set(sted.kjørefelt || []);
  kandidater.sort((a, b) => {
    const treff = (s) => (s.feltoversikt || []).some((f) => felt.has(f)) ? 0 : 1;
    const bil = (s) => (/gang|sykkel|fortau|trapp/i.test(s.typeVeg || '') ? 1 : 0);
    return bil(a) - bil(b) || treff(a) - treff(b);
  });
  const seg = kandidater[0];
  const punkter = [...seg.geometri.wkt.matchAll(/([-\d.]+) ([-\d.]+)(?: [-\d.]+)?(?=[,)])/g)].map((m) => [Number(m[1]), Number(m[2])]);
  if (punkter.length < 2) return null;
  const lengder = punkter.slice(1).map((p, i) => meter(punkter[i], p));
  const total = lengder.reduce((a, b) => a + b, 0);
  const andel = (pos - seg.startposisjon) / Math.max(1e-12, seg.sluttposisjon - seg.startposisjon);
  let mål = andel * total, i = 0;
  while (i < lengder.length - 1 && mål > lengder[i]) mål -= lengder[i++];
  // Metreringsretningen gjelder det mest detaljerte nivået bommen står på: en rampe (kryssdel) eller
  // et sideanlegg har sin egen metrering, uavhengig av hovedstrekningen.
  const v = seg.vegsystemreferanse;
  return {
    retning: r2((kurs(punkter[i], punkter[i + 1]) + 360) % 360),
    metrering: v?.sideanlegg?.retning || v?.kryssystem?.retning || v?.strekning?.retning || null,
    typeVeg: seg.typeVeg || null,
  };
}

// ----------------------------------------------------------- Takstkilder ---

async function lesKilder() {
  const resultat = [];
  await parallelt(KILDER, 5, async (k) => {
    const post = { ...k, data: null, feil: null };
    try {
      const deler = [];
      for (const url of k.urler) deler.push(TOLKERE[k.tolker](await hent(url)));
      const gyldige = deler.filter(Boolean);
      if (!gyldige.length) throw new Error('fant ingen pristabell på siden');
      post.data = gyldige[0];
      for (const ekstra of gyldige.slice(1)) post.data.stasjoner.push(...ekstra.stasjoner);
    } catch (e) {
      post.feil = e.message;
    }
    resultat.push(post);
  });
  return KILDER.map((k) => resultat.find((r) => r.id === k.id));
}

async function lesVegfinans() {
  const prosjekter = [];
  let feil = null;
  try {
    const slugs = vegfinansSlugs(await hent(VEGFINANS_INDEKS));
    await parallelt(slugs, 5, async (slug) => {
      const url = `${VEGFINANS_INDEKS}/${slug}`;
      try {
        const data = tolkVegfinans(await hent(url));
        if (data?.stasjoner.length && data.status !== 'finished') {
          prosjekter.push({ id: slug.replace(/^vegfinans-|-as$/g, ''), navn: data.navn.replace(/^Vegfinans | AS$/g, ''), selskap: 'Vegfinans', urler: [url], data, op: [...new Set(data.stasjoner.map((s) => Number(s.nokkel.split(':')[0])))] });
        }
      } catch (e) {
        prosjekter.push({ id: slug, navn: slug, selskap: 'Vegfinans', urler: [url], data: null, feil: e.message, op: [] });
      }
    });
  } catch (e) {
    feil = e.message;
  }
  return { prosjekter, feil };
}

// ------------------------------------------------------------ Sammenslåing --

const mest = (verdier) => {
  const antall = new Map();
  for (const v of verdier) antall.set(v, (antall.get(v) || 0) + 1);
  return [...antall.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
};

/** Elbilens andel av ordinær avtalepris i et prosjekt, f.eks. 0.7. */
function elbilAndel(data) {
  const par = [data?.felles, ...(data?.stasjoner || [])].filter((s) => s?.elbil?.avtale != null && s?.bensin?.avtale > 0);
  if (!par.length) return null;
  return mest(par.map((s) => Math.round((s.elbil.avtale / s.bensin.avtale) * 100) / 100));
}

function normaliserVindu([fra, til]) {
  if (!fra || !til || fra === til) return null;
  let [t, m] = til.split(':').map(Number);
  if (m % 10 === 9) { m += 1; if (m === 60) { m = 0; t += 1; } } // «08:59» betyr til 09:00
  return [fra, `${String(t).padStart(2, '0')}:${String(m).padStart(2, '0')}`];
}

const HIMMELRETNING = { nord: 0, nordøst: 45, øst: 90, sørøst: 135, sør: 180, sørvest: 225, vest: 270, nordvest: 315 };

/** «… mot Sørøst – Forus» eller «(Nordgående)» -> kurs i grader, ellers null. */
function retningFraNavn(navn) {
  const m = String(navn || '').toLowerCase().match(/mot ((?:nord|sør)?-?(?:øst|vest)?)\b|(nord|sør|øst|vest)gående/);
  if (!m) return null;
  const ord = (m[1] || m[2] || '').replace('-', '');
  return ord in HIMMELRETNING ? HIMMELRETNING[ord] : null;
}

function finnKildestasjon(n, kilde) {
  const d = kilde?.data;
  if (!d) return null;
  if (n.op != null && n.bid != null) {
    const paaNokkel = d.stasjoner.find((s) => s.nokkel === `${n.op}:${n.bid}`) || d.stasjoner.find((s) => s.nokkel === `${n.op}:`) || d.stasjoner.find((s) => s.nr != null && s.nr === n.bid);
    if (paaNokkel) return paaNokkel;
  }
  const navn = normNavn(n.navn);
  if (navn) {
    const paaNavn = d.stasjoner.find((s) => !s.nokkel && s.nr == null && normNavn(s.navn) === navn)
      || d.stasjoner.find((s) => !s.nokkel && s.nr == null && (normNavn(s.navn).includes(navn) || navn.includes(normNavn(s.navn))) && normNavn(s.navn).length > 3);
    if (paaNavn) return paaNavn;
  }
  return d.felles || null;
}

function byggStasjon(n, kilde, retn) {
  const usikker = [];
  const merknader = [];
  const privat = n.type === 'Bomstasjon for lokal/privat veg';
  const src = privat ? null : finnKildestasjon(n, kilde);
  const d = kilde?.data || null;

  // --- ordinær takst (bensin) ---
  const full = src?.bensin?.full ?? n.liten;
  if (src?.bensin?.full != null && n.liten != null && Math.abs(src.bensin.full - n.liten) > 0.005 && !(d?.felles?.diesel)) {
    merknader.push(`NVDB oppgir ${n.liten} kr, ${kilde.selskap} oppgir ${src.bensin.full} kr. Selskapets takst er brukt.`);
  }
  const rabatt = 1 - GENERELLE_REGLER.brikkerabattTakstgruppe1;
  const harRush = privat ? false
    : src?.bensin?.rushFull != null ? (d?.rushAlleStasjoner !== false || (n.rushLiten != null && n.rushLiten > n.liten))
    : n.rushLiten != null && n.liten != null && n.rushLiten > n.liten;
  const rushFull = !harRush ? null : src?.bensin?.rushFull ?? n.rushLiten;

  let takster = null;
  let elbilProsent = null;
  let elbilUtenAvtale = false;
  let privatKilde = null;
  if (full == null) {
    usikker.push('Takst mangler i NVDB og hos selskapet. Bommen kan være under etablering.');
  } else if (privat) {
    const kontrollert = PRIVATE_TAKSTER.find((p) => p.navnRegex.test(n.navn || ''));
    const pris = kontrollert?.full ?? full;
    const lik = { full: pris, avtale: pris, rushFull: null, rushAvtale: null };
    takster = { bensin: lik, diesel: lik, elbil: lik, tung: { full: kontrollert ? pris : n.stor ?? pris, avtale: kontrollert ? pris : n.stor ?? pris, rushFull: null, rushAvtale: null } };
    if (kontrollert) {
      privatKilde = kontrollert;
      merknader.push(`Privat bomvei. Takst kontrollert mot driverens side ${kontrollert.verifisert}${n.liten != null && n.liten !== pris ? ` (NVDB oppgir ${n.liten} kr)` : ''}. AutoPASS-rabatter gjelder ikke.`);
    } else {
      usikker.push('Privat/lokal bomvei: taksten er hentet fra NVDB og er ikke verifisert. AutoPASS-rabatter gjelder ikke.');
    }
  } else {
    const bensin = {
      full,
      avtale: src?.bensin?.avtale ?? r2(full * rabatt),
      rushFull,
      rushAvtale: rushFull == null ? null : src?.bensin?.rushAvtale ?? r2(rushFull * rabatt),
    };
    const dieselSrc = d?.felles?.diesel && src === d.felles ? d.felles.diesel : null;
    const diesel = dieselSrc
      ? { full: dieselSrc.full, avtale: dieselSrc.avtale ?? r2(dieselSrc.full * rabatt), rushFull: harRush ? dieselSrc.rushFull ?? null : null, rushAvtale: harRush ? dieselSrc.rushAvtale ?? null : null }
      : { ...bensin };

    // --- elbil: prosentandel av ordinær avtalepris, fastsatt per prosjekt ---
    let andel = src?.elbil?.avtale != null && bensin.avtale > 0 ? src.elbil.avtale / bensin.avtale : elbilAndel(d);
    if (andel == null && n.litenEl != null && n.liten > 0) andel = n.litenEl / (n.liten * rabatt);
    // Ingen verifisert sats: elbilprisen settes til ukjent. Den anslås ikke.
    if (andel == null) {
      usikker.push(kilde?.feil
        ? `Elbilpris er ukjent (selskapets takstside kunne ikke leses: ${kilde.feil}).`
        : 'Elbilpris er ukjent: bompengeprosjektet har ingen verifisert elbilsats.');
    }
    elbilUtenAvtale = src?.elbil?.full != null && src.elbil.full < bensin.full;
    const fullAndel = elbilUtenAvtale ? src.elbil.full / bensin.full : 1;
    const elbil = andel == null ? null : {
      full: elbilUtenAvtale ? src.elbil.full : bensin.full,
      avtale: src?.elbil?.avtale ?? r2(bensin.avtale * andel),
      rushFull: rushFull == null ? null : src?.elbil?.rushFull ?? r2(rushFull * fullAndel),
      rushAvtale: rushFull == null ? null : src?.elbil?.rushAvtale ?? r2(bensin.rushAvtale * andel),
    };
    elbilProsent = andel == null ? null : Math.round(andel * 100);

    const tungFull = src?.tung?.full ?? n.stor;
    const tungRush = !harRush ? null : src?.tung?.rushFull ?? n.rushStor ?? null;
    const tung = tungFull == null ? null : { full: tungFull, avtale: tungFull, rushFull: tungRush, rushAvtale: tungRush };
    if (tung == null) usikker.push('Takst for tungt kjøretøy mangler.');
    if (d?.felles?.tungMerknad && src === d.felles) merknader.push(`Takstgruppe 2 gjelder ${d.felles.tungMerknad}; eldre kjøretøy betaler mer.`);
    takster = { bensin, diesel, elbil, tung };
    if (!src && kilde && !kilde.feil) merknader.push(`Fant ikke stasjonen på ${kilde.selskap} sin side; taksten er fra NVDB.`);
    if (!kilde) usikker.push('Bompengeprosjektet er ikke koblet til en selskapskilde; taksten er fra NVDB.');
    else if (kilde.feil && !usikker.length) usikker.push(`Selskapets takstside kunne ikke leses (${kilde.feil}); taksten er fra NVDB.`);
  }

  // --- rushtid ---
  let rush = null;
  if (harRush) {
    const vinduer = d?.rush?.vinduer || n.rushVinduer.map(normaliserVindu).filter(Boolean);
    if (vinduer.length) rush = { vinduer, ukedager: [1, 2, 3, 4, 5], unntattHelligdager: true, unntattJuli: !!d?.rush?.unntattJuli };
    else usikker.push('Bommen har rushtidstakst, men klokkeslettene mangler.');
  }

  // --- timesregel ---
  let timesregel = { aktiv: false };
  const nvdbAktiv = n.timesregel ? n.timesregel !== 'Ikke timesregel' : null;
  const aktiv = privat ? false : nvdbAktiv ?? d?.timesregel?.aktiv ?? false;
  if (aktiv) {
    timesregel = {
      aktiv: true,
      minutter: n.timesregelMin ?? d?.timesregel?.minutter ?? 60,
      gruppe: n.timesregelGruppe != null ? String(n.timesregelGruppe) : `prosjekt:${kilde?.id ?? n.op ?? n.id}`,
      regel: d?.timesregel?.regel || 'dyreste',
      kreverAvtale: !!d?.timesregel?.kreverAvtale,
    };
  }

  // --- retning ---
  let retning = 'begge';
  let belastesKurs = null;
  let uavklartRetning = null;
  if (n.innkreving === 'Med metrering' || n.innkreving === 'Mot metrering') {
    retning = 'en';
    if (retn?.retning != null && retn.metrering) {
      // To uavhengige opplysninger i NVDB: egenskapen «Innkrevningsretning» og kjørefeltene bommen står i
      // (oddetall = med lenkeretningen). De er som regel enige; ved uenighet avgjør retningsord i navnet.
      let fraEgenskap = retn.retning + (retn.metrering === 'MOT' ? 180 : 0) + (n.innkreving === 'Mot metrering' ? 180 : 0);
      const felt = (n.sted?.kjørefelt || []).map((f) => parseInt(f, 10)).filter((f) => !Number.isNaN(f));
      const fraFelt = felt.length && felt.every((f) => f % 2 === 1) ? retn.retning : felt.length && felt.every((f) => f % 2 === 0) ? retn.retning + 180 : null;
      const avvik = (a, b) => Math.abs(((a - b + 540) % 360) - 180);
      if (fraFelt != null && avvik(fraEgenskap, fraFelt) > 90) {
        const hint = retningFraNavn(n.navn);
        if (hint != null) {
          if (avvik(fraFelt, hint) < avvik(fraEgenskap, hint)) fraEgenskap = fraFelt;
          merknader.push('Retningsopplysningene i NVDB er motstridende; retningen er bestemt ut fra stasjonsnavnet.');
        } else {
          uavklartRetning = { fraEgenskap, fraFelt }; // avgjøres i etterkant ut fra bomringens form
        }
      }
      belastesKurs = r2(((fraEgenskap % 360) + 360) % 360);
    } else {
      retning = 'begge';
      usikker.push('Innkrevingsretningen kunne ikke bestemmes; bommen regnes som toveis.');
    }
  } else if (!n.innkreving) {
    merknader.push('Innkrevingsretning mangler i NVDB; bommen regnes som toveis.');
  }

  return {
    id: n.id,
    navn: n.navn || `Bomstasjon uten navn${n.vegref ? ` (${n.vegref})` : ''}`,
    type: privat ? 'privat' : 'autopass',
    lat: n.lat,
    lon: n.lon,
    retning,
    belastesKurs,
    vegretning: retn?.retning ?? null,
    prosjekt: kilde?.id ?? (privat ? 'privat' : n.op != null ? `operator-${n.op}` : 'ukjent'),
    prosjektNavn: kilde?.navn ?? n.anlegg ?? (privat ? 'Privat/lokal bomvei' : 'Ukjent bompengeprosjekt'),
    selskap: kilde?.selskap ?? null,
    takster,
    elbilProsentAvAvtalepris: elbilProsent,
    elbiltakstUtenAvtale: elbilUtenAvtale,
    rush,
    timesregel,
    maanedstak: d?.maanedstak ?? null,
    _uavklartRetning: uavklartRetning,
    prisUsikker: usikker.length > 0,
    usikkerGrunner: usikker,
    merknader,
    kilder: [`${NVDB}/vegobjekter/45/${n.id}`, ...(kilde?.urler || []), ...(privatKilde ? [privatKilde.kilde] : [])],
    nvdbSistEndret: n.sistModifisert,
    sistVerifisert: privatKilde ? privatKilde.verifisert : kilde && !kilde.feil && src ? I_DAG : null,
  };
}

// ------------------------------------------------------------ Endringer ----

/** Sammenligner to datasett og beskriver hva som er endret, i klartekst. */
export function finnEndringer(gamle, nye) {
  const før = new Map(gamle.map((s) => [s.id, s]));
  const etter = new Map(nye.map((s) => [s.id, s]));
  const ut = [];
  const navn = (s) => `${s.navn} (${s.prosjektNavn})`;
  for (const s of nye) {
    const g = før.get(s.id);
    if (!g) { ut.push(`Ny bom: ${navn(s)}`); continue; }
    for (const [gruppe, etikett] of [['bensin', 'bensin'], ['diesel', 'diesel'], ['elbil', 'elbil'], ['tung', 'tungt kjøretøy']]) {
      for (const [felt, hva] of [['full', 'uten avtale'], ['avtale', 'med avtale'], ['rushFull', 'rush uten avtale'], ['rushAvtale', 'rush med avtale']]) {
        const a = g.takster?.[gruppe]?.[felt] ?? null, b = s.takster?.[gruppe]?.[felt] ?? null;
        if (a !== b && !(gruppe === 'diesel' && g.takster?.bensin?.[felt] === a && s.takster?.bensin?.[felt] === b)) ut.push(`${navn(s)}: ${etikett} ${hva} ${a ?? 'ukjent'} → ${b ?? 'ukjent'} kr`);
      }
    }
    if (g.retning !== s.retning || g.belastesKurs !== s.belastesKurs) ut.push(`${navn(s)}: innkrevingsretning endret`);
    if (g.prisUsikker !== s.prisUsikker) ut.push(`${navn(s)}: ${s.prisUsikker ? 'merket som usikker' : 'ikke lenger usikker'}`);
  }
  for (const g of gamle) if (!etter.has(g.id)) ut.push(`Fjernet: ${navn(g)}`);
  return ut;
}

// ------------------------------------------------------------------ Main ---

async function main() {
  console.log('Henter bomstasjoner fra NVDB …');
  const rå = (await hentBomstasjoner()).map(lesNvdb);
  const ferjer = rå.filter((n) => n.type === 'Ferjeinnkrevingspunkt' || /^ferje /i.test(n.navn || ''));
  const avsluttet = rå.filter((n) => n.status === 'Innkreving avsluttet');
  let aktuelle = rå.filter((n) => !ferjer.includes(n) && !avsluttet.includes(n) && n.lat != null);
  console.log(`  ${rå.length} objekter, ${aktuelle.length} bomstasjoner (${ferjer.length} ferjepunkt og ${avsluttet.length} avsluttede utelatt)`);

  console.log('Henter takster fra bompengeselskapene …');
  const [kilder, vegfinans] = await Promise.all([lesKilder(), lesVegfinans()]);
  const alleKilder = [...kilder, ...vegfinans.prosjekter];
  for (const k of alleKilder) {
    const d = k.data;
    const andel = elbilAndel(d);
    console.log(`  ${k.feil ? 'FEIL' : 'ok  '} ${k.selskap.padEnd(10)} ${k.navn.padEnd(46)} ${k.feil ? k.feil : `${d.felles ? 'felles takst' : `${d.stasjoner.length} stasjoner`}, elbil ${andel == null ? '?' : Math.round(andel * 100) + ' %'}`}`);
  }
  if (vegfinans.feil) console.log(`  FEIL Vegfinans-indeksen: ${vegfinans.feil}`);

  const finnKilde = (n) => {
    if (n.op == null) return null;
    const vf = vegfinans.prosjekter.find((p) => p.op.includes(n.op));
    if (vf) return vf;
    return kilder.find((k) => k.op.includes(n.op) && (!k.navnRegex || k.navnRegex.test(n.navn || ''))) || null;
  };

  // Rydd bort objekter som ikke er bommer i drift, i stedet for å vise dem som «pris ukjent».
  const privatType = 'Bomstasjon for lokal/privat veg';
  const medOperatør = aktuelle.filter((n) => n.op != null);
  const utelatt = [];
  aktuelle = aktuelle.filter((n) => {
    if (n.type === privatType) return true;
    let grunn = null;
    if (!n.navn && n.op == null && n.liten == null) grunn = 'uten navn, operatør og takst (ikke i drift, eller AutoPASS-leser på ferjekai)';
    else if (n.op == null && medOperatør.some((m) => meter([m.lat, m.lon], [n.lat, n.lon]) < 150)) grunn = 'duplikat av en bom som har operatør';
    else {
      const kilde = finnKilde(n);
      if (n.liten == null && kilde?.data && !kilde.data.felles && !finnKildestasjon(n, kilde)) grunn = 'uten takst og ikke på selskapets liste (ikke i drift)';
    }
    if (grunn) utelatt.push(`${n.navn || `uten navn (${n.vegref || n.id})`}: ${grunn}`);
    return !grunn;
  });
  if (utelatt.length) console.log(`Utelater ${utelatt.length} NVDB-objekter som ikke er bommer i drift:\n${utelatt.map((u) => `  - ${u}`).join('\n')}`);

  console.log('Beregner kjøreretning fra NVDB vegnett …');
  let cache = {};
  if (!FRISK) { try { cache = JSON.parse(await fs.readFile(CACHE, 'utf8')); } catch { /* ingen cache ennå */ } }
  let hentet = 0;
  const retninger = await parallelt(aktuelle, 6, async (n) => {
    const nokkel = n.sted?.kortform;
    if (!nokkel) return null;
    if (!(nokkel in cache)) {
      try { cache[nokkel] = await vegretning(n.sted); hentet++; } catch { return null; }
    }
    return cache[nokkel];
  });
  await fs.mkdir(path.dirname(CACHE), { recursive: true });
  await fs.writeFile(CACHE, JSON.stringify(cache));
  console.log(`  ${hentet} hentet, ${aktuelle.length - hentet} fra cache`);

  const stasjoner = aktuelle.map((n, i) => byggStasjon(n, finnKilde(n), retninger[i])).sort((a, b) => a.prosjektNavn.localeCompare(b.prosjektNavn, 'nb') || a.navn.localeCompare(b.navn, 'nb'));

  // Motstridende retningsdata uten retningsord i navnet: enveis bomringer krever inn i retning mot
  // sentrum, så velg den av de to retningene som peker inn mot midten av ringen.
  const avvik = (a, b) => Math.abs(((a - b + 540) % 360) - 180);
  for (const s of stasjoner) {
    const u = s._uavklartRetning;
    delete s._uavklartRetning;
    if (!u) continue;
    const ring = s.timesregel.aktiv ? stasjoner.filter((x) => x.prosjekt === s.prosjekt && x.timesregel.aktiv && x.timesregel.gruppe === s.timesregel.gruppe) : [];
    const midt = ring.length >= 6 ? [ring.reduce((sum, x) => sum + x.lat, 0) / ring.length, ring.reduce((sum, x) => sum + x.lon, 0) / ring.length] : null;
    const innover = midt ? (kurs([s.lat, s.lon], midt) + 360) % 360 : null;
    const a = innover == null ? null : avvik(u.fraEgenskap, innover), b = innover == null ? null : avvik(u.fraFelt, innover);
    if (innover != null && Math.min(a, b) < 70 && Math.max(a, b) > 110) {
      s.belastesKurs = r2((((a < b ? u.fraEgenskap : u.fraFelt) % 360) + 360) % 360);
      s.merknader.push('Retningsopplysningene i NVDB er motstridende; retningen er satt inn mot sentrum av bomringen, slik enveis bomringer krever inn.');
    } else {
      s.usikkerGrunner.push('Retningsopplysningene i NVDB er motstridende. Innkrevingsretningen kan være feil.');
      s.prisUsikker = true;
    }
  }

  // Kontroll: kjørefelt (oddetall = med metrering) skal stemme med innkrevingsretningen
  let feltAvvik = 0;
  for (const n of aktuelle) {
    const felt = (n.sted?.kjørefelt || []).map((f) => parseInt(f, 10)).filter((f) => !Number.isNaN(f));
    if (!felt.length || !/metrering/.test(n.innkreving || '') || n.innkreving === 'Begge retninger') continue;
    const odde = felt.every((f) => f % 2 === 1), like = felt.every((f) => f % 2 === 0);
    if ((n.innkreving === 'Med metrering' && like) || (n.innkreving === 'Mot metrering' && odde)) feltAvvik++;
  }

  const prosjekter = {};
  for (const s of stasjoner) {
    const p = (prosjekter[s.prosjekt] ||= { navn: s.prosjektNavn, selskap: s.selskap, antallStasjoner: 0, elbilProsentAvAvtalepris: s.elbilProsentAvAvtalepris, elbiltakstUtenAvtale: s.elbiltakstUtenAvtale, maanedstak: s.maanedstak, kilder: s.kilder.slice(1) });
    p.antallStasjoner++;
  }
  const statistikk = {
    nvdbObjekter: rå.length,
    stasjoner: stasjoner.length,
    autopass: stasjoner.filter((s) => s.type === 'autopass').length,
    private: stasjoner.filter((s) => s.type === 'privat').length,
    ferjepunktUtelatt: ferjer.length,
    ikkeIDriftUtelatt: utelatt.length,
    enveis: stasjoner.filter((s) => s.retning === 'en').length,
    medRushtid: stasjoner.filter((s) => s.rush).length,
    medTimesregel: stasjoner.filter((s) => s.timesregel.aktiv).length,
    verifisertMotSelskap: stasjoner.filter((s) => s.sistVerifisert).length,
    prisUsikker: stasjoner.filter((s) => s.prisUsikker).length,
    utenTakst: stasjoner.filter((s) => !s.takster).length,
    kilderMedFeil: alleKilder.filter((k) => k.feil).map((k) => `${k.navn}: ${k.feil}`),
    kjorefeltAvvik: feltAvvik,
  };

  const ut = {
    generert: new Date().toISOString(),
    priserSistOppdatert: I_DAG,
    beskrivelse: 'Bomstasjoner i Norge. Takster i kroner. full = uten avtale, avtale = med AutoPASS-avtale og brikke. Generert av scripts/oppdater-data.js.',
    generelleRegler: GENERELLE_REGLER,
    statistikk,
    prosjekter,
    stasjoner,
  };
  // Endringsrapport: hva er nytt siden forrige kjøring?
  let forrige = null;
  try { forrige = JSON.parse(await fs.readFile(UT, 'utf8')); } catch { /* første kjøring */ }
  const endringer = forrige ? finnEndringer(forrige.stasjoner, stasjoner) : [];
  if (forrige) {
    console.log(endringer.length ? `\n${endringer.length} endringer siden ${forrige.priserSistOppdatert}:\n${endringer.slice(0, 40).map((e) => `  - ${e}`).join('\n')}${endringer.length > 40 ? `\n  … og ${endringer.length - 40} til` : ''}` : `\nIngen prisendringer siden ${forrige.priserSistOppdatert}.`);
    const loggFil = path.join(ROT, 'data', 'endringslogg.json');
    let logg = [];
    try { logg = JSON.parse(await fs.readFile(loggFil, 'utf8')); } catch { /* ingen logg ennå */ }
    if (endringer.length) {
      logg.unshift({ dato: I_DAG, forrige: forrige.priserSistOppdatert, endringer });
      await fs.writeFile(loggFil, JSON.stringify(logg.slice(0, 30), null, 1));
    }
  }

  await fs.mkdir(path.dirname(UT), { recursive: true });
  await fs.writeFile(UT, JSON.stringify(ut, null, 1));

  console.log('Henter ferjepriser fra autopassferje.no …');
  try {
    const f = await hentFerjer(path.join(ROT, 'data', 'cache', 'ferjekaier-v2.json'), FRISK);
    await fs.writeFile(path.join(ROT, 'data', 'ferjer.json'), JSON.stringify({
      generert: new Date().toISOString(),
      priserSistOppdatert: I_DAG,
      kilde: FERJE_KILDE,
      beskrivelse: 'Ferjestrekninger med AutoPASS-regulativ. Priser i kroner for kjøretøy inntil 6 m (AP1). brikke = AutoPASS-brikke (10 % rabatt), forskudd = forskuddsavtale privat (50 %), *Null = nullutslipp.',
      statistikk: f.statistikk,
      ferjer: f.ferjer,
    }, null, 1));
    console.log('  ', JSON.stringify(f.statistikk));
  } catch (e) {
    console.log(`  FEIL: ${e.message}. Beholder forrige data/ferjer.json.`);
  }
  console.log('Henter bom- og broavgifter i Sverige og Danmark …');
  try {
    const kurser = await hentValutakurser();
    const elementer = await hentBomportaler(path.join(ROT, 'data', 'cache', 'osm-bomportaler.json'), FRISK);
    const u = byggUtland(elementer, kurser);
    if (u.statistikk.stockholm < 30 || u.statistikk.goteborg < 30 || !u.statistikk.storebaelt || !u.statistikk.oresund) throw new Error(`for få stasjoner: ${JSON.stringify(u.statistikk)}`);
    let ferjer = [];
    try { ferjer = await hentGratisferjer(path.join(ROT, 'data', 'cache', 'osm-vegferjer.json'), FRISK); } catch (e) { console.log(`   Svenske vegferjer: FEIL ${e.message}`); }
    u.statistikk.gratisVegferjerSverige = ferjer.length;
    await fs.writeFile(path.join(ROT, 'data', 'utland.json'), JSON.stringify({
      generert: new Date().toISOString(),
      priserSistOppdatert: I_DAG,
      beskrivelse: 'Bom- og broavgifter i Sverige og Danmark. Posisjoner fra OpenStreetMap, takster lagt inn for hånd fra kildene (scripts/lib/utland.js), regnet om til kroner med Norges Banks kurs.',
      kurser,
      statistikk: u.statistikk,
      tidstakster: u.tidstakster,
      stasjoner: u.stasjoner,
      ferjer,
    }, null, 1));
    console.log(`   kurs ${kurser.dato}: 1 SEK = ${kurser.SEK} kr, 1 DKK = ${kurser.DKK} kr`);
    console.log('  ', JSON.stringify(u.statistikk));
  } catch (e) {
    console.log(`  FEIL: ${e.message}. Beholder forrige data/utland.json.`);
  }
  console.log('Henter stedsnavn i Sverige og Danmark …');
  try {
    const steder = await hentSteder(path.join(ROT, 'data', 'cache', 'osm-steder.json'), FRISK);
    await fs.writeFile(path.join(ROT, 'data', 'steder-utland.json'), JSON.stringify({ generert: new Date().toISOString(), kilde: 'OpenStreetMap (place=city/town/village)', steder }));
    console.log(`   ${steder.length} steder (${steder.filter((s) => s.land === 'SE').length} i Sverige, ${steder.filter((s) => s.land === 'DK').length} i Danmark)`);
  } catch (e) {
    console.log(`  FEIL: ${e.message}. Beholder forrige data/steder-utland.json.`);
  }
  console.log('Henter norske byer og tettsteder (til «nærmeste sted» for områder som Valdres) …');
  try {
    const steder = await hentNorskeSteder(path.join(ROT, 'data', 'cache', 'osm-steder-norge.json'), FRISK);
    await fs.writeFile(path.join(ROT, 'data', 'steder-norge.json'), JSON.stringify({ generert: new Date().toISOString(), kilde: 'OpenStreetMap (place=city/town/village)', steder }));
    console.log(`   ${steder.length} steder`);
  } catch (e) {
    console.log(`  FEIL: ${e.message}. Beholder forrige data/steder-norge.json.`);
  }
  if (process.argv.includes('--vis-usikre')) {
    for (const s of stasjoner.filter((x) => x.prisUsikker)) console.log(`  USIKKER ${s.prosjektNavn} / ${s.navn}: ${s.usikkerGrunner.join(' ')}`);
    for (const s of stasjoner.filter((x) => x.merknader.length)) console.log(`  MERKNAD ${s.prosjektNavn} / ${s.navn}: ${s.merknader.join(' ')}`);
  }
  console.log('\nFerdig:', JSON.stringify(statistikk, null, 2));
  console.log(`Skrev ${path.relative(ROT, UT)}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error('Oppdateringen feilet:', e); process.exit(1); });
}
