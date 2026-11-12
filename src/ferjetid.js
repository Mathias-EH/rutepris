// Neste ferjeavgang fra Enturs reiseplanlegger (åpen, krever bare klientnavn).
// https://developer.entur.org/pages-journeyplanner-journeyplanner

const ENTUR = 'https://api.entur.io/journey-planner/v3/graphql';
const MAKS_VENTETID_MS = 6 * 3600000; // lengre ventetid enn dette tolkes som «ingen avgang funnet»

/** Siste søndag i måneden (dag i måneden). */
const sisteSøndag = (år, måned) => { const d = new Date(Date.UTC(år, måned + 1, 0)); return d.getUTCDate() - d.getUTCDay(); };

/** Norsk tidsforskyvning for en veggklokketid: sommertid fra siste søndag i mars til siste søndag i oktober. */
export function norskForskyvning(veggklokke) {
  const år = veggklokke.getUTCFullYear();
  const start = Date.UTC(år, 2, sisteSøndag(år, 2), 2), slutt = Date.UTC(år, 9, sisteSøndag(år, 9), 3);
  return veggklokke.getTime() >= start && veggklokke.getTime() < slutt ? '+02:00' : '+01:00';
}

/** Veggklokke-Date -> «2026-11-13T10:07:00+01:00». */
export const tilIso = (veggklokke) => veggklokke.toISOString().slice(0, 19) + norskForskyvning(veggklokke);
/** «2026-11-13T10:15:00+01:00» -> veggklokke-Date (klokkeslettet slik det står). */
export const fraIso = (iso) => new Date(`${iso.slice(0, 19)}Z`);

/**
 * Første ferjeavgang fra kai `fraId` til kai `tilId` etter gitt tidspunkt.
 * @returns { avgang, ankomst } som veggklokke-Date, eller null når ingen avgang finnes
 */
export async function nesteAvgang(fraId, tilId, veggklokke) {
  const query = `{ trip(from: {place: "${fraId}"}, to: {place: "${tilId}"}, dateTime: "${tilIso(veggklokke)}", numTripPatterns: 1, modes: {transportModes: [{transportMode: water}], directMode: null}) { tripPatterns { legs { mode expectedStartTime expectedEndTime } } } }`;
  const res = await fetch(ENTUR, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'ET-Client-Name': 'bomruta-ferjetider' },
    body: JSON.stringify({ query }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`Entur svarte ${res.status}`);
  const etappe = (await res.json())?.data?.trip?.tripPatterns?.[0]?.legs?.find((l) => l.mode === 'water');
  if (!etappe) return null;
  const avgang = fraIso(etappe.expectedStartTime), ankomst = fraIso(etappe.expectedEndTime);
  if (avgang - veggklokke > MAKS_VENTETID_MS || avgang < veggklokke - 60000) return null;
  return { avgang, ankomst };
}
