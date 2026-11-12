// Tur/retur: setter sammen to ruteplaner (ut og hjem) og priser dem samlet.
// Bompengene må prises under ett, fordi timesregelen kan gjøre en passering på returen
// gratis når den skjer innen timen etter en passering på utreisen.

import { beregnBompenger, energiberegning, energikostnad, forbrukFor } from './pris.js';
import { prisFerjer } from './ferje.js';

const kr = (x) => Math.round(x * 100) / 100;

/**
 * @param ut    resultat fra planleggRuter for utreisen
 * @param hjem  resultat fra planleggRuter for hjemreisen – eller en funksjon (utrute) => plan når
 *              returen starter ved ankomst og derfor har ulikt tidspunkt for hvert alternativ.
 *              En slik plan har feltet `avreise` (veggklokke-Date) for returen.
 * @param m     { stasjoner, ferjer, kjoretoy, forbruk, avreise, retur }
 */
export function kombinerTurRetur(ut, hjem, m) {
  const stasjon = new Map(m.stasjoner.map((s) => [s.id, s]));
  const finn = (plan, id) => plan.ruter.find((r) => r.id === id);
  const billigst = (plan) => finn(plan, 'billigste') || finn(plan, 'raskeste');
  const hjemFor = typeof hjem === 'function' ? hjem : () => hjem;

  // Samme rutetype begge veier. Mangler den ene retningen et alternativ, brukes det nærmeste.
  const uRask = finn(ut, 'raskeste'), uMellom = finn(ut, 'kompromiss') || billigst(ut), uBillig = billigst(ut);
  const hRask = hjemFor(uRask), hMellom = hjemFor(uMellom), hBillig = hjemFor(uBillig);
  const par = [{ id: 'raskeste', tittel: 'Raskeste', u: uRask, h: finn(hRask, 'raskeste'), plan: hRask }];
  if (finn(ut, 'kompromiss') || finn(hMellom, 'kompromiss')) par.push({ id: 'kompromiss', tittel: 'Kompromiss', u: uMellom, h: finn(hMellom, 'kompromiss') || billigst(hMellom), plan: hMellom });
  if (finn(ut, 'billigste') || finn(hBillig, 'billigste')) par.push({ id: 'billigste', tittel: 'Billigste', u: uBillig, h: billigst(hBillig), plan: hBillig });

  const ruter = par.map(({ id, tittel, u, h, plan }) => {
    const returTid = plan.avreise || m.retur;
    const passeringer = [
      ...u.passeringer.map((p) => ({ stasjon: stasjon.get(p.id), tid: new Date(p.tid), etappe: 'tur' })),
      ...h.passeringer.map((p) => ({ stasjon: stasjon.get(p.id), tid: new Date(p.tid), etappe: 'retur' })),
    ].sort((a, b) => a.tid - b.tid);
    const pris = beregnBompenger(passeringer, m.kjoretoy);
    pris.linjer.forEach((l, i) => { l.etappe = passeringer[i].etappe; });

    // Kartmarkørene skal vise samme status som den samlede utregningen
    const medStatus = (etappe, navn) => {
      const linjer = pris.linjer.filter((l) => l.etappe === navn);
      let i = 0;
      return { ...etappe, navn: navn === 'tur' ? 'Tur' : 'Retur', markører: etappe.markører.map((mk) => {
        if (mk.status === 'unngaatt') return mk;
        const l = linjer[i++];
        return l ? { ...mk, status: l.status, pris: l.pris, ordinarPris: l.ordinarPris, tid: l.tid, rush: l.rush } : mk;
      }) };
    };

    const km = Math.round((u.km + h.km) * 10) / 10;
    const energi = energiberegning(km, m.kjoretoy.drivstoff, m.forbruk, m.avreise);
    const ferjekostnad = kr(u.ferjekostnad + h.ferjekostnad);
    let bensinbil = null;
    if (m.kjoretoy.drivstoff === 'elbil') {
      const somBensin = { drivstoff: 'bensin', avtale: m.kjoretoy.avtale };
      bensinbil = {
        bompenger: beregnBompenger(passeringer, somBensin).total,
        ferjekostnad: kr(prisFerjer(u.ruteFerjer, m.ferjer, somBensin, m.avreise).total + prisFerjer(h.ruteFerjer, m.ferjer, somBensin, returTid).total),
        energikostnad: energikostnad(km, 'bensin', {}, m.avreise),
      };
    }
    const sett = new Set();
    return {
      id, tittel, km,
      sekunder: u.sekunder + h.sekunder,
      returAvreise: returTid.toISOString().slice(0, 16), // når returen starter (veggklokke)
      bompenger: pris,
      ferjer: [...u.ferjer.map((f) => ({ ...f, etappe: 'tur' })), ...h.ferjer.map((f) => ({ ...f, etappe: 'retur' }))],
      ferjekostnad,
      ferjeUkjent: u.ferjeUkjent || h.ferjeUkjent,
      energi,
      energikostnad: energi.kostnad,
      totalkostnad: kr(pris.total + ferjekostnad + energi.kostnad),
      bensinbil,
      avreiseråd: null,
      ventSekunder: (u.ventSekunder || 0) + (h.ventSekunder || 0),
      ferjeråd: u.ferjeråd || null, // gjelder avreisen på turen; returen følger etter
      ikkeUnngått: [...u.ikkeUnngått, ...h.ikkeUnngått].filter((x) => !sett.has(x.stasjonId) && sett.add(x.stasjonId)),
      etapper: [medStatus(u.etapper[0], 'tur'), medStatus(h.etapper[0], 'retur')],
    };
  });

  const rask = ruter[0];
  for (const r of ruter) {
    r.ekstraSekunder = r.sekunder - rask.sekunder;
    r.ekstraKm = Math.round((r.km - rask.km) * 10) / 10;
    r.spartBompenger = kr(rask.bompenger.total - r.bompenger.total);
  }
  // To alternativer som er helt like (ingen billigere vei i noen retning) vises bare én gang
  const unike = ruter.filter((r, i) => !ruter.slice(0, i).some((x) => x.km === r.km && x.sekunder === r.sekunder && x.bompenger.total === r.bompenger.total && x.ferjekostnad === r.ferjekostnad));
  return {
    ruter: unike,
    turRetur: true,
    forbruk: forbrukFor(m.kjoretoy.drivstoff, m.forbruk, m.avreise),
    anbefalt: [...unike].sort((a, b) => a.totalkostnad - b.totalkostnad || a.sekunder - b.sekunder)[0].id,
    melding: unike.length === 1 ? (rask.bompenger.total + rask.ferjekostnad === 0 ? 'Ingen bompenger på raskeste rute.' : 'Fant ingen billigere rute.') : null,
    rutekall: ut.rutekall + [...new Set(par.map((p) => p.plan))].reduce((sum, p) => sum + p.rutekall, 0),
    leverandor: ut.leverandor,
  };
}
