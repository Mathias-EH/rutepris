<p align="center">
  <img src="public/logo.svg" width="88" alt="Rutepris">
</p>

<h1 align="center">Rutepris</h1>

<p align="center">
  <strong>Hva koster turen?</strong><br>
  Bompenger, ferje og energi i én sum, for bilruter i Norge, Sverige og Danmark.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/lisens-MIT-534AB7" alt="Lisens: MIT">
  <img src="https://img.shields.io/badge/node-%E2%89%A5%2020-534AB7" alt="Node 20 eller nyere">
  <img src="https://img.shields.io/badge/avhengigheter-0-534AB7" alt="Ingen avhengigheter">
</p>

---

Rutepris er en nettside som regner ut hva en biltur faktisk koster. Den finner inntil tre ruter mellom to steder (raskeste, kompromiss og billigste) og sammenligner dem på tid, avstand, bompenger, ferje og energikostnad, med kart og lenker til Google Maps og Apple Maps.

## Funksjoner

- **Bompenger etter gjeldende regler:** rushtid, timesregel, enveisbommer, brikkerabatt og elbilsatser per bompengeprosjekt.
- **Ferje:** billettpris for bil, ventetid til neste avgang og råd om når det lønner seg å dra.
- **Energi:** strøm eller drivstoff for turen. Elbil regnes med spotpris hjemme og hurtiglading på lange turer.
- **Tre rutevalg:** raskeste, billigste og et kompromiss som sparer omtrent halvparten av forskjellen.
- **Tur/retur:** begge retninger prises samlet, slik at timesregelen kan gjøre returen gratis.
- **Sverige og Danmark:** trängselskatt i Stockholm og Göteborg, broavgifter, Storebælt og Øresund, omregnet med dagens kurs.
- **Bilen din:** oppslag på registreringsnummer gir biltype og forbruk. Uten oppslag velges biltype.
- **Norsk og engelsk**, lyst og mørkt tema, og tilpasset mobil.

Ukjente priser vises som «ukjent» og holdes utenfor summen. Ingenting anslås.

## Kom i gang

Krever [Node.js](https://nodejs.org) 20 eller nyere. Prosjektet har ingen avhengigheter, så `npm install` trengs ikke.

```bash
npm start
```

Åpne deretter http://localhost:3000.

```bash
npm test
```

kjører enhetstestene for prisberegning, bomtreff, rutevalg, kartlenker og datakontroll.

## Konfigurasjon

Alt er valgfritt. Kopier `.env.example` til `.env` for å endre noe.

| Variabel | Betydning |
|---|---|
| `PORT` | Port for nettsiden (standard 3000) |
| `SVV_API_KEY` | Nøkkel til Statens vegvesens kjøretøyregister. Slår på oppslag på registreringsnummer |
| `AUTO_OPPDATER_DAGER` | Hvor gamle prisdataene kan bli før serveren oppdaterer dem selv (standard 7, 0 slår det av) |
| `ORS_API_KEY` | Nøkkel til OpenRouteService. Når den er satt, brukes ORS i stedet for Valhalla |
| `RUTETJENESTE` | Tving `valhalla` eller `ors` |
| `VALHALLA_URL` | Egen Valhalla-server (standard er den åpne `valhalla1.openstreetmap.de`) |
| `VALHALLA_MAKS_POLYGONER`, `VALHALLA_MAKS_PUNKTER` | Grenser per kall mot egen Valhalla |

API-nøkler ligger bare på serveren. Nettleseren snakker kun med `/api/…` på samme adresse.

## Slik virker det

```
Nettleser (public/)  ──►  server.js  ──►  rutetjeneste (Valhalla / OpenRouteService)
  kart, skjema,            /api/…          stedssøk (Kartverket, Entur)
  rutekort                                 ferjetider (Entur), strømpriser, valutakurs
                              │            kjøretøyregisteret (Statens vegvesen)
                              ▼
                           data/  bomstasjoner, ferjepriser, Sverige og Danmark
```

1. Serveren henter ruteforslag fra rutetjenesten.
2. Hver rute legges mot bomstasjonene i `data/`, og passeringene prises for tidspunktet bilen er framme ved bommen.
3. Billigere alternativer finnes ved å sperre bommene som koster penger og beregne ruta på nytt.
4. Ferjepris, ventetid og energikostnad legges til, og rutene rangeres.

Prisdataene lages av `npm run oppdater-data`, som henter bomstasjoner fra NVDB og takster fra bompengeselskapene. Serveren kjører oppdateringen selv når dataene er eldre enn en uke.

## Dokumentasjon

| Dokument | Innhold |
|---|---|
| [docs/beregning.md](docs/beregning.md) | Prisregler, energi og forbruk, rutevalg, Sverige og Danmark, kartlenker |
| [docs/data.md](docs/data.md) | Oppdatering av prisdata, kilder og dataformat |
| [docs/begrensninger.md](docs/begrensninger.md) | Kjente begrensninger og hva som ikke er modellert |

## Drift

Rutepris er én Node-prosess uten avhengigheter (`node server.js`, port fra `PORT`). Den trenger en vert som kan kjøre en prosess, gjøre utgående nettkall og holde på hemmeligheten `SVV_API_KEY`. Rene statiske verter holder ikke.

`render.yaml` er en ferdig oppskrift for [Render](https://render.com): opprett en Blueprint fra repoet og legg inn `SVV_API_KEY` under Environment. Disken hos slike verter nullstilles gjerne ved omstart, så datafilene i repoet er de som gjelder.

Standardoppsettet bruker åpne tjenester som er ment for begrenset bruk: Valhalla-serveren til FOSSGIS og kartflisene fra openstreetmap.org. Ved mye trafikk bør du sette opp egen Valhalla (`VALHALLA_URL`) og bruke en kartflisleverandør med avtale.

## Prosjektstruktur

```
server.js            backend: nettside og API
src/                 prisberegning, rutevalg, ferje, strøm, stedssøk, kartlenker
scripts/             henter og bygger prisdataene
data/                bomstasjoner, ferjepriser, Sverige og Danmark, stedsregistre
public/              frontend (HTML, CSS, JavaScript, Leaflet)
test/                enhetstester
docs/                dokumentasjon
```

Kode, kommentarer og dokumentasjon er på norsk. Enkelte interne navn (lagringsnøkler i nettleseren og klientnavn mot API-er) bruker det tidligere arbeidsnavnet «bomruta».

## Bidra

Feilmeldinger og forslag tas imot som issues, og endringer som pull requests. Kjør `npm test` før du sender inn. Prisfeil er lettest å rette når du oppgir rute, avreisetid, biltype og hva som er riktig pris, med kilde.

## Lisens

Koden er lisensiert under [MIT-lisensen](LICENSE).

Lisensen gjelder koden, ikke dataene. Datafilene i `data/` er satt sammen fra åpne kilder med egne vilkår, og de følger med når filene brukes eller deles:

| Fil | Kilde | Vilkår |
|---|---|---|
| `data/bomstasjoner.json` | Statens vegvesen (NVDB) og bompengeselskapenes takstsider | [NLOD](https://data.norge.no/nlod/no/2.0) for NVDB-dataene |
| `data/ferjer.json` | Statens vegvesen (autopassferje.no), kaiposisjoner fra Entur | [NLOD](https://data.norge.no/nlod/no/2.0) |
| `data/utland.json` | © OpenStreetMap-bidragsytere (posisjoner), Transportstyrelsen, Storebælt og Øresundsbron (takster), Norges Bank (kurs) | [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/) for OpenStreetMap-dataene |
| `data/steder-norge.json`, `data/steder-utland.json` | © OpenStreetMap-bidragsytere | [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/) |

Nettsiden henter i tillegg data mens den kjører: kart fra OpenStreetMap, ruter fra Valhalla, stedsnavn fra Kartverket (CC BY 4.0) og Entur, ferjetider fra Entur, strømpriser fra hvakosterstrommen.no, elprisetjustnu.se og elprisenligenu.dk, valutakurs fra Norges Bank og kjøretøydata fra Statens vegvesen. Kartet tegnes med [Leaflet](https://leafletjs.com) (BSD 2-Clause).

Rutepris er et uavhengig prosjekt og er ikke tilknyttet Statens vegvesen, AutoPASS eller bompengeselskapene. Prisene er beregnet og kan avvike fra det som faktureres.
