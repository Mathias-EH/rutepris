// Strømpris for hjemmelading: spotpris med strømstøtte, eller Norgespris, pluss nettleie.
//
// Kilder (kontrollert november 2026):
//   Spotpris per time og prisområde: https://www.hvakosterstrommen.no/strompris-api (uten mva)
//   Strømstøtte 2026: staten dekker 90 % av spotprisen over 77 øre/kWh uten mva, time for time (regjeringen.no)
//   Norgespris: 50 øre/kWh med mva (40 øre uten) til og med 31.12.2026 (regjeringen.no / NVE)
//   Nettleie: energiledd 18,87 øre (landssnitt, NVE) + elavgift 7,13 øre + Enova 1,0 øre = 27,0 øre uten mva
//   Mva 25 %, unntatt husholdninger i Nord-Norge (NO4)

export const STRØMREGLER = {
  støtteTerskelUtenMva: 0.77,
  støtteAndel: 0.9,
  norgesprisUtenMva: 0.40,
  nettleieUtenMva: 0.27,
  mva: 0.25,
};

const kr = (x) => Math.round(x * 100) / 100;
const medMva = (x, område) => (område === 'NO4' ? x : x * (1 + STRØMREGLER.mva));

// Riksgrensa Norge–Sverige som lengdegrad per breddegrad (grovt). Øst for linja regnes som Sverige.
const GRENSE = [[59.1, 11.6], [59.2, 11.75], [60.0, 12.5], [61.0, 12.75], [62.0, 12.2], [63.0, 12.1], [64.0, 13.9], [65.0, 14.4], [66.0, 15.0], [67.0, 16.3], [68.0, 18.1], [69.06, 20.4]];

/** Omtrentlig land ut fra posisjon: 'NO', 'SE' eller 'DK'. Brukes bare til å velge strømprisområde. */
export function landFor(lat, lon) {
  // Danmark: vest for en linje gjennom Kattegat og Øresund, pluss Bornholm
  if (lat < 57.8 && lon < (lat > 56.15 ? 11.75 : lat > 55.9 ? 12.65 : 12.75)) return 'DK';
  if (lat < 55.35 && lon > 14.6 && lon < 15.25) return 'DK';
  if (lat < 58.88) return lon > 10.9 ? 'SE' : 'NO';
  // Ved Iddefjorden: Strömstad-siden er svensk, kilen ned mot Kornsjø er norsk
  if (lat < 59.1) return (lon > 11.1 && lon < 11.45) || lon > 11.8 ? 'SE' : 'NO';
  if (lat > 69.06) return 'NO';
  let i = 1;
  while (i < GRENSE.length - 1 && GRENSE[i][0] < lat) i++;
  const [la0, lo0] = GRENSE[i - 1], [la1, lo1] = GRENSE[i];
  return lon > lo0 + ((lo1 - lo0) * (lat - la0)) / (la1 - la0) ? 'SE' : 'NO';
}

// Sverige og Danmark: spotpris med 25 % mva og landets strømavgift. Nettavgiften er ikke med (varierer for mye
// mellom nettselskapene til at vi har et tall å stå inne for).
//   Sverige: energiskatt 36 öre/kWh uten mva fra 1.1.2026 (45 öre med mva)
//   Danmark: elafgift 0,8 øre/kWh uten mva i 2026–2027 (1 øre med mva)
export const UTLANDSAVGIFT = { SE: { valuta: 'SEK', avgiftMedMva: 0.45, felt: 'SEK_per_kWh' }, DK: { valuta: 'DKK', avgiftMedMva: 0.01, felt: 'DKK_per_kWh' } };

/** Hjemmeladepris i kroner når turen starter i Sverige eller Danmark, eller null når spotprisen mangler. */
export function utenlandskHjemmepris(timer, område, dato, kurser) {
  const u = UTLANDSAVGIFT[område.slice(0, 2)], kurs = kurser?.[u?.valuta];
  if (!u || !kurs || !timer?.length) return null;
  const spot = timer.reduce((sum, t) => sum + t[u.felt], 0) / timer.length;
  const strøm = kr(spot * 1.25 * kurs), avgift = kr(u.avgiftMedMva * kurs);
  return { pris: kr(strøm + avgift), avtale: 'spot', område, strøm, nettleie: avgift, grunnlag: `Spotpris ${område} ${dato} med mva og strømavgift, uten nettavgift` };
}

/**
 * Omtrentlig prisområde ut fra posisjon. Grensene følger ikke fylkesgrensene nøyaktig,
 * så brukeren kan overstyre området i skjemaet.
 */
export function prisområde(lat, lon) {
  const land = landFor(lat, lon);
  if (land === 'DK') return lon < 11.0 ? 'DK1' : 'DK2';                                        // vest og øst for Storebælt
  if (land === 'SE') return lat < 57.3 ? 'SE4' : lat < 61.0 ? 'SE3' : lat < 64.5 ? 'SE2' : 'SE1'; // Malmö, Stockholm, Sundsvall, Luleå
  if (lat >= 65.0) return 'NO4';                 // Nordland, Troms, Finnmark
  if (lat >= 62.0) return 'NO3';                 // Trøndelag, Møre og Romsdal
  if (lon < 7.6 && lat >= 59.9) return 'NO5';    // Vestland (Bergen)
  if (lon < 9.7 && lat < 59.9) return 'NO2';     // Agder, Rogaland, Telemark vest
  return 'NO1';                                  // Østlandet
}

/** Én times spotpris (uten mva) -> det husholdningen betaler etter strømstøtte, med mva. */
export function timeprisEtterStøtte(spotUtenMva, område) {
  const støtte = Math.max(0, spotUtenMva - STRØMREGLER.støtteTerskelUtenMva) * STRØMREGLER.støtteAndel;
  return medMva(spotUtenMva - støtte, område);
}

export const norgespris = (område) => kr(medMva(STRØMREGLER.norgesprisUtenMva, område));
export const nettleie = (område) => kr(medMva(STRØMREGLER.nettleieUtenMva, område));

/** Gjennomsnittlig strømpris over døgnet etter strømstøtte, med mva (kr/kWh). */
export function døgnsnittEtterStøtte(timer, område) {
  if (!timer?.length) return null;
  return kr(timer.reduce((sum, t) => sum + timeprisEtterStøtte(t.NOK_per_kWh, område), 0) / timer.length);
}

/**
 * Hjemmeladepris i kr/kWh med mva og nettleie.
 * @param avtale 'spot' | 'norgespris'
 * @param hentTimer async (område, 'ÅÅÅÅ-MM-DD') -> timepriser, eller null når de ikke finnes
 * @returns { pris, avtale, område, strøm, nettleie, grunnlag }
 */
export async function hjemmepris({ avtale, område, dato, hentTimer, kurser }) {
  if (!område.startsWith('NO')) {
    let timer = null;
    try { timer = await hentTimer(område, dato); } catch { /* ukjent pris under */ }
    return utenlandskHjemmepris(timer, område, dato, kurser);
  }
  const nett = nettleie(område);
  if (avtale !== 'norgespris') {
    let timer = null;
    try { timer = await hentTimer(område, dato); } catch { /* faller tilbake under */ }
    const strøm = døgnsnittEtterStøtte(timer, område);
    if (strøm != null) return { pris: kr(strøm + nett), avtale: 'spot', område, strøm, nettleie: nett, grunnlag: `Spotpris ${område} ${dato} etter strømstøtte` };
  }
  const strøm = norgespris(område);
  return { pris: kr(strøm + nett), avtale: 'norgespris', område, strøm, nettleie: nett, grunnlag: avtale === 'norgespris' ? 'Norgespris' : 'Norgespris (spotprisen var ikke tilgjengelig)' };
}

/** Henter timepriser fra hvakosterstrommen.no. Prisene finnes for i dag og (etter ca. kl. 13) i morgen. */
export async function hentSpotpriser(område, dato) {
  const [år, måned, dag] = dato.split('-');
  // Søstertjenestene i Sverige og Danmark har samme adresseoppsett
  const vert = område.startsWith('SE') ? 'www.elprisetjustnu.se' : område.startsWith('DK') ? 'www.elprisenligenu.dk' : 'www.hvakosterstrommen.no';
  const res = await fetch(`https://${vert}/api/v1/prices/${år}/${måned}-${dag}_${område}.json`, { headers: { 'User-Agent': 'bompenge-kalkulator/1.0' }, signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}
