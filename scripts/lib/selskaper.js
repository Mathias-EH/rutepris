// Tolker takstsidene til bompengeselskapene.
//
// Hver tolker tar HTML/tekst og returnerer samme struktur:
// {
//   gyldigFra,                      tekst fra kilden, f.eks. «Fra 1. januar 2026»
//   felles: { bensin, diesel, elbil, tung } | null     takst som gjelder alle stasjoner
//   stasjoner: [{ nr, nokkel, navn, bensin, elbil, tung }]   takst per stasjon
//   rush: { vinduer: [[fra, til], ...], unntattJuli } | null
//   rushAlleStasjoner: true | false | null
//   timesregel: { aktiv, minutter, regel } | null
//   maanedstak: tall | null         kun til informasjon, brukes ikke i beregningen
// }
// der bensin/diesel/elbil/tung = { full, avtale, rushFull, rushAvtale } (kroner).

import { tilTekst, tall } from './hent.js';

const tom = () => ({ gyldigFra: null, felles: null, stasjoner: [], rush: null, rushAlleStasjoner: null, timesregel: null, maanedstak: null });

// ---------------------------------------------------------------- Ferde ----

const FERDE_NOKLER = {
  'Med avtale': 'avtale',
  'Rushtid med avtale': 'rushAvtale',
  'Uten avtale': 'full',
  'Rushtid uten avtale': 'rushFull',
  Pris: 'full',
};

function ferdeRader(seksjon, etiketter) {
  const t = seksjon.split('|').map((x) => x.trim());
  const ut = {};
  for (let i = 0; i < t.length; i++) {
    if (!etiketter.includes(t[i]) || ut[t[i]]) continue;
    const rad = {};
    let j = i + 1;
    while (j < t.length) {
      if (t[j] === '*' || t[j] === '') { j++; continue; }
      const nokkel = FERDE_NOKLER[t[j]];
      const verdi = tall(t[j + 1]);
      if (!nokkel || verdi == null || !/^[\d.,]+$/.test(t[j + 1])) break;
      rad[nokkel] = verdi;
      j += 2;
    }
    if (Object.keys(rad).length) ut[t[i]] = rad;
  }
  return ut;
}

export function tolkFerde(html) {
  const tekst = tilTekst(html);
  const ut = tom();
  const start = tekst.indexOf('Gjeldende priser');
  const tg1Start = tekst.indexOf('Takstgruppe |1|', start);
  if (start < 0 || tg1Start < 0) return null;
  ut.gyldigFra = (tekst.slice(start).match(/Gjeldende priser\|([^|]+)\|/) || [])[1]?.trim() || null;

  const slutt = (fra, ...merker) => {
    const idx = merker.map((m) => tekst.indexOf(m, fra)).filter((i) => i > 0);
    return idx.length ? Math.min(...idx) : tekst.length;
  };
  const tg2Start = tekst.indexOf('Takstgruppe |2|', tg1Start);
  const tg1 = tekst.slice(tg1Start, slutt(tg1Start + 10, 'Utgåtte priser', 'Takstgruppe |2|'));
  const tg2 = tg2Start > 0 ? tekst.slice(tg2Start, slutt(tg2Start + 10, 'Utgåtte priser', '|Fritak|')) : '';

  // Oppsett med én rad per stasjon
  const perStasjon = /\|([^|]+)\|Ordinære kjøretøy, med avtale\|([\d.,]+)\|Ordinære kjøretøy, uten avtale\|([\d.,]+)\|Nullutslippskjøretøy, med avtale\|([\d.,]+)\|Nullutslippskjøretøy, uten avtale\|([\d.,]+)/g;
  const tungPerNavn = new Map();
  for (const m of tg2.matchAll(perStasjon)) tungPerNavn.set(m[1].trim(), { full: tall(m[3]), avtale: tall(m[2]) });
  for (const m of tg1.matchAll(perStasjon)) {
    const navnene = m[1].trim().split(/,\s*(?=(?:E|Rv|Fv)\.?\s*\d)/);
    for (const navn of navnene) {
      ut.stasjoner.push({
        navn: navn.trim(),
        bensin: { avtale: tall(m[2]), full: tall(m[3]) },
        elbil: { avtale: tall(m[4]), full: tall(m[5]) },
        tung: tungPerNavn.get(m[1].trim()) || null,
      });
    }
  }

  // Oppsett med felles takst (eventuelt per drivstoff og med rushtid)
  if (!ut.stasjoner.length) {
    const r1 = ferdeRader(tg1, ['Ordinære kjøretøy', 'Nullutslippskjøretøy', 'Bensin/hybrid', 'Diesel', 'Elektrisk']);
    const r2 = ferdeRader(tg2, ['Ordinære kjøretøy', 'Euro V og eldre', 'Euro VI / hybrid']);
    const bensin = r1['Bensin/hybrid'] || r1['Ordinære kjøretøy'];
    if (!bensin) return null;
    const tungRad = r2['Euro VI / hybrid'] || r2['Ordinære kjøretøy'] || null;
    ut.felles = {
      bensin,
      diesel: r1['Diesel'] || null,
      elbil: r1['Elektrisk'] || r1['Nullutslippskjøretøy'] || null,
      tung: tungRad ? { full: tungRad.full, avtale: tungRad.avtale ?? tungRad.full, rushFull: tungRad.rushFull ?? tungRad.rushAvtale ?? null } : null,
      tungMerknad: r2['Euro VI / hybrid'] ? 'Euro VI' : null,
    };
  }

  const rush = tekst.match(/kl\.? ?(\d\d[:.]\d\d)\s*[–-]\s*(\d\d[:.]\d\d)\s*og\s*(?:kl\.? ?)?(\d\d[:.]\d\d)\s*[–-]\s*(\d\d[:.]\d\d)/);
  if (rush) ut.rush = { vinduer: [[rush[1], rush[2]], [rush[3], rush[4]]].map((v) => v.map((t) => t.replace('.', ':'))), unntattJuli: false };
  if (/Rushtid gjelder alle stasjoner/.test(tekst)) ut.rushAlleStasjoner = true;
  else if (/Rushtid gjelder markerte stasjoner/.test(tekst)) ut.rushAlleStasjoner = false;

  const ti = tekst.indexOf('|Timesregel|');
  if (ti > 0) {
    const del = tekst.slice(ti, ti + 500);
    ut.timesregel = {
      aktiv: true,
      minutter: Number((del.match(/(\d+) minutter/) || [])[1]) || 60,
      // Ferde oppgir regelen per prosjekt: «den dyreste passeringen» (Bergen) eller «den første passeringen» (Kristiansand, Nord-Jæren)
      regel: /dyreste/.test(del) ? 'dyreste' : /første passeringen/i.test(del) ? 'forste' : null,
      kreverAvtale: /Timesregel\|Med gyldig AutoPASS-avtale/.test(del),
    };
  } else if (/gis ikke timesregel/i.test(tekst)) {
    ut.timesregel = { aktiv: false, minutter: null, regel: null };
  }
  const tak = tekst.match(/maks (\d+) passeringer/);
  if (tak) ut.maanedstak = Number(tak[1]);
  return ut;
}

// -------------------------------------------------------------- Vegamot ----

function vegamotRader(seksjon) {
  const rader = new Map();
  for (const m of seksjon.matchAll(/(\d+)\) ?([^|]+)\|Rushtid \*\|((?:(?:kr [\d.,]+|-) ?\|)+)/g)) {
    const nr = Number(m[1]);
    if (rader.has(nr)) continue;
    rader.set(nr, { nr, navn: m[2].trim(), verdier: [...m[3].matchAll(/kr ([\d.,]+)|-/g)].map((v) => (v[1] ? tall(v[1]) : null)) });
  }
  return rader;
}

export function tolkVegamot(html) {
  const tekst = tilTekst(html);
  const ut = tom();
  const merke = 'Takster per veisnitt';
  const a = tekst.indexOf(merke);
  if (a < 0) return null;
  const b = tekst.indexOf(merke, a + merke.length);
  const tg1 = vegamotRader(tekst.slice(a, b > 0 ? b : tekst.length));
  const tg2Hode = tekst.indexOf('Takstgruppe 2|Ordinære takster', a);
  const c = tg2Hode > 0 ? tekst.indexOf(merke, tg2Hode) : -1;
  const d = c > 0 ? tekst.indexOf(merke, c + merke.length) : -1;
  const tg2 = c > 0 ? vegamotRader(tekst.slice(c, d > 0 ? d : tekst.length)) : new Map();

  for (const rad of tg1.values()) {
    const v = rad.verdier;
    let bensin, elbil;
    if (v.length >= 6) {
      bensin = { full: v[0], rushFull: v[1], avtale: v[2], rushAvtale: v[3] };
      elbil = { full: v[0], rushFull: v[1], avtale: v[4], rushAvtale: v[5] };
    } else if (v.length >= 3) {
      bensin = { full: v[0], avtale: v[1] };
      elbil = { full: v[0], avtale: v[2] };
    } else continue;
    const t = tg2.get(rad.nr)?.verdier;
    const tung = t ? (t.length >= 4 ? { full: t[0], rushFull: t[1], avtale: t[2] } : { full: t[0], avtale: t[1] ?? t[0] }) : null;
    ut.stasjoner.push({ nr: rad.nr, navn: rad.navn, bensin, elbil, tung });
  }
  if (!ut.stasjoner.length) return null;

  const rush = tekst.match(/Rushtidsavgift gjelder i tidsrommene mellom (\d\d:\d\d) til (\d\d:\d\d), og (\d\d:\d\d)-(\d\d:\d\d)/);
  if (rush) ut.rush = { vinduer: [[rush[1], rush[2]], [rush[3], rush[4]]], unntattJuli: false };
  const tr = tekst.match(/Timesregelen satt til (\d+) minutter/);
  if (tr) ut.timesregel = { aktiv: true, minutter: Number(tr[1]), regel: null };
  const tak = tekst.match(/månedstaket (\d+) betalende/);
  if (tak) ut.maanedstak = Number(tak[1]);
  return ut;
}

// ------------------------------------------------------------- BPS Nord ----

function bpsRader(seksjon) {
  const ut = [];
  const re = /\|([^|]*[A-Za-zÆØÅæøå][^|]*)\|([\d.,]+)(?: kr)? ?\|([\d.,]+)(?: kr)? ?\|([\d.,]+)(?: kr)? ?\|([\d.,]+)(?: kr)? ?(?=\|)/g;
  for (const m of seksjon.matchAll(re)) ut.push({ navn: m[1].trim(), v: [tall(m[2]), tall(m[3]), tall(m[4]), tall(m[5])] });
  return ut;
}

export function tolkBpsNord(html) {
  const tekst = tilTekst(html);
  const ut = tom();
  const a = tekst.indexOf('Takstgruppe 1');
  const b = tekst.indexOf('Takstgruppe 2', a);
  if (a < 0 || b < 0) return null;
  const slutt2 = ['Regler og fritak', 'Fritak og regler', 'De 15 bomstasjonene'].map((m) => tekst.indexOf(m, b)).filter((i) => i > 0);
  const del = (s) => {
    const i = s.indexOf('Rushtidsavgift');
    return i > 0 ? [s.slice(0, i), s.slice(i)] : [s, ''];
  };
  const [n1, rush1] = del(tekst.slice(a, b));
  const [n2, rush2] = del(tekst.slice(b, slutt2.length ? Math.min(...slutt2) : tekst.length));
  const normal = bpsRader(n1), rushRader = bpsRader(rush1), tungN = bpsRader(n2), tungR = bpsRader(rush2);
  if (!normal.length) return null;

  const bygg = (rad, i) => {
    const r = rushRader[i]?.v, t = tungN[i]?.v, tr = tungR[i]?.v;
    return {
      navn: rad.navn,
      bensin: { full: rad.v[0], avtale: rad.v[1], rushFull: r?.[0] ?? null, rushAvtale: r?.[1] ?? null },
      elbil: { full: rad.v[2], avtale: rad.v[3], rushFull: r?.[2] ?? null, rushAvtale: r?.[3] ?? null },
      tung: t ? { full: t[0], avtale: t[1], rushFull: tr?.[0] ?? null } : null,
    };
  };
  if (normal.length === 1 && /^Alle bomstasjoner/i.test(normal[0].navn)) ut.felles = bygg(normal[0], 0);
  else ut.stasjoner = normal.map(bygg);

  const rush = tekst.match(/Rushtidsavgift (\d\d:\d\d)-(\d\d:\d\d) (\d\d:\d\d)-(\d\d:\d\d)/);
  if (rush) { ut.rush = { vinduer: [[rush[1], rush[2]], [rush[3], rush[4]]], unntattJuli: false }; ut.rushAlleStasjoner = true; }
  const tr = tekst.match(/Timesregel\|(Ja|Nei)/);
  if (tr) {
    const i = tekst.indexOf(tr[0]);
    const d = tekst.slice(i, i + 500);
    ut.timesregel = {
      aktiv: tr[1] === 'Ja',
      minutter: tr[1] === 'Ja' ? Number((d.match(/(\d+) minutter/) || [])[1]) || 60 : null,
      regel: /første\|? ?registrerte passeringen/i.test(d.replace(/\|/g, ' ')) ? 'forste' : null,
    };
  }
  const tak = tekst.match(/maks (\d+) passeringer/);
  if (tak) ut.maanedstak = Number(tak[1]);
  return ut;
}

// ------------------------------------------------------------ Vegfinans ----

export function vegfinansSlugs(html) {
  return [...new Set([...html.matchAll(/href="\/bompengeprosjekter\/([a-z0-9-]+)"/g)].map((m) => m[1]))];
}

export function tolkVegfinans(html) {
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return null;
  const data = JSON.parse(m[1])?.props?.pageProps?.data;
  if (!data) return null;
  const ut = tom();
  ut.navn = data.name;
  ut.status = data.status;
  for (const s of data.tollStations || []) {
    const id = String(s._id || '').match(/-(\d{6})(\d*)$/); // operatør-id (6 siffer) + ev. stasjonsnummer
    if (!id || !s.tg1) continue;
    ut.stasjoner.push({
      nokkel: `${Number(id[1])}:${id[2] ? Number(id[2]) : ''}`,
      navn: s.name,
      bensin: { full: s.tg1.fullPrice, avtale: s.tg1.autoPassPrice },
      elbil: s.tg1ZeroEmission ? { full: s.tg1ZeroEmission.fullPrice, avtale: s.tg1ZeroEmission.autoPassPrice } : null,
      tung: s.tg2 ? { full: s.tg2.fullPrice, avtale: s.tg2.autoPassPrice } : null,
    });
  }
  const regler = JSON.stringify(data.feeInfoItems || []);
  const tak = regler.match(/passeringstak på (\d+) passeringer/);
  if (tak) ut.maanedstak = Number(tak[1]);
  return ut;
}

// ----------------------------------------------------------- Fjellinjen ----

export function tolkFjellinjen(html) {
  const tekst = tilTekst(html);
  const a = tekst.indexOf('Takstgruppe 1: Liten bil');
  const b = tekst.indexOf('Takstgruppe 2: Stor bil', a);
  if (a < 0 || b < 0) return null;
  const to = (seksjon, etikett) => [...seksjon.matchAll(new RegExp(`(\\d+) kr\\|${etikett}\\|`, 'g'))].map((m) => Number(m[1]));
  const tg1 = tekst.slice(a, b), tg2 = tekst.slice(b, b + 900);
  const rad = (seksjon, etikett) => {
    const [normal, rush] = to(seksjon, etikett);
    return normal == null || rush == null ? null : { full: normal, rushFull: rush };
  };
  const bensin = rad(tg1, 'Bensin/ladbar hybrid'), diesel = rad(tg1, 'Diesel'), elbil = rad(tg1, 'Elbil'), tung = rad(tg2, 'Euro 6');
  if (!bensin || !diesel || !elbil) return null;
  const ut = tom();
  const rabatt = /20 prosent rabatt/.test(tg1) ? 0.8 : null;
  if (!rabatt) return null;
  const medAvtale = (r) => ({ ...r, avtale: Math.round(r.full * rabatt * 100) / 100, rushAvtale: Math.round(r.rushFull * rabatt * 100) / 100 });
  ut.felles = { bensin: medAvtale(bensin), diesel: medAvtale(diesel), elbil: medAvtale(elbil), tung: tung ? { ...tung, avtale: tung.full } : null, tungMerknad: 'Euro 6' };
  const rush = tekst.match(/mellom (\d\d)\.(\d\d) - (\d\d)\.(\d\d) og (\d\d)\.(\d\d) - (\d\d)\.(\d\d)/);
  if (rush) ut.rush = { vinduer: [[`${rush[1]}:${rush[2]}`, `${rush[3]}:${rush[4]}`], [`${rush[5]}:${rush[6]}`, `${rush[7]}:${rush[8]}`]], unntattJuli: /eller i juli/.test(tekst) };
  ut.rushAlleStasjoner = true;
  ut.timesregel = { aktiv: true, minutter: 60, regel: null };
  return ut;
}

export const TOLKERE = { ferde: tolkFerde, vegamot: tolkVegamot, bpsnord: tolkBpsNord, fjellinjen: tolkFjellinjen };
