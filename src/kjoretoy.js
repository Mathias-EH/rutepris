// Oppslag på registreringsnummer hos Statens vegvesen (API for tekniske kjøretøyopplysninger).
// Krever gratis API-nøkkel i miljøvariabelen SVV_API_KEY.
//
//   Bestill nøkkel: https://www.vegvesen.no/dinside/data-og-api-er/tilgang-til-api-for-kjoretoyopplysninger/
//   Dokumentasjon:  https://autosys-kjoretoy-api.atlas.vegvesen.no/api-ui/index-enkeltoppslag.html
//   Spesifikasjon:  https://akfell-datautlevering.atlas.vegvesen.no/v3/api-docs
//   Grense:         50 000 kall per nøkkel per døgn
//
// Feltene under følger den publiserte spesifikasjonen (KjoretoydataResponse) og er kontrollert mot
// et ekte svar for én bil (en elbil fra 2019). Merk at registeret ikke alltid har forbrukstall:
// den bilen hadde bare rekkevidde. Da returneres wltp = null, og standardforbruket brukes.

const ENDEPUNKT = 'https://akfell-datautlevering.atlas.vegvesen.no/enkeltoppslag/kjoretoydata';

/** Ordinært, veteran- eller personlig kjennemerke: 2–7 tegn. */
export const gyldigRegnr = (s) => /^[A-ZÆØÅ0-9]{2,7}$/.test(s);
export const normaliserRegnr = (s) => String(s || '').toUpperCase().replace(/[\s-]/g, '');

const tall = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null; };
const første = (...verdier) => verdier.map(tall).find((v) => v != null) ?? null;

/**
 * Tolker svaret fra kjøretøy-API-et.
 * @returns { regnr, merke, modell, drivstoff, wltp, enhet, totalvekt } eller null når kjøretøyet ikke finnes
 */
export function tolkKjøretøydata(json) {
  const k = json?.kjoretoydataListe?.[0];
  const tekn = k?.godkjenning?.tekniskGodkjenning;
  const data = tekn?.tekniskeData;
  if (!data) return null;

  const drivverk = data.motorOgDrivverk || {};
  const grupper = data.miljodata?.miljoOgdrivstoffGruppe || [];
  const utslipp = grupper.flatMap((g) => g.forbrukOgUtslipp || []);

  // Drivstoff: fra motorene og fra miljødataene
  const navn = [
    ...(drivverk.motor || []).flatMap((m) => (m.drivstoff || []).map((d) => d.drivstoffKode)),
    ...grupper.map((g) => g.drivstoffKodeMiljodata),
  ].filter(Boolean).map((kode) => `${kode.kodeNavn || ''} ${kode.kodeBeskrivelse || ''}`.toLowerCase());
  const el = navn.some((s) => s.includes('elektr')) || drivverk.utelukkendeElektriskDrift === true;
  const bensin = navn.some((s) => s.includes('bensin')), diesel = navn.some((s) => s.includes('diesel'));

  // Ladbar hybrid: har både forbrenningsmotor og registrert elektrisk rekkevidde (eller er merket som ladbar)
  const elRekkevidde = første(...utslipp.flatMap((u) => [u.wltpKjoretoyspesifikk?.rekkeviddeKmBlandetkjoring, u.rekkeviddeKm]));
  const kategori = `${drivverk.hybridKategori?.kodeNavn || ''} ${drivverk.hybridKategori?.kodeBeskrivelse || ''} ${drivverk.hybridKategori?.kodeVerdi || ''}`;
  const merketLadbar = /ladbar|plug|ekstern|(^|[^N])OVC/i.test(kategori) && !/ikke|NOVC|non/i.test(kategori);
  const ladbar = (el && (bensin || diesel)) && (elRekkevidde != null || merketLadbar);

  const totalvekt = første(data.vekter?.tekniskTillattTotalvekt, data.vekter?.tillattTotalvekt);
  const klasse = String(tekn.kjoretoyklassifisering?.tekniskKode?.kodeVerdi || data.generelt?.tekniskKode?.kodeVerdi || '').toUpperCase();

  let drivstoff;
  if (totalvekt > 3500 && klasse !== 'M1') drivstoff = 'tung'; // M1 (personbil/bobil) over 3,5 t regnes som takstgruppe 1
  else if (ladbar) drivstoff = 'hybrid';
  else if (el && !bensin && !diesel) drivstoff = 'elbil';
  else if (diesel) drivstoff = 'diesel';   // også ikke-ladbar hybrid: belastes og kjører som fossilbil
  else if (bensin) drivstoff = 'bensin';
  else drivstoff = null;

  // WLTP-forbruk. Elbil: elEnergiforbruk er i Wh/km (f.eks. 169 = 16,9 kWh/100 km).
  // Fossil: forbrukKombinert i l/100 km, med eldre NEDC-tall (forbrukBlandetKjoring) som reserve.
  const wltp = (u) => [u.wltpKjoretoyspesifikk, u.wltpTypegodkjenningMedium, u.wltpTypegodkjenningMaks, u.wltpTypegodkjenningMin].filter(Boolean);
  let forbruk = null;
  if (drivstoff === 'elbil') {
    const whPerKm = første(...utslipp.flatMap((u) => [...wltp(u).map((w) => w.elEnergiforbruk), u.elEnergiforbruk]));
    forbruk = whPerKm == null ? null : Math.round(whPerKm) / 10;
  } else {
    forbruk = første(...utslipp.flatMap((u) => [...wltp(u).map((w) => w.forbrukKombinert), u.forbrukBlandetKjoring]));
  }

  return {
    regnr: k.kjoretoyId?.kjennemerke ? normaliserRegnr(k.kjoretoyId.kjennemerke) : null, // registeret svarer «EB 11111»
    merke: data.generelt?.merke?.[0]?.merke || null,
    modell: data.generelt?.handelsbetegnelse?.[0] || null,
    drivstoff,
    wltp: forbruk,
    enhet: drivstoff === 'elbil' ? 'kWh' : 'liter',
    rekkevidde: drivstoff === 'elbil' ? elRekkevidde : null, // WLTP-rekkevidde i km, brukes til å anslå hvor langt hjemmeladet strøm rekker
    totalvekt,
  };
}

export class KjøretøyFeil extends Error {
  constructor(melding, status) { super(melding); this.status = status; }
}

export async function slåOppKjøretøy(regnr, apiNøkkel) {
  if (!apiNøkkel) throw new KjøretøyFeil('Oppslag på registreringsnummer er ikke satt opp (mangler SVV_API_KEY).', 503);
  regnr = normaliserRegnr(regnr);
  if (!gyldigRegnr(regnr)) throw new KjøretøyFeil('Ugyldig registreringsnummer.', 400);
  let res;
  try {
    res = await fetch(`${ENDEPUNKT}?kjennemerke=${encodeURIComponent(regnr)}`, { headers: { 'SVV-Authorization': `Apikey ${apiNøkkel}`, Accept: 'application/json' }, signal: AbortSignal.timeout(10000) });
  } catch (e) {
    throw new KjøretøyFeil(`Kjøretøyregisteret svarte ikke (${e.message}).`, 502);
  }
  if (res.status === 401 || res.status === 403) throw new KjøretøyFeil('Statens vegvesen godtok ikke API-nøkkelen (ugyldig, ikke aktiv eller sperret).', 502);
  if (res.status === 429) throw new KjøretøyFeil('Døgnkvoten for oppslag i kjøretøyregisteret er brukt opp.', 429);
  if (res.status === 204 || res.status === 404) throw new KjøretøyFeil(`Fant ikke ${regnr} i kjøretøyregisteret.`, 404);
  if (!res.ok) throw new KjøretøyFeil(`Kjøretøyregisteret svarte ${res.status}.`, 502);
  const bil = tolkKjøretøydata(await res.json().catch(() => null)); // «OPPLYSNINGER_IKKE_TILGJENGELIGE» gir tom liste
  if (!bil) throw new KjøretøyFeil(`Fant ikke ${regnr} i kjøretøyregisteret.`, 404);
  if (!bil.drivstoff) throw new KjøretøyFeil('Fant kjøretøyet, men ikke drivstofftypen.', 422);
  return { ...bil, regnr };
}
