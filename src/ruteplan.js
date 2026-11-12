// Finner raskeste, billigste og kompromissrute mellom to steder.
//
// Fremgangsmåte:
//   1. Raskeste rute beregnes uten begrensninger, og bommene langs den prises med våre data.
//   2. Billigste: først en rute der rutetjenesten unngår alle veier merket som bomvei i
//      OpenStreetMap (ett kall, tar også hele bomringer). Deretter legges små «unngå»-polygoner
//      rundt bommer som fortsatt koster penger, og ruta beregnes på nytt til den er bomfri
//      eller det ikke finnes en rimelig vei rundt.
//   3. Kompromiss: skal spare omtrent halvparten av forskjellen mellom raskeste og billigste.
//      Vi unngår akkurat så mange av bommene på raskeste rute at halve besparelsen dekkes
//      (dyreste først, og billigste først), og prøver i tillegg «myk» bomunngåelse. Kandidaten
//      nærmest 50 % velges, og bare hvis den sparer mellom 30 og 70 %.
// Alle kandidater prises med de samme reglene (retning, rushtid, timesregel), og ruter som tar
// mer enn MAKS_TIDSFAKTOR ganger raskeste rute forkastes.

import { finnPasseringer, unngaaPolygon, konveksHylle, punktIPolygon, meter } from './geo.js';
import { beregnBompenger, energikostnad, energiberegning, forbrukFor, klokke } from './pris.js';
import { prisFerjer } from './ferje.js';
import { navigasjonslenker } from './lenker.js';
import { RuteFeil } from './ruting.js';

export const MAKS_TIDSFAKTOR = 2;
export const KOMPROMISS_MIN = 0.3; // kompromissruta skal spare minst 30 % …
export const KOMPROMISS_MAKS = 0.7; // … og høyst 70 % av forskjellen mellom raskeste og billigste
const MAKS_RUTEKALL = 14;
const RING_MIN_STASJONER = 6;  // timesregel-gruppe med minst så mange bommer regnes som bomring
const RING_NABO_METER = 30000; // nabobommer i ringen innenfor denne avstanden sperres sammen med den belastede

// `ring` er satt på byer med avgiftsring uten felles timesregel (trängselskatt i Stockholm)
const gruppeNokkel = (s) => (s.ring ? `ring|${s.ring}` : s.timesregel?.aktiv ? `${s.prosjekt}|${s.timesregel.gruppe}` : `stasjon|${s.id}`);

/** Forhåndsberegner bomringer (timesregel-grupper) med omriss. Kalles én gang ved oppstart. */
export function byggGrupper(stasjoner) {
  const grupper = new Map();
  for (const s of stasjoner) {
    const n = gruppeNokkel(s);
    if (!grupper.has(n)) grupper.set(n, { nokkel: n, navn: s.prosjektNavn, stasjoner: [] });
    grupper.get(n).stasjoner.push(s);
  }
  for (const g of grupper.values()) {
    g.erRing = g.stasjoner.length >= RING_MIN_STASJONER;
    g.omriss = g.erRing ? konveksHylle(g.stasjoner.map((s) => [s.lat, s.lon])) : null;
  }
  return grupper;
}

export function kodPolyline(punkter, presisjon = 5) {
  const f = 10 ** presisjon;
  let ut = '', forrigeLat = 0, forrigeLon = 0;
  const kod = (v) => {
    v = v < 0 ? ~(v << 1) : v << 1;
    while (v >= 0x20) { ut += String.fromCharCode((0x20 | (v & 0x1f)) + 63); v >>= 5; }
    ut += String.fromCharCode(v + 63);
  };
  for (const [lat, lon] of punkter) {
    const la = Math.round(lat * f), lo = Math.round(lon * f);
    kod(la - forrigeLat); kod(lo - forrigeLon);
    forrigeLat = la; forrigeLon = lo;
  }
  return ut;
}

const kr = (x) => Math.round(x * 100) / 100;

/**
 * @param spørring { fra:{lat,lon,navn}, til:{…}, avreise: veggklokke-Date, kjoretoy:{drivstoff,avtale}, forbruk?, ferjer? (false = unngå ferjer) }
 * @param miljø    { stasjoner, grupper, hentRute, maksPolygoner?, maksPunkter?, mykBom?, logg? }
 */
export async function planleggRuter(spørring, miljø) {
  const { fra, til, avreise, kjoretoy, forbruk = {} } = spørring;
  const { stasjoner, grupper, hentRute } = miljø;
  const maksPolygoner = miljø.maksPolygoner ?? 20;
  const maksPunkter = miljø.maksPunkter ?? 0;
  const tung = kjoretoy.drivstoff === 'tung';
  const kandidater = new Map(); // nøkkel -> kandidat | { feil }
  const uunngåelig = new Map(); // stasjonId -> forklaring
  const stasjonMedId = new Map(stasjoner.map((s) => [s.id, s]));
  let rutekall = 0;

  // modus: 'fri' (ingen bomhensyn), 'bomfri' (unngå alle bomveier i OSM), 'myk' (vei ned bomveier)
  let ferjefri = false; // settes når en vei uten ferje er omtrent like rask
  const nøkkelFor = (unngaa, modus, utenFerje) => `${modus}${utenFerje ? '+ferjefri' : ''}|${[...unngaa.entries()].sort((a, b) => a[0] - b[0]).map(([id, skala]) => `${id}:${skala}`).join(',')}`;

  async function beregn(unngaa, modus, utenFerje = ferjefri) {
    const nøkkel = nøkkelFor(unngaa, modus, utenFerje);
    if (kandidater.has(nøkkel)) return kandidater.get(nøkkel);
    if (rutekall >= MAKS_RUTEKALL) return { feil: new RuteFeil('Maks antall ruteberegninger nådd', 'grense') };
    rutekall++;
    let resultat;
    try {
      const liste = [...unngaa.entries()];
      const rute = await hentRute({
        fra, til, tung, unngåBomveier: modus === 'bomfri', mykBom: modus === 'myk', unngåFerje: utenFerje,
        unngaa: liste.filter(([, skala]) => skala > 0).map(([id, skala]) => unngaaPolygon(stasjonMedId.get(id), skala)),
        unngaaPunkter: liste.filter(([, skala]) => skala === 0).map(([id]) => [stasjonMedId.get(id).lat, stasjonMedId.get(id).lon]),
      });
      const passeringer = finnPasseringer(rute.punkter, rute.tider, stasjoner).map((p) => ({ ...p, tid: new Date(avreise.getTime() + p.sekunder * 1000) }));
      const pris = beregnBompenger(passeringer, kjoretoy);
      // passeringer og pris.linjer har samme rekkefølge (begge sortert på tid).
      // «Belastet» = bommer som koster penger for dette kjøretøyet, også de som ble gratis pga. timesregel.
      const belastet = passeringer.filter((_, i) => pris.linjer[i].status !== 'gratis').map((p) => p.stasjon);
      const ferje = prisFerjer(rute.ferjer || [], miljø.ferjer || [], kjoretoy, avreise);
      // sum = det ruta koster i bom og ferje. Det er denne rutene rangeres etter.
      resultat = { nøkkel, unngaa: new Map(unngaa), modus, rute, passeringer, pris, belastet, ferje, sum: kr(pris.total + ferje.total) };
    } catch (e) {
      if (!(e instanceof RuteFeil)) throw e;
      resultat = { feil: e };
    }
    kandidater.set(nøkkel, resultat);
    miljø.logg?.(resultat.feil
      ? `rutekall ${rutekall}: ${modus}, unngår ${unngaa.size} bommer -> ${resultat.feil.message}`
      : `rutekall ${rutekall}: ${modus}${utenFerje ? ' uten ferje' : ''}, unngår ${unngaa.size} bommer -> ${Math.round(resultat.rute.sekunder / 60)} min, ${resultat.rute.km.toFixed(1)} km, bom ${resultat.pris.total} kr, ferje ${resultat.ferje.total} kr [${resultat.belastet.map((s) => s.navn).join(', ')}]${resultat.ferje.linjer.length ? ` {${resultat.ferje.linjer.map((f) => f.navn).join(', ')}}` : ''}`);
    return resultat;
  }

  /** Sperrelisten er Map stasjonId -> skala. skala 0 = unngå-punkt, 1 og 3 = lite og stort polygon. */
  const antall = (unngaa) => {
    let polygoner = 0, punkter = 0;
    for (const skala of unngaa.values()) if (skala === 0) punkter++; else polygoner++;
    return { polygoner, punkter };
  };

  /** Hvis en «unngått» bom likevel ble passert, traff ikke sperringen veien: bruk et større polygon én gang. */
  async function beregnMedKontroll(unngaa, modus) {
    let k = await beregn(unngaa, modus);
    if (k.feil) return k;
    const bommet = k.belastet.filter((s) => unngaa.get(s.id) === 1 || unngaa.get(s.id) === 0);
    if (bommet.length) {
      const større = new Map(unngaa);
      let polygoner = antall(større).polygoner;
      for (const s of bommet) {
        if (større.get(s.id) === 0 && polygoner >= maksPolygoner) continue;
        if (større.get(s.id) === 0) polygoner++;
        større.set(s.id, 3);
      }
      const k2 = await beregn(større, modus);
      if (!k2.feil) k = k2;
    }
    return k;
  }

  // Ferjer av (spørring.ferjer === false): alle ruter beregnes uten ferje. Finnes det ingen slik vei, brukes ferje likevel.
  const tillatFerje = spørring.ferjer !== false || !miljø.kanUnngåFerje;
  let ferjeTvunget = false;   // ferjer er slått av, men det finnes ingen vei uten
  let raskesteSekunder = null;
  let raskeste;
  if (tillatFerje) {
    raskeste = await beregn(new Map(), 'fri', false);
  } else {
    raskeste = await beregn(new Map(), 'fri', true);
    if (raskeste.feil) { kandidater.delete(nøkkelFor(new Map(), 'fri', true)); raskeste = await beregn(new Map(), 'fri', false); ferjeTvunget = true; } else ferjefri = true;
  }
  if (raskeste.feil) throw raskeste.feil;
  // Ferje på raskeste rute: ferjeruta er «Raskeste», slik navigasjonsappene også regner. Den sammenlignes
  // med veien uten ferje på kjøretid og overfartstid fra rutetabellen. Ventetiden på kaia holdes utenfor
  // sammenligningen, fordi den avhenger av når du drar (rutekortet viser den, og gir råd om avreisetid).
  // Bare når veien er raskere selv uten venting, velges ferja bort. Veien uten ferje er uansett med
  // videre som mulig kompromiss eller billigste, siden den sparer ferjebilletten.
  if (tillatFerje && raskeste.rute.ferjer?.length && miljø.kanUnngåFerje) {
    const uten = await beregn(new Map(), 'fri', true);
    if (!uten.feil) {
      const medTid = await medFerjetider(raskeste);
      if (uten.rute.sekunder <= raskeste.rute.sekunder + medTid.ferjeforsinkelse - medTid.ferjevent) {
        kandidater.delete(raskeste.nøkkel);
        raskeste = uten;
        ferjefri = true;
      } else {
        raskesteSekunder = raskeste.rute.sekunder + medTid.ferjeforsinkelse; // tidsgrensen regnes fra tiden med venting og overfart
      }
    }
  }
  const maksSekunder = (raskesteSekunder ?? raskeste.rute.sekunder) * MAKS_TIDSFAKTOR;
  // En omvei med ferje vi ikke kjenner prisen på kan ikke kalles billigere: den regnes bare med
  // når også raskeste rute har en slik ferje.
  const ok = (k) => k && !k.feil && k.rute.sekunder <= maksSekunder && (!k.ferje.harUkjent || raskeste.ferje.harUkjent);

  // Bomringer som start eller mål ligger innenfor kan ikke unngås.
  const innenfor = new Map();
  for (const g of grupper.values()) {
    if (!g.erRing) continue;
    const start = punktIPolygon([fra.lat, fra.lon], g.omriss), mål = punktIPolygon([til.lat, til.lon], g.omriss);
    if (start || mål) innenfor.set(g.nokkel, `${start && mål ? 'Start og mål' : start ? 'Start' : 'Mål'} ligger innenfor bomringen.`);
  }

  /**
   * Hvilke bommer som sperres for å unngå en belastet bom:
   *   egne   – bommen selv og andre NVDB-objekter for samme bompunkt (ett per kjørebane)
   *   naboer – resten av bomringen, nærmeste først. Uten dem velger rutetjenesten bare neste bom i ringen.
   */
  function utvid(stasjon) {
    const g = grupper.get(gruppeNokkel(stasjon));
    const her = [stasjon.lat, stasjon.lon];
    const egne = stasjoner.filter((s) => s.prosjekt === stasjon.prosjekt && meter(her, [s.lat, s.lon]) < 80);
    const naboer = !g?.erRing ? [] : g.stasjoner.filter((s) => !egne.includes(s)).map((s) => ({ s, d: meter(her, [s.lat, s.lon]) })).filter((x) => x.d < RING_NABO_METER).sort((a, b) => a.d - b.d).map((x) => x.s);
    return { egne, naboer };
  }

  const grunnVedFeil = (k) => (!k || k.feil ? 'Ingen vei utenom.' : `Omveien tar over ${MAKS_TIDSFAKTOR}× så lang tid.`);

  /** Prøver å unngå gruppene i `mål` (Map gruppenøkkel -> belastede bommer) i tillegg til det `nå` allerede unngår. */
  async function unngåGrupper(nå, mål) {
    const forsøk = new Map(nå.unngaa);
    let { polygoner, punkter } = antall(forsøk);
    let nytt = false;
    const utvidelser = [...mål.values()].flat().map(utvid);
    // De belastede bommene får polygon (presist, bare kjørebanen). Naboene i ringen får unngå-punkt.
    for (const u of utvidelser) for (const s of u.egne) if (!forsøk.has(s.id) && polygoner < maksPolygoner) { forsøk.set(s.id, 1); polygoner++; nytt = true; }
    for (const u of utvidelser) for (const s of u.naboer) {
      if (forsøk.has(s.id)) continue;
      if (punkter < maksPunkter) { forsøk.set(s.id, 0); punkter++; nytt = true; } else if (polygoner < maksPolygoner) { forsøk.set(s.id, 1); polygoner++; nytt = true; }
    }
    if (!nytt) return null;
    return beregnMedKontroll(forsøk, nå.modus);
  }

  const belastedeGrupper = (k) => {
    const m = new Map();
    for (const s of k.belastet) {
      const n = gruppeNokkel(s);
      if (uunngåelig.has(s.id)) continue;
      if (innenfor.has(n)) { uunngåelig.set(s.id, innenfor.get(n)); continue; }
      if (!m.has(n)) m.set(n, []);
      m.get(n).push(s);
    }
    return m;
  };
  /** Det gruppa faktisk koster på ruta (etter timesregel). */
  const kostnadFor = (k, bommer) => {
    const ids = new Set(bommer.map((s) => s.id));
    return k.pris.linjer.filter((l) => ids.has(l.stasjonId)).reduce((sum, l) => sum + l.pris, 0);
  };
  const dyresteFørst = (k, mål) => [...mål.entries()].sort((a, b) => kostnadFor(k, b[1]) - kostnadFor(k, a[1]));
  const lavestePris = () => Math.min(...[...kandidater.values()].filter(ok).map((k) => k.sum));

  if (raskeste.belastet.length) {
    // ---- 2. Billigste ----
    let nå = raskeste;
    const bomfri = await beregn(new Map(), 'bomfri');
    if (ok(bomfri) && bomfri.sum < raskeste.sum) nå = bomfri;
    for (let runde = 0; runde < 5 && rutekall < MAKS_RUTEKALL - 5; runde++) {
      const mål = belastedeGrupper(nå);
      if (!mål.size) break;
      const alle = await unngåGrupper(nå, mål);
      if (ok(alle) && alle.sum <= nå.sum) { nå = alle; continue; }
      // Alt på én gang gikk ikke: prøv én og én gruppe, dyreste først
      let fremgang = false;
      for (const [n, belastede] of dyresteFørst(nå, mål).slice(0, 3)) {
        const en = mål.size === 1 ? alle : await unngåGrupper(nå, new Map([[n, belastede]]));
        if (ok(en) && en.sum <= nå.sum) { nå = en; fremgang = true; } else {
          for (const s of belastede) uunngåelig.set(s.id, ok(en) ? 'Veien utenom er ikke billigere.' : grunnVedFeil(en));
        }
      }
      if (!fremgang) break;
    }

    // ---- 3. Kompromiss: spar omtrent halvparten av forskjellen mellom raskeste og billigste ----
    const spenn = raskeste.sum - lavestePris();
    if (spenn > 0) {
      const andel = (k) => (raskeste.sum - k.sum) / spenn;
      const grupperPåRaskeste = dyresteFørst(raskeste, belastedeGrupper(raskeste));
      /** Plukker grupper i gitt rekkefølge til de dekker halve besparelsen. */
      const tilHalvparten = (liste) => {
        const ut = new Map();
        let sum = 0;
        for (const [n, bommer] of liste) { if (sum >= spenn / 2) break; ut.set(n, bommer); sum += kostnadFor(raskeste, bommer); }
        return ut;
      };
      const sett = new Set();
      for (const utvalg of [tilHalvparten(grupperPåRaskeste), tilHalvparten([...grupperPåRaskeste].reverse())]) {
        const id = [...utvalg.keys()].sort().join(';');
        if (!utvalg.size || utvalg.size === grupperPåRaskeste.length || sett.has(id) || rutekall >= MAKS_RUTEKALL) continue; // alt = samme som billigste
        sett.add(id);
        let k = await unngåGrupper(raskeste, utvalg);
        // Omveien kan gå gjennom en annen bom: fortsett med den dyreste til vi nærmer oss halvparten
        for (let steg = 0; steg < 2 && ok(k) && andel(k) < KOMPROMISS_MIN && rutekall < MAKS_RUTEKALL; steg++) {
          const neste = new Map(dyresteFørst(k, belastedeGrupper(k)).slice(0, 1));
          if (!neste.size) break;
          k = await unngåGrupper(k, neste);
        }
      }
      if (miljø.mykBom && rutekall < MAKS_RUTEKALL) await beregn(new Map(), 'myk');
    }
  }

  // ---- Velg ruter ----
  const unike = [];
  for (const k of [...kandidater.values()].filter(ok)) {
    if (!unike.some((u) => Math.abs(u.rute.km - k.rute.km) < 0.15 && Math.abs(u.rute.sekunder - k.rute.sekunder) < 20 && u.sum === k.sum)) unike.push(k);
  }
  const ukjent = (k) => Number(k.pris.harUkjent || k.ferje.harUkjent);
  const billigste = [...unike].sort((a, b) => a.sum - b.sum || ukjent(a) - ukjent(b) || a.rute.sekunder - b.rute.sekunder)[0];
  const valgt = [{ id: 'raskeste', tittel: 'Raskeste', k: raskeste }];
  if (billigste !== raskeste && billigste.sum < raskeste.sum) {
    const spenn = raskeste.sum - billigste.sum;
    const andel = (k) => (raskeste.sum - k.sum) / spenn;
    const mellom = unike
      .filter((k) => k !== raskeste && k !== billigste && andel(k) >= KOMPROMISS_MIN && andel(k) <= KOMPROMISS_MAKS && k.rute.sekunder < billigste.rute.sekunder - 60)
      .sort((a, b) => Math.abs(andel(a) - 0.5) - Math.abs(andel(b) - 0.5) || a.rute.sekunder - b.rute.sekunder)[0];
    if (mellom) valgt.push({ id: 'kompromiss', tittel: 'Kompromiss', k: mellom });
    valgt.push({ id: 'billigste', tittel: 'Billigste', k: billigste });
  }
  const sisteId = valgt.at(-1).id; // det billigste vi fant: her forklares bommene som ikke lot seg unngå

  // ---- Ferjetider: neste avgang, ventetid og faktisk overfartstid for de valgte rutene ----
  /**
   * Slår opp neste avgang for hver ferje og skyver passeringene etter ferja tilsvarende.
   * ferjeforsinkelse = ventetid + avvik i overfartstid; ferjevent = bare ventetiden på kaia.
   */
  async function medFerjetider(k) {
    if (!miljø.nesteAvgang || !k.ferje.linjer.length) return { ...k, ferjeforsinkelse: 0, ferjevent: 0 };
    let forsinkelse = 0, ventet = 0;
    const linjer = [], hopp = [];
    for (const l of k.ferje.linjer) {
      let ny = l;
      if (l.fraId && l.tilId) {
        const vedKaia = new Date(avreise.getTime() + (l.startSekunder + forsinkelse) * 1000);
        const a = await miljø.nesteAvgang(l.fraId, l.tilId, vedKaia).catch(() => null);
        if (a) {
          const vent = Math.max(0, (a.avgang - vedKaia) / 1000);
          ventet += vent;
          forsinkelse += vent + ((a.ankomst - a.avgang) / 1000 - l.sekunder);
          ny = { ...l, avgang: klokke(a.avgang), ankomst: klokke(a.ankomst), ventMinutter: Math.round(vent / 60) };
          hopp.push({ etter: l.startSekunder, forsinkelse });
        }
      }
      linjer.push(ny);
    }
    if (!hopp.length) return { ...k, ferjeforsinkelse: 0, ferjevent: 0 };
    const forsinkelseVed = (sek) => hopp.reduce((f, h) => (sek > h.etter ? h.forsinkelse : f), 0);
    const passeringer = k.passeringer.map((p) => ({ ...p, tid: new Date(p.tid.getTime() + forsinkelseVed(p.sekunder) * 1000) }));
    const pris = beregnBompenger(passeringer, kjoretoy);
    return { ...k, passeringer, pris, ferje: { ...k.ferje, linjer }, sum: kr(pris.total + k.ferje.total), ferjeforsinkelse: Math.round(forsinkelse), ferjevent: Math.round(ventet) };
  }

  /** Lang ventetid på første ferje: dra senere, og kom til kaia fem til ti minutter før avgang. */
  function ferjeråd(k) {
    const første = k.ferje.linjer.find((l) => l.avgang);
    if (!første || første !== k.ferje.linjer[0] || første.ventMinutter < 15) return null;
    const minutter = Math.floor((første.ventMinutter - 5) / 5) * 5;
    if (minutter < 10 || minutter > 180) return null;
    return { minutter, avreise: klokke(new Date(avreise.getTime() + minutter * 60000)), ferje: første.navn.split(' – ')[0], avgang: første.avgang };
  }
  for (const v of valgt) v.k = await medFerjetider(v.k);
  const rask = valgt[0].k;
  const sekunderFor = (k) => Math.round(k.rute.sekunder + k.ferjeforsinkelse);

  /** Lønner det seg å dra litt før eller senere? Priser samme rute for avreise ±90 minutter. */
  function avreiseråd(k) {
    if (!k.passeringer.length) return null;
    let best = null;
    for (let m = -90; m <= 90; m += 5) {
      if (m === 0) continue;
      const total = beregnBompenger(k.passeringer.map((p) => ({ stasjon: p.stasjon, tid: new Date(p.tid.getTime() + m * 60000) })), kjoretoy).total;
      const spart = kr(k.pris.total - total);
      if (spart < 1) continue;
      if (!best || spart > best.spart + 0.005 || (Math.abs(spart - best.spart) <= 0.005 && Math.abs(m) < Math.abs(best.minutter))) best = { minutter: m, spart, pris: total };
    }
    return best && { ...best, avreise: klokke(new Date(avreise.getTime() + best.minutter * 60000)) };
  }

  const energiRask = energikostnad(rask.rute.km, kjoretoy.drivstoff, forbruk, avreise);
  const ruter = valgt.map(({ id, tittel, k }) => {
    const energi = energiberegning(k.rute.km, kjoretoy.drivstoff, forbruk, avreise);
    const passertIds = new Set(k.passeringer.map((p) => p.stasjon.id));
    const markører = [
      ...k.passeringer.map((p, i) => {
        const l = k.pris.linjer[i];
        return { id: p.stasjon.id, navn: p.stasjon.navn, prosjektNavn: p.stasjon.prosjektNavn, lat: p.stasjon.lat, lon: p.stasjon.lon, status: l.status, pris: l.pris, ordinarPris: l.ordinarPris, tid: l.tid, rush: l.rush, usikker: l.usikker };
      }),
      ...rask.passeringer.map((p, i) => ({ p, l: rask.pris.linjer[i] })).filter(({ p, l }) => l.status !== 'gratis' && !passertIds.has(p.stasjon.id)).map(({ p, l }) => (
        { id: p.stasjon.id, navn: p.stasjon.navn, prosjektNavn: p.stasjon.prosjektNavn, lat: p.stasjon.lat, lon: p.stasjon.lon, status: 'unngaatt', pris: 0, ordinarPris: l.ordinarPris, tid: null, rush: false, usikker: l.usikker }
      )),
    ];
    const erSiste = id === sisteId;
    const ikkeUnngått = !erSiste ? [] : k.pris.linjer.filter((l) => l.status === 'betalt' || l.status === 'ukjent').map((l) => ({
      stasjonId: l.stasjonId, navn: l.navn, grunn: uunngåelig.get(l.stasjonId) || 'Ingen rimelig vei utenom.',
    }));

    // Elbil: hva samme tur koster med bensinbil (samme bommer, ferjer og tidspunkter, standard bensinforbruk)
    let bensinbil = null;
    if (kjoretoy.drivstoff === 'elbil') {
      const somBensin = { drivstoff: 'bensin', avtale: kjoretoy.avtale };
      bensinbil = {
        bompenger: beregnBompenger(k.passeringer, somBensin).total,
        ferjekostnad: prisFerjer(k.rute.ferjer || [], miljø.ferjer || [], somBensin, avreise).total,
        energikostnad: energikostnad(k.rute.km, 'bensin', {}, avreise),
      };
    }

    const sekunder = sekunderFor(k), km = Math.round(k.rute.km * 10) / 10;
    return {
      id, tittel, sekunder, km,
      ekstraSekunder: sekunder - sekunderFor(rask),
      ekstraKm: Math.round((k.rute.km - rask.rute.km) * 10) / 10,
      bompenger: k.pris,
      spartBompenger: kr(rask.pris.total - k.pris.total),
      ferjer: k.ferje.linjer,
      ferjekostnad: k.ferje.total,
      ferjeUkjent: k.ferje.harUkjent,
      energi,
      energikostnad: energi.kostnad,
      ekstraEnergikostnad: kr(energi.kostnad - energiRask),
      nettoSpart: kr(rask.sum - k.sum - (energi.kostnad - energiRask)),
      totalkostnad: kr(k.sum + energi.kostnad),
      bensinbil,
      avreiseråd: avreiseråd(k),
      ventSekunder: k.ferjevent, // ventetid på ferjekai, inkludert i sekunder
      ferjeråd: ferjeråd(k),
      ikkeUnngått,
      // Én etappe per kjøreretning. Tur/retur settes sammen av to planer i src/turretur.js.
      etapper: [{
        navn: null, sekunder, km,
        geometri: kodPolyline(k.rute.punkter, 5),
        markører,
        ferjer: k.ferje.linjer,
        lenker: navigasjonslenker(fra, til, k.rute.punkter, id === 'raskeste' ? null : raskeste.rute.punkter, (k.rute.ferjer || []).map((f) => f.fra).filter(Boolean)),
      }],
      // Passeringene i maskinlesbar form, slik at tur og retur kan prises samlet (timesregel på tvers)
      passeringer: k.passeringer.map((p) => ({ id: p.stasjon.id, tid: p.tid.getTime() })),
      ruteFerjer: k.rute.ferjer || [],
    };
  });

  let melding = null;
  if (ruter.length === 1) {
    melding = rask.sum === 0 && !rask.pris.harUkjent && !rask.ferje.harUkjent ? 'Ingen bompenger på raskeste rute.' : 'Fant ingen billigere rute.';
  }
  if (ferjeTvunget) melding = 'Det finnes ingen vei uten ferje.';
  return {
    ruter,
    forbruk: forbrukFor(kjoretoy.drivstoff, forbruk, avreise),
    anbefalt: [...ruter].sort((a, b) => a.totalkostnad - b.totalkostnad || a.sekunder - b.sekunder)[0].id,
    melding,
    rutekall,
    leverandor: raskeste.rute.leverandor,
  };
}
