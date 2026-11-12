// Adresse- og stedssøk (ingen nøkkel).
//   Stedsnavn: Kartverket, https://ws.geonorge.no/stedsnavn/v1/
//   Adresser:  Kartverket, https://ws.geonorge.no/adresser/v1/
//   Reserve:   Entur, https://api.entur.io/geocoder/v1/ – brukes når Kartverkets stedsnavn er nede
//   Sverige og Danmark: Entur (byer og stasjoner), og Photon, https://photon.komoot.io/ (OpenStreetMap), som reserve

const UA = 'bompenge-kalkulator/1.0';
// Stedstyper vi tar med fra Kartverket, og hvor høyt de rangeres (lavest først). Områder som Valdres
// (dalføre), Lofoten (landskapsområde) og Senja (øy) er med, selv om de ikke er ett punkt: ruta går da til
// områdets midtpunkt hos Kartverket, og rutetjenesten finner nærmeste vei.
const STEDSTYPER = {
  By: 1, Tettsted: 2, Bydel: 3, Tettsteddel: 3, Tettbebyggelse: 3, Dalføre: 3, Landskapsområde: 3,
  Kommune: 4, Fylke: 4, 'Annen administrativ inndeling': 4,
  Bygdelag: 5, 'Bygdelag (bygd)': 5, Grend: 5, Flyplass: 5, Lufthavn: 5, 'Øy i sjø': 5, 'Øygruppe i sjø': 5, Fjellområde: 5, Fjord: 5, Nasjonalpark: 5,
  Boligfelt: 6, Poststed: 6, Alpinanlegg: 6, Skisenter: 6, Vidde: 6, 'Halvøy i sjø': 6, Dal: 6,
  Innsjø: 6, Fjell: 6, Isbre: 6, Foss: 6, Skogområde: 6, Fjellkant: 6, Stup: 6,
  Industriområde: 7, Hyttefelt: 7, Fergekai: 7, Hotell: 7, Campingplass: 7, Turisthytte: 7, Topp: 7, Adressenavn: 8,
};

// Områder og naturnavn er ikke ett sted man kan kjøre til. Søker du på «Valdres», «Mjøsa» eller
// «Preikestolen», vises derfor nærmeste by eller tettsted (Fagernes, Hamar, Jørpeland), og ruta går dit.
// Gjelder alt som ikke er et bosted, en adresse eller et anlegg med egen innkjøring.
const OMRÅDETYPER = new Set([
  'Dalføre', 'Landskapsområde', 'Fylke', 'Annen administrativ inndeling', 'Øy i sjø', 'Øygruppe i sjø', 'Halvøy i sjø',
  'Fjellområde', 'Fjell', 'Fjellkant', 'Stup', 'Topp', 'Vidde', 'Dal', 'Fjord', 'Innsjø', 'Isbre', 'Foss', 'Skogområde', 'Nasjonalpark',
]);

let norskeSteder = [];
/** Serveren laster lista over norske byer, tettsteder og bygder (data/steder-norge.json) ved oppstart. */
export function settNorskeSteder(liste) { norskeSteder = liste || []; }

/** Nærmeste by eller tettsted innen 15 km; finnes ingen, nærmeste sted av alle slag innen 30 km. Ellers null. */
export function nærmesteSted(lat, lon, steder = norskeSteder) {
  let by = null, byKm = 15, alle = null, alleKm = 30;
  const cos = Math.cos((lat * Math.PI) / 180);
  for (const s of steder) {
    const km = Math.hypot((s.lon - lon) * 111.2 * cos, (s.lat - lat) * 111.2);
    if (s.type !== 'village' && km < byKm) { by = s; byKm = km; }
    if (km < alleKm) { alle = s; alleKm = km; }
  }
  return by || alle;
}

/** Et områdetreff blir til «Valdres – Fagernes, Innlandet» med Fagernes' posisjon. Andre treff er uendret. */
export function medNærmesteSted(t, steder = norskeSteder) {
  if (!t.område) return t;
  const n = nærmesteSted(t.lat, t.lon, steder);
  if (!n) return { ...t, detalj: [t.kommune, t.fylke].filter((x, i, a) => x && a.indexOf(x) === i && x !== t.navn).join(', ') };
  return { ...t, detalj: [n.navn, t.fylke].filter((x, i, a) => x && a.indexOf(x) === i && x !== t.navn).join(', '), lat: n.lat, lon: n.lon };
}

const tittel = (s) => String(s || '').toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (_, a, b) => a + b.toUpperCase());

async function json(url, headers = {}, tidsfristMs = 8000) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json', ...headers }, signal: AbortSignal.timeout(tidsfristMs) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function steder(q) {
  // 50 treff: Kartverket blander inn gårder, myrer og stier, så de stedene vi vil ha kan ligge langt nede
  return tolkStedsnavn(await json(`https://ws.geonorge.no/stedsnavn/v1/navn?sok=${encodeURIComponent(q)}*&treffPerSide=50&utkoordsys=4258&fuzzy=true`), q);
}

/** Kartverkets stedsnavnsvar -> treff av de typene vi tar med, med rang. */
export function tolkStedsnavn(d, q = '') {
  return (d.navn || [])
    .filter((n) => n.representasjonspunkt && STEDSTYPER[n.navneobjekttype])
    .map((n) => ({
      navn: n['skrivemåte'],
      detalj: [n.navneobjekttype, n.kommuner?.[0]?.kommunenavn, n.fylker?.[0]?.fylkesnavn].filter((x, i, a) => x && a.indexOf(x) === i && x !== n['skrivemåte']).join(', '),
      // Områder (dalfører, landskap, øyer …) får nærmeste by eller tettsted i stedet – se medNærmesteSted
      område: OMRÅDETYPER.has(n.navneobjekttype), kommune: n.kommuner?.[0]?.kommunenavn || null, fylke: n.fylker?.[0]?.fylkesnavn || null,
      lat: n.representasjonspunkt.nord,
      lon: n.representasjonspunkt['øst'],
      type: 'sted',
      // Helt navn skrevet: stedet rykker foran alle som bare begynner på søket («Senja» foran «Senjahopen»).
      // Rekkefølgen mellom typene beholdes: by 0, tettsted 0,2, dalføre 0,4 … dal 0,95, så dalføret Hallingdal
      // kommer foran de små dalene med samme navn. Gater og hyttefelt rykker bare ett trinn.
      rang: n['skrivemåte'].toLowerCase() !== q.toLowerCase() ? STEDSTYPER[n.navneobjekttype]
        : STEDSTYPER[n.navneobjekttype] <= 6 ? Math.min((STEDSTYPER[n.navneobjekttype] - 1) * 0.2, 0.95) : STEDSTYPER[n.navneobjekttype] - 1,
    }));
}

/** Reserve for stedsnavn: Enturs geokoder (byer, tettsteder og knutepunkter). */
async function stederEntur(q) {
  const d = await json(`https://api.entur.io/geocoder/v1/autocomplete?text=${encodeURIComponent(q)}&lang=no&size=8&boundary.country=NOR`, { 'ET-Client-Name': 'bomruta-stedssok' });
  const rang = (k) => (k.includes('by') ? 1 : k.includes('GroupOfStopPlaces') || k.includes('tettsted') ? 2 : k.includes('bydel') || k.includes('tettsteddel') ? 3 : null);
  return (d.features || [])
    .map((f) => ({ f, r: rang(f.properties.category || []) }))
    .filter((x) => x.r != null)
    .map(({ f, r }) => ({
      navn: f.properties.name,
      detalj: [f.properties.locality, f.properties.county].filter((x, i, a) => x && a.indexOf(x) === i && x !== f.properties.name).join(', '),
      lat: f.geometry.coordinates[1],
      lon: f.geometry.coordinates[0],
      type: 'sted',
      rang: r,
    }));
}

const LAND = { SE: 'Sverige', DK: 'Danmark' };
const PHOTON_RANG = { city: 2.4, town: 3.4, borough: 4.5, suburb: 4.5, village: 5.8, hamlet: 6.5 };

/** Tolker svaret fra Photon: byer, tettsteder og adresser i Sverige og Danmark. */
export function tolkPhoton(d, q = '') {
  return (d.features || [])
    .filter((f) => LAND[f.properties.countrycode] && f.properties.name && f.geometry?.coordinates)
    .map((f) => {
      const p = f.properties;
      const sted = PHOTON_RANG[p.osm_value] != null && p.osm_key === 'place';
      const gate = p.osm_key === 'highway' || p.type === 'house' || p.type === 'street';
      return {
        navn: p.housenumber ? `${p.street || p.name} ${p.housenumber}` : p.name,
        detalj: [sted ? null : p.city || p.district, p.county || p.state, LAND[p.countrycode]].filter((x, i, a) => x && a.indexOf(x) === i && x !== p.name).join(', '),
        lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0],
        type: sted ? 'sted' : gate ? 'adresse' : 'sted',
        rang: (sted ? PHOTON_RANG[p.osm_value] : gate ? 9.5 : 7.5) + (p.name.toLowerCase() === q.toLowerCase() ? -0.5 : 0),
      };
    });
}

// ------------------------------------------- Stedsregister for Sverige og Danmark
//
// Byer, tettsteder og landsbyer fra OpenStreetMap ligger lokalt i data/steder-utland.json
// (hentes av scripts/lib/utland.js). Søket går i minnet og tåler alle tastetrykk.
//
// Rangering: norske steder skal komme først når de passer like godt. Derfor ligger en utenlandsk by
// (2,4) etter norske byer og tettsteder (1–2), og et utenlandsk tettsted (3,4) etter norske bydeler (3).
// Skriver du hele navnet, rykker stedet fram.

/** Gjør navn sammenlignbare på tvers av norsk, svensk og dansk skrivemåte: «Gøteborg» = «Göteborg», «Århus» = «Aarhus». */
export const foldNavn = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/ø/g, 'o').replace(/æ/g, 'a').replace(/ae/g, 'a').replace(/aa/g, 'a').replace(/ß/g, 'ss').replace(/[^a-z0-9]+/g, ' ').trim();

const UTLAND_TYPE = { city: [2.4, 'By'], town: [3.4, 'Tettsted'], village: [5.8, 'Bygd'] };
const LANDNAVN = { SE: 'Sverige', DK: 'Danmark' };

/** Bygger et søk over stedslista. Returnerer (q) => treff, best først. */
export function lagUtenlandssøk(steder) {
  const indeks = steder.map((s) => ({ s, navn: [s.navn, ...(s.alt || [])].map(foldNavn) }));
  return (q) => {
    const f = foldNavn(q), rå = q.toLowerCase();
    if (f.length < 2) return [];
    const treff = [];
    for (const { s, navn } of indeks) {
      if (!navn.some((n) => n.startsWith(f))) continue;
      const [grunn, typenavn] = UTLAND_TYPE[s.type] || [7, null];
      const helt = navn.includes(f);
      treff.push({
        navn: s.navn,
        detalj: [typenavn, s.nær ? `nær ${s.nær}` : null, LANDNAVN[s.land]].filter(Boolean).join(', '),
        lat: s.lat, lon: s.lon, type: 'sted', innb: s.innb || 0,
        // Helt navn skrevet riktig: −0,5. Riktig bare etter folding («Malmø» for Malmö): −0,3.
        // Landsbyer rykker ett trinn ekstra, så «Åre» kommer foran «Åre station».
        rang: grunn - (s.navn.toLowerCase() === rå ? 0.5 : helt ? 0.3 : 0) - (helt && s.type === 'village' ? 1 : 0),
      });
    }
    return treff.sort((a, b) => a.rang - b.rang || b.innb - a.innb || a.navn.localeCompare(b.navn, 'nb')).slice(0, 6);
  };
}

let utenlandssøk = null;
/** Serveren laster stedslista ved oppstart. Uten den brukes bare Entur og Photon for Sverige og Danmark. */
export function settUtenlandskeSteder(steder) { utenlandssøk = steder?.length ? lagUtenlandssøk(steder) : null; }

const ENTUR_LAND = { SWE: 'Sverige', DNK: 'Danmark' };
const ENTUR_TYPE = [['GroupOfStopPlaces', 2.4, null], ['railStation', 4.5, 'Stasjon'], ['airport', 4.6, 'Flyplass'], ['busStation', 5, 'Bussterminal'], ['ferryStop', 5.2, 'Ferjekai'], ['harbourPort', 5.2, 'Ferjekai']];

/** Tolker Enturs svar for Sverige og Danmark: byer (knutepunktgrupper), stasjoner, flyplasser og ferjekaier. */
export function tolkEnturUtland(d, q = '') {
  return (d.features || []).flatMap((f) => {
    const p = f.properties, land = ENTUR_LAND[p.country_a];
    const type = ENTUR_TYPE.find(([k]) => (p.category || []).includes(k));
    if (!land || !type) return [];
    return [{
      navn: p.name,
      detalj: [type[2], p.county, land].filter(Boolean).join(', '),
      lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0],
      type: 'sted',
      rang: type[1] + (p.name.toLowerCase() === q.toLowerCase() ? -0.5 : 0),
    }];
  });
}

/** Steder i Sverige og Danmark fra Entur: rask og stabil, men kjenner bare steder med kollektivknutepunkt. */
async function stederEnturUtland(q) {
  return tolkEnturUtland(await json(`https://api.entur.io/geocoder/v1/autocomplete?text=${encodeURIComponent(q)}&lang=no&size=10&boundary.country=SWE,DNK`, { 'ET-Client-Name': 'bomruta-stedssok' }), q);
}

/**
 * Reserve for Sverige og Danmark: Photon (komoot), bygget på OpenStreetMap. Kjenner alle steder og adresser.
 * Tjenesten er gratis og tåler ikke mange kall tett etter hverandre. Derfor sendes høyst ett kall
 * i halvannet sekund, og når det kommer et nyere søk mens et eldre venter, droppes det eldre.
 * Returnerer null når søket ble droppet.
 */
const PHOTON_PAUSE_MS = 1500;
const PHOTON_HVILE_MS = 10 * 60000; // svarer den ikke, lar vi den være i fred i ti minutter
let photonNr = 0, photonLedig = 0, photonSperretTil = 0;
async function stederUtland(q) {
  if (Date.now() < photonSperretTil) return null;
  const nr = ++photonNr;
  const vent = photonLedig - Date.now();
  if (vent > 0) await new Promise((r) => setTimeout(r, vent));
  if (nr !== photonNr) return null;
  photonLedig = Date.now() + PHOTON_PAUSE_MS;
  try {
    return tolkPhoton(await json(`https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=8&lang=default&bbox=7.5,54.4,24.5,69.1`, {}, 4000), q);
  } catch (e) {
    photonSperretTil = Date.now() + PHOTON_HVILE_MS;
    throw e;
  }
}

async function adresser(q) {
  const harNummer = /\d/.test(q);
  const hent = (fuzzy) => json(`https://ws.geonorge.no/adresser/v1/sok?sok=${encodeURIComponent(q)}${fuzzy ? '&fuzzy=true' : ''}&treffPerSide=${harNummer ? 8 : 30}&asciiKompatibel=false`);
  // Eksakt søk først. Omtrentlig søk («Tønsberg» -> «Tansberg») brukes bare når det eksakte ikke gir noe.
  let d = await hent(false);
  let omtrentlig = false;
  if (!d.adresser?.length) { d = await hent(true); omtrentlig = true; }
  const sett = new Set();
  return (d.adresser || [])
    .filter((a) => a.representasjonspunkt && (harNummer ? a.adressetekst : a.adressenavn))
    // Uten husnummer i søket: vis hver gate én gang i stedet for alle husnumrene
    .filter((a) => { if (harNummer) return true; const n = `${a.adressenavn}|${a.postnummer}`; if (sett.has(n)) return false; sett.add(n); return true; })
    .map((a) => ({
      navn: harNummer ? a.adressetekst : a.adressenavn,
      detalj: `${a.postnummer} ${tittel(a.poststed)}`,
      lat: a.representasjonspunkt.lat,
      lon: a.representasjonspunkt.lon,
      type: 'adresse',
      rang: omtrentlig ? 20 : 9,
    }));
}

/**
 * Returnerer { treff, delvis }. Inntil 8 forslag: steder først, så adresser.
 * delvis = true når en av kildene feilet, slik at svaret ikke bør mellomlagres.
 */
export async function søk(q) {
  q = String(q || '').trim();
  if (q.length < 2) return { treff: [], delvis: false };
  const koord = q.match(/^(-?\d{1,2}(?:\.\d+)?)\s*[,; ]\s*(-?\d{1,3}(?:\.\d+)?)$/);
  if (koord) return { treff: [{ navn: `${koord[1]}, ${koord[2]}`, detalj: 'Koordinat', lat: Number(koord[1]), lon: Number(koord[2]), type: 'koordinat' }], delvis: false };

  const [s, a, e] = await Promise.allSettled([steder(q), adresser(q), stederEnturUtland(q)]);
  let stedstreff = (s.value || []).map((t) => medNærmesteSted(t));
  let delvis = s.status === 'rejected' || a.status === 'rejected' || e.status === 'rejected';
  // Sverige og Danmark: det lokale stedsregisteret først, så Entur (stasjoner, flyplasser, ferjekaier).
  // Byer Entur og registeret har felles vises én gang. Photon spørres bare når ingen av kildene har et
  // sted som begynner på søket – i praksis for adresser.
  const fq = foldNavn(q);
  const begynner = (t) => foldNavn(t.navn).startsWith(fq);
  let lokale = utenlandssøk ? utenlandssøk(q) : [];
  // Kartverket har noen utenlandske byer selv («Göteborg», «Skagen»), uten kommune og fylke. Da vises stedet
  // én gang, med land og type fra registeret.
  lokale = lokale.filter((l) => {
    const samme = stedstreff.find((t) => foldNavn(t.navn) === foldNavn(l.navn) && Math.abs(t.lat - l.lat) < 0.25 && Math.abs(t.lon - l.lon) < 0.5);
    if (samme) samme.detalj = l.detalj;
    return !samme;
  });
  const lokaleNavn = new Set([...lokale, ...stedstreff].map((t) => foldNavn(t.navn)));
  const u = { value: [...lokale, ...(e.value || []).filter((t) => !(t.rang < 3 && lokaleNavn.has(foldNavn(t.navn))))] };
  if (q.length >= 4 && !stedstreff.some((t) => t.rang <= 3 && begynner(t)) && !u.value.some(begynner)) {
    const photon = await stederUtland(q).catch(() => null);
    if (photon == null) delvis = true; // droppet eller feilet: ikke mellomlagre
    else u.value = [...u.value, ...photon];
  }
  if (s.status === 'rejected' || !stedstreff.length) {
    try { stedstreff = await stederEntur(q); } catch { delvis = true; }
  }
  const utland = u.value || [];
  if (!stedstreff.length && !utland.length && a.status === 'rejected') throw new Error('Adressesøket er utilgjengelig akkurat nå');

  const harTall = /\d/.test(q);
  const alle = [...stedstreff, ...(a.value || []), ...utland].sort((x, y) => (harTall ? (x.type === 'adresse' ? 0 : 1) - (y.type === 'adresse' ? 0 : 1) : 0) || x.rang - y.rang);
  const sett = new Set(), treff = [];
  for (const t of alle) {
    const n = `${t.navn}|${t.detalj}`.toLowerCase();
    if (sett.has(n)) continue;
    sett.add(n);
    treff.push({ navn: t.navn, detalj: t.detalj, lat: t.lat, lon: t.lon, type: t.type });
    if (treff.length >= 8) break;
  }
  return { treff, delvis };
}
