#!/usr/bin/env node
// Liten backend: serverer nettsiden og er proxy mot rute-, adresse-, strømpris- og ferjetjenester,
// slik at eventuelle API-nøkler aldri havner i nettleseren. Ingen avhengigheter utover Node.js.

import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Cache } from './src/cache.js';
import { lagRutetjeneste, RuteFeil } from './src/ruting.js';
import { planleggRuter, byggGrupper, MAKS_TIDSFAKTOR } from './src/ruteplan.js';
import { kombinerTurRetur } from './src/turretur.js';
import { søk, settUtenlandskeSteder, settNorskeSteder } from './src/geokoding.js';
import { hentValutakurser, brukKurser } from './src/valuta.js';
import { lesVeggklokke, naaINorge, DRIVSTOFF, STANDARD_FORBRUK, FORBRUKSFAKTOR, HJEMMELADET_ANDEL } from './src/pris.js';
import { slåOppKjøretøy, normaliserRegnr } from './src/kjoretoy.js';
import { hjemmepris, hentSpotpriser, prisområde } from './src/strom.js';
import { nesteAvgang } from './src/ferjetid.js';

const ROT = path.dirname(fileURLToPath(import.meta.url));
try { process.loadEnvFile(path.join(ROT, '.env')); } catch { /* .env er valgfri */ }

const PORT = Number(process.env.PORT) || 3000;
const TIME = 3600000;

// ------------------------------------------------------------------ Data ---

let data, stasjoner, grupper, ferjedata, utland;
async function lastData() {
  data = JSON.parse(await fs.readFile(path.join(ROT, 'data', 'bomstasjoner.json'), 'utf8'));
  // Sverige og Danmark ligger i egen fil. Stasjoner med trängselskatt får tidstabellen sin koblet på.
  try {
    utland = JSON.parse(await fs.readFile(path.join(ROT, 'data', 'utland.json'), 'utf8'));
    for (const s of utland.stasjoner) if (s.tidstakstId) s.tidstakst = utland.tidstakster[s.tidstakstId];
  } catch { utland = { stasjoner: [], statistikk: null, kurser: null }; console.warn('Fant ikke data/utland.json – bommer i Sverige og Danmark er ikke med. Kjør npm run oppdater-data.'); }
  stasjoner = [...data.stasjoner, ...utland.stasjoner];
  utland.ferjer ||= [];
  grupper = byggGrupper(stasjoner);
  try { ferjedata = JSON.parse(await fs.readFile(path.join(ROT, 'data', 'ferjer.json'), 'utf8')); } catch { ferjedata = { ferjer: [], statistikk: null }; console.warn('Fant ikke data/ferjer.json – ferjepriser vises ikke. Kjør npm run oppdater-data.'); }
  ferjedata.ferjer = [...ferjedata.ferjer, ...utland.ferjer]; // svenske vegferjer (gratis)
  // Norske byer og tettsteder: brukes til å vise nærmeste sted når søket treffer et område (Valdres -> Fagernes)
  try { settNorskeSteder(JSON.parse(await fs.readFile(path.join(ROT, 'data', 'steder-norge.json'), 'utf8')).steder); } catch { settNorskeSteder(null); console.warn('Fant ikke data/steder-norge.json – områder som Valdres vises uten nærmeste by. Kjør npm run oppdater-data.'); }
  // Stedsnavn i Sverige og Danmark til stedssøket
  try { settUtenlandskeSteder(JSON.parse(await fs.readFile(path.join(ROT, 'data', 'steder-utland.json'), 'utf8')).steder); } catch { settUtenlandskeSteder(null); console.warn('Fant ikke data/steder-utland.json – stedssøket kjenner bare de største byene i Sverige og Danmark. Kjør npm run oppdater-data.'); }
}
await lastData();

const ruteCache = new Cache(path.join(ROT, 'data', 'cache', 'ruter'), 24 * TIME, 300);
const søkCache = new Cache(path.join(ROT, 'data', 'cache', 'sok'), 7 * 24 * TIME, 1000);
const bilCache = new Cache(null, 24 * TIME, 500);
const strømCache = new Cache(null, 6 * TIME, 100);
const ferjeCache = new Cache(null, TIME / 2, 500);
let svarCache = new Cache(null, TIME, 100);
const rutetjeneste = lagRutetjeneste(process.env, ruteCache);

// Valutakurs for Sverige og Danmark: hentes fra Norges Bank ved oppstart og deretter én gang i døgnet.
// Alle utenlandske takster regnes om på stedet. Svarer ikke tjenesten, beholdes forrige kurs.
async function oppdaterKurser() {
  if (!utland.stasjoner.length) return;
  try {
    const kurser = await hentValutakurser();
    const f = utland.kurser;
    if (f && f.dato === kurser.dato && f.SEK === kurser.SEK && f.DKK === kurser.DKK) return;
    brukKurser(utland, kurser);
    svarCache = new Cache(null, TIME, 100);
    console.log(`Valutakurs ${kurser.dato}: 1 SEK = ${kurser.SEK} kr, 1 DKK = ${kurser.DKK} kr`);
  } catch (e) {
    console.warn(`Kunne ikke hente valutakurs (${e.message}). Bruker kursen fra ${utland.kurser?.dato || 'siste dataoppdatering'}.`);
  }
}
setInterval(oppdaterKurser, 24 * TIME).unref();
oppdaterKurser();

// Automatisk dataoppdatering: når prisene er eldre enn AUTO_OPPDATER_DAGER (standard 7, 0 = av),
// kjøres scripts/oppdater-data.js i bakgrunnen, og de nye dataene lastes inn uten omstart.
const OPPDATER_DAGER = process.env.AUTO_OPPDATER_DAGER === undefined ? 7 : Number(process.env.AUTO_OPPDATER_DAGER);
let oppdaterer = false;
function oppdaterVedBehov() {
  if (!(OPPDATER_DAGER > 0) || oppdaterer) return;
  const alderDager = (Date.now() - new Date(data.generert).getTime()) / (24 * TIME);
  if (alderDager < OPPDATER_DAGER) return;
  oppdaterer = true;
  console.log(`Prisene er ${Math.floor(alderDager)} dager gamle – oppdaterer i bakgrunnen …`);
  const barn = spawn(process.execPath, [path.join(ROT, 'scripts', 'oppdater-data.js')], { cwd: ROT, stdio: 'ignore' });
  barn.on('exit', async (kode) => {
    oppdaterer = false;
    if (kode !== 0) { console.warn(`Dataoppdateringen feilet (kode ${kode}). Beholder gamle data.`); return; }
    try { await lastData(); await oppdaterKurser(); svarCache = new Cache(null, TIME, 100); console.log(`Data oppdatert: ${stasjoner.length} bomstasjoner, priser per ${data.priserSistOppdatert}.`); } catch (e) { console.warn('Kunne ikke laste nye data:', e.message); }
  });
  barn.on('error', (e) => { oppdaterer = false; console.warn('Kunne ikke starte dataoppdateringen:', e.message); });
}
setInterval(oppdaterVedBehov, 6 * TIME).unref();
setTimeout(oppdaterVedBehov, 30000).unref();

// ----------------------------------------------------------------- Hjelpere

const TYPER = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.png': 'image/png' };

function sendJson(res, status, kropp) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(kropp));
}

async function lesKropp(req, maks = 20000) {
  let tekst = '';
  for await (const del of req) { tekst += del; if (tekst.length > maks) throw Object.assign(new Error('For stor forespørsel'), { status: 413 }); }
  try { return JSON.parse(tekst || '{}'); } catch { throw Object.assign(new Error('Ugyldig JSON'), { status: 400 }); }
}

// Enkel struping per klient så siden ikke overbelaster de åpne tjenestene.
const forbruk = new Map();
function strupet(ip, maks = 20, vinduMs = 60000) {
  const nå = Date.now();
  const liste = (forbruk.get(ip) || []).filter((t) => nå - t < vinduMs);
  liste.push(nå);
  forbruk.set(ip, liste);
  if (forbruk.size > 5000) forbruk.clear();
  return liste.length > maks;
}

function lesSted(s, navn) {
  const lat = Number(s?.lat), lon = Number(s?.lon);
  // Norge, Sverige og Danmark
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < 54.4 || lat > 71.5 || lon < 3 || lon > 32) {
    throw Object.assign(new Error(`${navn} mangler eller ligger utenfor Norge, Sverige og Danmark. Velg et sted fra forslagslisten.`), { status: 400 });
  }
  return { lat, lon, navn: String(s.navn || '').slice(0, 120) };
}

const iDag = () => naaINorge().toISOString().slice(0, 10);
/** Timepriser for en dato. Finnes de ikke ennå (fram i tid), brukes dagens. */
async function spotTimer(område, dato) {
  const hent = (d) => strømCache.eller(`${område}|${d}`, () => hentSpotpriser(område, d));
  try { return await hent(dato); } catch { return dato === iDag() ? null : hent(iDag()).catch(() => null); }
}
/** Neste ferjeavgang, mellomlagret per kaipar og minutt. */
const ferjeavgang = (fraId, tilId, tid) => ferjeCache.eller(`${fraId}|${tilId}|${Math.floor(tid.getTime() / 60000)}`, async () => {
  const a = await nesteAvgang(fraId, tilId, tid);
  return a && { avgang: a.avgang.getTime(), ankomst: a.ankomst.getTime() };
}).then((a) => a && { avgang: new Date(a.avgang), ankomst: new Date(a.ankomst) });

const tallEllerNull = (v, maks) => { const n = Number(v); return v !== '' && v != null && Number.isFinite(n) && n >= 0 && n < maks ? n : null; };

// ---------------------------------------------------------------------- API

const api = {
  'GET /api/meta': async () => ({
    priserSistOppdatert: data.priserSistOppdatert,
    generert: data.generert,
    statistikk: data.statistikk,
    rutetjeneste: rutetjeneste.navn,
    maksTidsfaktor: MAKS_TIDSFAKTOR,
    standardForbruk: STANDARD_FORBRUK,
    forbruksfaktor: FORBRUKSFAKTOR,
    hjemmeladetAndel: HJEMMELADET_ANDEL,
    kjoretoyoppslag: !!process.env.SVV_API_KEY,
    ferjer: ferjedata.statistikk,
    utland: utland.statistikk && { ...utland.statistikk, kurser: utland.kurser },
  }),

  'GET /api/sok': async (req, url) => {
    const q = (url.searchParams.get('q') || '').slice(0, 100);
    const nøkkel = `v10|${q.toLowerCase()}`;
    const lagret = await søkCache.hent(nøkkel);
    if (lagret) return { treff: lagret };
    const { treff, delvis } = await søk(q);
    if (!delvis) await søkCache.sett(nøkkel, treff); // ufullstendige svar (en kilde nede) lagres ikke
    return { treff };
  },

  'GET /api/kjoretoy': async (req, url) => {
    if (strupet(`bil|${req.socket.remoteAddress}`, 10)) throw Object.assign(new Error('For mange oppslag. Vent et minutt.'), { status: 429 });
    const regnr = normaliserRegnr(url.searchParams.get('regnr'));
    return bilCache.eller(regnr, () => slåOppKjøretøy(regnr, process.env.SVV_API_KEY));
  },

  /** Hjemmeladepris for et sted og en dato: GET /api/strompris?lat=..&lon=..&dato=..&avtale=spot|norgespris&omrade=NO1 */
  'GET /api/strompris': async (req, url) => {
    const p = url.searchParams;
    const område = /^NO[1-5]$/.test(p.get('omrade') || '') ? p.get('omrade') : prisområde(Number(p.get('lat')) || 60, Number(p.get('lon')) || 10.7);
    const dato = /^\d{4}-\d\d-\d\d$/.test(p.get('dato') || '') ? p.get('dato') : iDag();
    return hjemmepris({ avtale: p.get('avtale') === 'norgespris' ? 'norgespris' : 'spot', område, dato, hentTimer: spotTimer, kurser: utland.kurser });
  },

  'POST /api/ruter': async (req) => {
    if (strupet(req.socket.remoteAddress)) throw Object.assign(new Error('For mange søk på kort tid. Vent et minutt og prøv igjen.'), { status: 429 });
    const b = await lesKropp(req);
    const fra = lesSted(b.fra, 'Fra'), til = lesSted(b.til, 'Til');
    if (Math.abs(fra.lat - til.lat) < 1e-4 && Math.abs(fra.lon - til.lon) < 1e-4) throw Object.assign(new Error('Fra og til er samme sted.'), { status: 400 });
    const drivstoff = DRIVSTOFF.includes(b.kjoretoy?.drivstoff) ? b.kjoretoy.drivstoff : 'elbil';
    const kjoretoy = { drivstoff, avtale: b.kjoretoy?.avtale !== false };
    const avreise = lesVeggklokke(b.avreise) || naaINorge();
    const tillatFerjer = b.ferjer !== false; // «Ferjer av»: legg rutene utenom ferjer der det finnes vei
    // retur: et tidspunkt, eller «auto» = returen starter rett etter ankomst
    const returAuto = b.retur === 'auto';
    const retur = b.retur && !returAuto ? lesVeggklokke(b.retur) : null;
    if (b.retur && !returAuto && !retur) throw Object.assign(new Error('Ugyldig tidspunkt for retur.'), { status: 400 });

    // Forbruk og priser: det brukeren har oppgitt, ellers bilens tall, ellers standard
    const overstyr = {};
    for (const [felt, maks] of [['per100km', 200], ['pris', 100], ['hurtigpris', 100], ['rekkevidde', 2000]]) {
      const v = tallEllerNull(b.forbruk?.[felt], maks);
      if (v != null) overstyr[felt] = v;
    }
    let strøm = null;
    if (drivstoff === 'elbil') {
      const område = /^NO[1-5]$/.test(b.strom?.omrade || '') ? b.strom.omrade : prisområde(fra.lat, fra.lon);
      strøm = await hjemmepris({ avtale: b.strom?.avtale === 'norgespris' ? 'norgespris' : 'spot', område, dato: avreise.toISOString().slice(0, 10), hentTimer: spotTimer, kurser: utland.kurser });
      // Utenfor Norge kan spotprisen mangle: da brukes standardprisen, og det står i svaret
      if (!strøm) strøm = { pris: overstyr.pris ?? STANDARD_FORBRUK.elbil.pris, avtale: 'standard', område, strøm: null, nettleie: null, grunnlag: `Spotprisen for ${område} var ikke tilgjengelig – standardpris brukt` };
      if (overstyr.pris == null) overstyr.pris = strøm.pris; else if (overstyr.pris !== strøm.pris) strøm = { ...strøm, pris: overstyr.pris, grunnlag: 'Egen pris' };
    }

    const miljø = { stasjoner, grupper, ferjer: ferjedata.ferjer, hentRute: rutetjeneste.hentRute, maksPolygoner: rutetjeneste.maksPolygoner, maksPunkter: rutetjeneste.maksPunkter, mykBom: rutetjeneste.mykBom, kanUnngåFerje: rutetjeneste.kanUnngåFerje, nesteAvgang: ferjeavgang };
    const nøkkel = JSON.stringify([fra.lat, fra.lon, til.lat, til.lon, kjoretoy, avreise.getTime(), returAuto ? 'auto' : retur?.getTime() ?? null, tillatFerjer, overstyr]);
    const resultat = await svarCache.eller(nøkkel, async () => {
      const ut = await planleggRuter({ fra, til, avreise, kjoretoy, forbruk: overstyr, ferjer: tillatFerjer }, miljø);
      const m = { stasjoner, ferjer: ferjedata.ferjer, kjoretoy, forbruk: overstyr, avreise, retur };
      if (returAuto) {
        // Hvert alternativ er framme til ulik tid, så hjemreisen planlegges fra ankomsten til hvert av dem
        // (rundet opp til helt minutt). Selve ruteoppslagene er de samme og ligger i mellomlageret.
        const planer = new Map();
        for (const r of ut.ruter) {
          const ankomst = new Date(Math.ceil((avreise.getTime() + r.sekunder * 1000) / 60000) * 60000);
          const plan = await planleggRuter({ fra: til, til: fra, avreise: ankomst, kjoretoy, forbruk: overstyr, ferjer: tillatFerjer }, miljø);
          planer.set(r.id, { ...plan, avreise: ankomst });
        }
        return kombinerTurRetur(ut, (u) => planer.get(u.id), m);
      }
      if (!retur) return ut;
      if (retur.getTime() < avreise.getTime() + ut.ruter[0].sekunder * 1000) throw Object.assign(new Error('Returen må starte etter at du er framme.'), { status: 400 });
      const hjem = await planleggRuter({ fra: til, til: fra, avreise: retur, kjoretoy, forbruk: overstyr, ferjer: tillatFerjer }, miljø);
      return kombinerTurRetur(ut, hjem, m);
    });
    return {
      ...resultat, fra, til, kjoretoy, strøm,
      avreise: avreise.toISOString().slice(0, 16),
      // Ved «auto» vises returtiden til raskeste rute, som er den som er valgt når resultatet vises
      retur: retur ? retur.toISOString().slice(0, 16) : returAuto ? resultat.ruter[0]?.returAvreise ?? null : null,
      returAuto,
      ferjer: tillatFerjer,
      priserSistOppdatert: data.priserSistOppdatert,
    };
  },
};

async function statisk(url, res) {
  let sti = decodeURIComponent(url.pathname);
  if (sti === '/') sti = '/index.html';
  const fil = path.normalize(path.join(ROT, 'public', sti));
  if (!fil.startsWith(path.join(ROT, 'public'))) { res.writeHead(403).end(); return; }
  try {
    const innhold = await fs.readFile(fil);
    res.writeHead(200, { 'Content-Type': TYPER[path.extname(fil)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(innhold);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Fant ikke siden');
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const handler = api[`${req.method} ${url.pathname}`];
  if (!handler) {
    if (url.pathname.startsWith('/api/')) return sendJson(res, 404, { feil: 'Ukjent API-kall' });
    if (req.method !== 'GET' && req.method !== 'HEAD') return res.writeHead(405).end();
    return statisk(url, res);
  }
  try {
    sendJson(res, 200, await handler(req, url));
  } catch (e) {
    const status = Number.isInteger(e.status) ? e.status : (e instanceof RuteFeil ? (e.kode === 'ingen-rute' ? 404 : 502) : 500);
    if (status === 500) console.error(e);
    sendJson(res, status, { feil: e instanceof RuteFeil && e.kode === 'ingen-rute' ? 'Fant ingen kjørbar bilrute mellom stedene.' : e.message || 'Noe gikk galt' });
  }
});

server.listen(PORT, () => {
  console.log(`Rutepris kjører på http://localhost:${PORT}`);
  console.log(`  ${stasjoner.length} bomstasjoner, priser sist oppdatert ${data.priserSistOppdatert}, rutetjeneste: ${rutetjeneste.navn}`);
});
