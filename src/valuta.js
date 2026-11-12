// Valutakurs for avgifter i Sverige og Danmark.
//
// Kilde: Norges Banks åpne API (https://data.norges-bank.no), siste offisielle kurs for SEK og DKK.
// Kursen publiseres hver bankdag rundt kl. 16. Serveren henter den ved oppstart og deretter én gang
// i døgnet, og regner om alle utenlandske takster uten omstart.

const kr = (x) => Math.round(x * 100) / 100;

/** Norges Banks siste kurs: { dato, kilde, SEK, DKK } der tallene er kroner per 1 SEK og per 1 DKK. */
export async function hentValutakurser() {
  const res = await fetch('https://data.norges-bank.no/api/data/EXR/B.SEK+DKK.NOK.SP?format=sdmx-json&lastNObservations=1&locale=no', { headers: { 'User-Agent': 'bompenge-kalkulator/1.0', Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return tolkValutakurser(await res.json());
}

/** Tolker SDMX-JSON fra Norges Bank. SEK og DKK oppgis per 100 enheter (UNIT_MULT = 2). */
export function tolkValutakurser(d) {
  const s = d.data.structure, serier = d.data.dataSets[0].series;
  const dim = s.dimensions.series, valutaIdx = dim.findIndex((x) => x.id === 'BASE_CUR');
  const attr = s.attributes.series, multIdx = attr.findIndex((x) => x.id === 'UNIT_MULT');
  const ut = { dato: s.dimensions.observation[0].values.at(-1).id, kilde: 'Norges Bank' };
  for (const [nokkel, serie] of Object.entries(serier)) {
    const kode = dim[valutaIdx].values[Number(nokkel.split(':')[valutaIdx])].id;
    const mult = Number(attr[multIdx].values[serie.attributes[multIdx]].id);
    const verdi = Number(Object.values(serie.observations).at(-1)[0]);
    ut[kode] = Math.round((verdi / 10 ** mult) * 10000) / 10000;
  }
  if (!(ut.SEK > 0.5 && ut.SEK < 2) || !(ut.DKK > 1 && ut.DKK < 3)) throw new Error(`urimelig valutakurs: ${JSON.stringify(ut)}`);
  return ut;
}

/**
 * Takster i kroner for en bro med fast pris i utenlandsk valuta.
 * @param b { valuta, bil, automatisk?, tung } – tung = null når prisen følger lengden (ukjent)
 */
export function fasteTakster(b, kurs) {
  const bil = { full: kr(b.bil * kurs), avtale: kr((b.automatisk ?? b.bil) * kurs), rushFull: null, rushAvtale: null };
  const tung = b.tung == null ? { full: null, avtale: null, rushFull: null, rushAvtale: null } : { full: kr(b.tung * kurs), avtale: kr(b.tung * kurs), rushFull: null, rushAvtale: null };
  return { bensin: bil, diesel: bil, elbil: bil, tung };
}

/**
 * Setter nye kurser inn i utenlandsdataene (data/utland.json slik serveren har lest den):
 * tidstakstene får ny kurs, og broer med fast pris får nye takster i kroner. Endrer objektet på stedet.
 */
export function brukKurser(utland, kurser) {
  for (const t of Object.values(utland.tidstakster || {})) if (kurser[t.valuta]) t.kurs = kurser[t.valuta];
  for (const s of utland.stasjoner || []) {
    const b = s.valutabeløp;
    if (b && kurser[b.valuta]) s.takster = fasteTakster(b, kurser[b.valuta]);
  }
  utland.kurser = { ...kurser };
  return utland;
}
