// Kontrollerer at data/bomstasjoner.json har forventet struktur etter en oppdatering.
// Sjekker form og rimelighet – ikke konkrete priser, som endrer seg.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const data = JSON.parse(fs.readFileSync(new URL('../data/bomstasjoner.json', import.meta.url), 'utf8'));

test('datafila har dato, statistikk og et rimelig antall bomstasjoner', () => {
  assert.match(data.priserSistOppdatert, /^\d{4}-\d\d-\d\d$/);
  assert.ok(data.stasjoner.length > 350, `bare ${data.stasjoner.length} stasjoner`);
  assert.equal(data.statistikk.stasjoner, data.stasjoner.length);
  assert.equal(new Set(data.stasjoner.map((s) => s.id)).size, data.stasjoner.length, 'id-er skal være unike');
});

test('hver stasjon har posisjon i Norge, retning, timesregel og kilde', () => {
  for (const s of data.stasjoner) {
    assert.ok(s.lat > 57 && s.lat < 72 && s.lon > 4 && s.lon < 32, `${s.navn}: posisjon ${s.lat},${s.lon}`);
    assert.ok(['en', 'begge'].includes(s.retning), `${s.navn}: retning`);
    if (s.retning === 'en') assert.ok(s.belastesKurs >= 0 && s.belastesKurs < 360, `${s.navn}: enveisbom uten kurs`);
    assert.equal(typeof s.timesregel.aktiv, 'boolean');
    if (s.timesregel.aktiv) assert.ok(s.timesregel.minutter > 0 && s.timesregel.gruppe && ['dyreste', 'forste'].includes(s.timesregel.regel), `${s.navn}: timesregel`);
    assert.ok(s.kilder.length >= 1 && s.kilder.every((k) => k.startsWith('https://')));
    assert.equal(s.prisUsikker, s.usikkerGrunner.length > 0, `${s.navn}: usikker-flagg uten begrunnelse`);
  }
});

test('takster er komplette og rimelige: avtale <= full, elbil <= bensin', () => {
  for (const s of data.stasjoner) {
    if (!s.takster) { assert.ok(s.prisUsikker, `${s.navn}: mangler takst uten å være merket usikker`); continue; }
    for (const g of ['bensin', 'diesel', 'elbil']) {
      const t = s.takster[g];
      if (g === 'elbil' && t == null) { assert.ok(s.prisUsikker, `${s.navn}: ukjent elbilpris uten å være merket usikker`); continue; }
      assert.ok(t && t.full >= 0 && t.avtale >= 0 && t.avtale <= t.full, `${s.navn}: ${g} ${JSON.stringify(t)}`);
      if (t.rushFull != null) assert.ok(t.rushFull >= t.full && t.rushAvtale <= t.rushFull, `${s.navn}: rush ${g}`);
    }
    if (s.takster.elbil) assert.ok(s.takster.elbil.avtale <= s.takster.bensin.avtale, `${s.navn}: elbil dyrere enn bensin`);
    assert.ok(s.takster.diesel.full >= s.takster.bensin.full, `${s.navn}: diesel billigere enn bensin`);
    if (s.rush) assert.ok(s.rush.vinduer.length && s.rush.vinduer.every(([a, b]) => /^\d\d:\d\d$/.test(a) && /^\d\d:\d\d$/.test(b) && a < b), `${s.navn}: rushvinduer`);
  }
});

test('de store bypakkene er med og koblet til selskapskilde', () => {
  for (const prosjekt of ['oslo', 'bergen', 'trondheim', 'nord-jaeren', 'kristiansand', 'tromso']) {
    const st = data.stasjoner.filter((s) => s.prosjekt === prosjekt);
    assert.ok(st.length >= 10, `${prosjekt}: ${st.length} stasjoner`);
    assert.ok(st.filter((s) => s.sistVerifisert).length / st.length > 0.8, `${prosjekt}: få verifiserte`);
  }
});
