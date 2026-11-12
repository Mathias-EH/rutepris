# Prisdata

Prisdataene ligger i `data/` og leses ved oppstart. Datoen de sist ble oppdatert, vises på nettsiden.

## Oppdatere dataene

```bash
npm run oppdater-data
```

Scriptet skriver `data/bomstasjoner.json`, `data/ferjer.json`, `data/utland.json` og stedsregistrene på nytt. Start serveren på nytt etterpå.

- `node scripts/oppdater-data.js --frisk` henter også veggeometrien på nytt (ca. 450 kall mot NVDB). Brukes når bommer har flyttet på seg.
- `node scripts/oppdater-data.js --vis-usikre` lister alle bommer som er merket «pris usikker», med begrunnelse.

Scriptet skriver én linje per kilde. `FEIL` betyr at en takstside ikke lot seg lese. Da brukes NVDB-taksten, og bommene i prosjektet merkes som usikre i stedet for at noe gjettes.

Etter hver kjøring listes hva som er endret siden forrige (nye og fjernede bommer, prisendringer). De siste 30 endringsrapportene ligger i `data/endringslogg.json`.

### Automatisk oppdatering

Serveren oppdaterer dataene selv når de er eldre enn 7 dager: scriptet kjøres i bakgrunnen, og de nye prisene lastes inn uten omstart. `AUTO_OPPDATER_DAGER` endrer intervallet (0 slår det av). På verter der disken nullstilles ved omstart, varer en slik oppdatering bare til neste omstart.

## Kilder

| Kilde | Gir |
|---|---|
| [NVDB API Les v4](https://nvdbapiles.atlas.vegvesen.no), vegobjekttype 45 «Bomstasjon» | Posisjon, navn, innkrevingsretning, takst liten/stor bil, rushtid, timesregel og timesregel-gruppe |
| NVDB vegnett | Kjøreretningen på veien der bommen står |
| Fjellinjen, Ferde, Vegamot, Vegfinans, BPS Nord | Elbiltakst, takst per drivstoff, ferske takster, rushtidsregler |
| autopassferje.no (Statens vegvesen) | Ferjepriser |
| Entur | Posisjon for ferjekaier |
| OpenStreetMap (Overpass) | Betalstasjoner og vegferjer i Sverige, stedsregistre |

autopass.no har ingen egen stasjonsoversikt og lenker selv til NVDB. Bompengeprosjektene kobles mot NVDB på `Operatør_Id`, og stasjoner på `Bomstasjon_Id` der selskapet oppgir stasjonsnummer. Koblingen ligger i `scripts/lib/kilder.js`, og tolkerne for hvert selskap i `scripts/lib/selskaper.js`.

Der NVDB og selskapet er uenige om taksten, brukes selskapets. Det gjelder blant annet Oslo, der NVDB oppgir dieseltaksten som «liten bil».

Samband utenfor AutoPASS-regulativet legges inn for hånd i `EKSTRA_SAMBAND` i `scripts/lib/ferjer.js` (Moss–Horten), og takstene for Sverige og Danmark i `scripts/lib/utland.js`.

## Tester for tolkerne

`test/tolkere.test.js` kjører tolkerne mot øyeblikksbilder av selskapenes sider i `test/fixtures/`. Når et selskap legger om siden sin og tolkeren er rettet, fornyes bildene med `node scripts/lag-testdata.js`. Da må også forventede tall i testen oppdateres.

## Dataformat

Hver stasjon i `data/bomstasjoner.json` har:

- `id` (NVDB), `navn`, `lat`, `lon`, `type` (`autopass` eller `privat`)
- `retning` (`en` eller `begge`) og `belastesKurs` (kjøreretningen som belastes, i grader)
- `prosjekt`, `prosjektNavn`, `selskap`
- `takster` for `bensin`, `diesel`, `elbil` og `tung` (takstgruppe 2), hver med `full`, `avtale`, `rushFull`, `rushAvtale`
- `elbilProsentAvAvtalepris` og `elbiltakstUtenAvtale`
- `rush` (klokkeslett, ukedager, unntak for helligdager og juli)
- `timesregel` (`aktiv`, `minutter`, `gruppe`, `regel`, `kreverAvtale`)
- `maanedstak` (kun til informasjon, brukes ikke i beregningen)
- `prisUsikker`, `usikkerGrunner`, `merknader`
- `kilder` (URL-er) og `sistVerifisert`
