#!/usr/bin/env node
// Lagrer et øyeblikksbilde av selskapenes takstsider i test/fixtures/, slik at tolkerne kan
// testes uten nettverk (test/tolkere.test.js).
//
//   node scripts/lag-testdata.js
//
// Kjør dette bare når et selskap har lagt om siden sin og tolkeren er rettet. Da må også
// forventede tall i test/tolkere.test.js oppdateres, siden de gjelder øyeblikksbildet.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hent, tilTekst } from './lib/hent.js';

const UT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'test', 'fixtures');

const SIDER = {
  'ferde-bergen': 'https://ferde.no/bomanlegg-og-priser/bypakke-bergen',
  'ferde-nord-jaeren': 'https://ferde.no/bomanlegg-og-priser/nord-jaeren',
  'ferde-ryfast': 'https://ferde.no/bomanlegg-og-priser/ryfast',
  'ferde-kristiansand': 'https://ferde.no/bomanlegg-og-priser/kristiansand',
  'vegamot-trondheim': 'https://www.vegamot.no/takster-og-bomstasjoner/miljopakken-trondheim/',
  'vegamot-alesund': 'https://www.vegamot.no/takster-og-bomstasjoner/bypakke-alesund/',
  'bpsnord-bodo': 'https://bpsnord.no/prosjekter/bypakke-bodo/',
  'bpsnord-tromso': 'https://bpsnord.no/bypakke-tenk-tromso/',
  fjellinjen: 'https://www.fjellinjen.no/privat/priser/',
};

await fs.mkdir(UT, { recursive: true });
for (const [navn, url] of Object.entries(SIDER)) {
  // Tolkerne arbeider på «celle|celle»-tekst, så det er nok å lagre den (noen få kB per side).
  const tekst = tilTekst(await hent(url));
  await fs.writeFile(path.join(UT, `${navn}.txt`), `Kilde: ${url}\nHentet: ${new Date().toISOString().slice(0, 10)}\n${tekst}\n`);
  console.log(`${navn}.txt  ${tekst.length} tegn`);
}

// Vegfinans leverer strukturerte data i __NEXT_DATA__. Vi lagrer bare feltene tolkeren bruker.
const vf = await hent('https://www.vegfinans.no/bompengeprosjekter/vegfinans-bypakke-grenland-as');
const d = JSON.parse(vf.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/)[1]).props.pageProps.data;
const lite = { props: { pageProps: { data: { name: d.name, status: d.status, tollStations: d.tollStations.map(({ _id, name, tg1, tg1ZeroEmission, tg2, tg2ZeroEmission }) => ({ _id, name, tg1, tg1ZeroEmission, tg2, tg2ZeroEmission })), feeInfoItems: d.feeInfoItems } } } };
await fs.writeFile(path.join(UT, 'vegfinans-grenland.html'), `<!-- Kilde: https://www.vegfinans.no/bompengeprosjekter/vegfinans-bypakke-grenland-as, hentet ${new Date().toISOString().slice(0, 10)} -->\n<script id="__NEXT_DATA__" type="application/json">${JSON.stringify(lite)}</script>\n`);
console.log('vegfinans-grenland.html');
