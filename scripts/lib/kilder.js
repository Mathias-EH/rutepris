// Hvilken takstside som dekker hvilket bompengeprosjekt.
//
// Koblingen mot NVDB skjer på «Operatør_Id» (egenskap 11883), som er AutoPASS'
// id for bompengeprosjektet. Rekkefølgen betyr noe: første treff vinner, så
// kilder med navnRegex må stå foran den generelle kilden for samme operatør.
//
// Vegfinans står ikke her: prosjektene deres leses automatisk fra
// vegfinans.no/bompengeprosjekter og kobles på stasjons-id.

const ferde = (slug) => `https://ferde.no/bomanlegg-og-priser/${slug}`;
const vegamot = (slug) => `https://www.vegamot.no/takster-og-bomstasjoner/${slug}/`;
const bps = (slug) => `https://bpsnord.no/prosjekter/${slug}/`;

export const KILDER = [
  { id: 'oslo', navn: 'Oslopakke 3 (bomringene i Oslo)', selskap: 'Fjellinjen', op: [100140], tolker: 'fjellinjen', urler: ['https://www.fjellinjen.no/privat/priser/'] },

  { id: 'ryfast', navn: 'Rv. 13 Ryfast', selskap: 'Ferde', op: [100014], navnRegex: /ryfylke|hundvåg|buøy|solbakk/i, tolker: 'ferde', urler: [ferde('ryfast')] },
  { id: 'nord-jaeren', navn: 'Bymiljøpakken Nord-Jæren', selskap: 'Ferde', op: [100014], tolker: 'ferde', urler: [ferde('nord-jaeren')] },
  { id: 'bergen', navn: 'Bypakke Bergen', selskap: 'Ferde', op: [100126], tolker: 'ferde', urler: [ferde('bypakke-bergen')] },
  { id: 'kristiansand', navn: 'Samferdselspakke for Kristiansandsregionen', selskap: 'Ferde', op: [100146], tolker: 'ferde', urler: [ferde('kristiansand')] },
  { id: 'haugesund', navn: 'Bypakke Haugesund og fastlands-Karmøy', selskap: 'Ferde', op: [100154], tolker: 'ferde', urler: [ferde('bypakke-haugesund')] },
  { id: 'askoy', navn: 'Askøypakken', selskap: 'Ferde', op: [100109], tolker: 'ferde', urler: [ferde('askoypakken')] },
  { id: 'forde', navn: 'Førdepakken', selskap: 'Ferde', op: [100114], tolker: 'ferde', urler: [ferde('fordepakken')] },
  { id: 'nordhordland', navn: 'Nordhordlandspakken', selskap: 'Ferde', op: [100130], tolker: 'ferde', urler: [ferde('nordhordlandspakken')] },
  { id: 'e39-kristiansand-lyngdal', navn: 'E39 Kristiansand vest – Lyngdal vest', selskap: 'Ferde', op: [100144], tolker: 'ferde', urler: [ferde('e39-kristiansand-lyngdal')] },
  { id: 'e18-tvedestrand-arendal', navn: 'E18 Tvedestrand – Arendal', selskap: 'Ferde', op: [100127], tolker: 'ferde', urler: [ferde('e18-arendal-tvedestrand')] },
  { id: 'bomlo', navn: 'Bømlopakken', selskap: 'Ferde', op: [100103], tolker: 'ferde', urler: [ferde('bomlo')] },
  { id: 'hardangerbrua', navn: 'Rv. 7/Rv. 13 Hardangerbrua', selskap: 'Ferde', op: [100106], tolker: 'ferde', urler: [ferde('hardangerbrua')] },
  { id: 'kvam', navn: 'Kvammapakken', selskap: 'Ferde', op: [100055], tolker: 'ferde', urler: [ferde('kvammapakken')] },
  { id: 'e39-svegatjorn-radal', navn: 'E39 Svegatjørn – Rådal', selskap: 'Ferde', op: [100145], tolker: 'ferde', urler: [ferde('e39-svegatjorn-radal')] },

  { id: 'trondheim', navn: 'Miljøpakken Trondheim', selskap: 'Vegamot', op: [100120], tolker: 'vegamot', urler: [vegamot('miljopakken-trondheim')] },
  { id: 'alesund', navn: 'Bypakke Ålesund', selskap: 'Vegamot', op: [100147], tolker: 'vegamot', urler: [vegamot('bypakke-alesund')] },
  { id: 'kristiansund', navn: 'Bypakke Kristiansund', selskap: 'Vegamot', op: [100157], tolker: 'vegamot', urler: [vegamot('bypakke-kristiansund')] },
  { id: 'e39-lonset-hjelset', navn: 'E39 Lønset – Hjelset', selskap: 'Vegamot', op: [100123], tolker: 'vegamot', urler: [vegamot('e39-lonset-hjelset')] },
  { id: 'e6-ulsberg-melhus', navn: 'E6 Ulsberg – Melhus', selskap: 'Vegamot', op: [100148], tolker: 'vegamot', urler: [vegamot('e6-ulsberg-melhus')] },
  { id: 'fosenpakka', navn: 'Fosenpakka', selskap: 'Vegamot', op: [100102], tolker: 'vegamot', urler: [vegamot('fosenpakka')] },
  { id: 'nordoyvegen', navn: 'Fv. 659 Nordøyvegen', selskap: 'Vegamot', op: [100125], tolker: 'vegamot', urler: [vegamot('fv-659-nordoyvegen')] },
  { id: 'lakseveien', navn: 'Fv. 714 Lakseveien', selskap: 'Vegamot', op: [100107], tolker: 'vegamot', urler: [vegamot('fv-714-lakseveien')] },
  { id: 'e6-vindasliene', navn: 'E6 Vindåsliene', selskap: 'Vegamot', op: [100122], tolker: 'vegamot', urler: [vegamot('e6-vindasliene')] },
  { id: 'fv17-fv720', navn: 'Fv. 17/Fv. 720 Dyrstad – Sprova – Malm', selskap: 'Vegamot', op: [100124], tolker: 'vegamot', urler: [vegamot('fv17-fv720-dyrstad-sprova-malm')] },
  { id: 'e6-ranheim-asen', navn: 'E6 Ranheim – Åsen', selskap: 'Vegamot', op: [100149], tolker: 'vegamot', urler: [vegamot('e6-ranheim-asen')] },

  { id: 'tromso', navn: 'Bypakke Tenk Tromsø', selskap: 'BPS Nord', op: [100151], tolker: 'bpsnord', urler: ['https://bpsnord.no/bypakke-tenk-tromso/'] },
  { id: 'harstad', navn: 'Bypakke Harstad', selskap: 'BPS Nord', op: [100112], tolker: 'bpsnord', urler: [bps('bypakke-harstad')] },
  { id: 'bodo', navn: 'Bypakke Bodø', selskap: 'BPS Nord', op: [100142], tolker: 'bpsnord', urler: [bps('bypakke-bodo')] },
  { id: 'halogalandsbrua', navn: 'Hålogalandsbrua', selskap: 'BPS Nord', op: [100141], tolker: 'bpsnord', urler: [bps('halogalandsbrua')] },
  { id: 'fv78-toven', navn: 'Fv. 78 Toven', selskap: 'BPS Nord', op: [100143], tolker: 'bpsnord', urler: [bps('fv-78-toven')] },
  { id: 'e6-helgeland', navn: 'E6 Helgeland', selskap: 'BPS Nord', op: [100111], tolker: 'bpsnord', urler: [bps('e6-helgeland'), bps('e6-helgeland-sor')] },
];

export const VEGFINANS_INDEKS = 'https://www.vegfinans.no/bompengeprosjekter';

// Private bomveier har ingen felles prisoversikt. Her står takster som er kontrollert manuelt
// mot driverens egen side. Øvrige private bomveier bruker NVDB-taksten og merkes «pris usikker».
export const PRIVATE_TAKSTER = [
  { navnRegex: /visdalsvegen/i, full: 150, kilde: 'https://onepark.no/en/tollroads/spiterstulen', verifisert: '2026-11-12' },
];

// Generelle regler med kilde. Brukes når selskapet ikke oppgir egne tall.
export const GENERELLE_REGLER = {
  brikkerabattTakstgruppe1: 0.2,
  brikkerabattKilde: 'https://www.autopass.no/no/kunde/takster-og-rabatter/',
  elbilMerknad: 'Elbilrabatten fastsettes per bompengeprosjekt (autopass.no: 30–100 % rabatt). Der prosjektets sats ikke er verifisert, settes elbilprisen til ukjent – den anslås ikke.',
};
