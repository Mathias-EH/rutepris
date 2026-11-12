# Slik beregnes prisen

Dette dokumentet beskriver reglene Rutepris regner etter. Kjente avvik står i [begrensninger.md](begrensninger.md).

## Bompenger

Logikken ligger i `src/pris.js` og er dekket av `test/pris.test.js`.

- **Standard** er elbil med AutoPASS-avtale. Alternativene er bensin, diesel, ladbar hybrid, tungt kjøretøy og «uten brikke».
- **Brikkerabatt:** 20 % for takstgruppe 1 med avtale ([autopass.no](https://www.autopass.no/no/kunde/takster-og-rabatter/)).
- **Elbil:** en prosentandel av ordinær avtalepris, hentet per bompengeprosjekt. Den er 70 % de fleste steder, 50 % i noen prosjekter og 0 % i noen (blant annet Hålogalandsbrua og E6 Helgeland). I Oslo, Bergen og Kristiansand har elbil egen takst som også gjelder uten avtale. Ellers betaler elbil uten avtale full pris. Der prosjektets sats ikke er verifisert, vises elbilprisen som «ukjent».
- **Ladbar hybrid** belastes som bensinbil.
- **Rushtid:** hver bom prises etter estimert passeringstid (avreise pluss kjøretid fram til bommen), med ukedag, norske helligdager og Oslos juli-unntak.
- **Timesregel:** innenfor samme timesregel-gruppe betales bare én passering i vinduet fra første passering. Den dyreste belastes, unntatt der selskapet sier at første passering bestemmer prisen (Tromsø). Regelen gjelder aldri på tvers av grupper.
- **Retning:** enveisbommer belastes bare når kjøreretningen stemmer med innkrevingsretningen.
- **Usikker pris:** bommer uten kjent takst vises som «ukjent» og holdes utenfor summen, med varsel på rutekortet.
- **Råd om avreisetid:** samme rute prises for avreise opptil 90 minutter før og etter. Sparer det minst 1 kr, vises det nærmeste tidspunktet som gir størst besparelse.

## Ferje

- **Pris** (`src/ferje.js`): kjøretøy inntil 6 m, fra Statens vegvesens prismodul på autopassferje.no. Med brikke brukes prisen for AutoPASS-brikke (10 % rabatt); prisen med forskuddsavtale (50 %) står i utregningen. Elbil får nullutslippstakst. Ferjer prises for seg og regnes ikke som bom.
- **Ferjetider** (`src/ferjetid.js`): for rutene som vises, slås neste avgang opp hos Entur. Ventetid og faktisk overfartstid legges til kjøretiden, og bommer etter ferja prises på det nye tidspunktet.
- **Råd om avreise:** er ventetiden på første ferje 15 minutter eller mer, foreslår rutekortet hvor mye senere turen kan starte og likevel rekke samme avgang.

## Energi

Energikostnaden er kilometer × forbruk × pris.

### Forbruk

Med registreringsnummer brukes bilens typegodkjente forbruk (WLTP), regnet om til forbruk på veien (`FORBRUKSFAKTOR` i `src/pris.js`):

| Kjøretøy | Omregning | Grunnlag |
|---|---|---|
| Elbil, november–mars | WLTP × 1,22 | NAF El Prix vinter 2025: 18 % kortere rekkevidde enn WLTP ved −6 til +8 °C |
| Elbil, april–oktober | WLTP × 1,0 | NAF El Prix sommer 2025: bilene lå fra −13,7 % til +11,3 % mot WLTP |
| Bensin og diesel | WLTP × 1,14 | ICCT 2024: 14 % høyere forbruk på veien |
| Ladbar hybrid | 4,2 l/100 km | ICCT: 4,0–4,4 l/100 km for privateide biler, uansett WLTP-tall |

Dette er gjennomsnittstall. I streng kulde bruker elbiler mer (NAF målte 38 % kortere rekkevidde ved −7 til −32 °C i 2026).

Uten registreringsnummer velges biltype, og da brukes gjennomsnittstall for forbruk på veien (`STANDARD_FORBRUK` i `src/pris.js`):

| Biltype | Forbruk | Pris | Grunnlag |
|---|---|---|---|
| Elbil | 19 kWh/100 km i årssnitt: 17,4 om sommeren, 21,2 om vinteren. Rekkevidde 448 km om sommeren | spotpris | NAFs tall for ladekostnad, fordelt med vinterfaktoren over |
| Bensin | 7,4 l/100 km | 25 kr/l | Statens vegvesens snitt for de mest solgte bilene, pluss 14 % (ICCT) |
| Diesel | 6,2 l/100 km | 27,50 kr/l | Samme regnemåte. Pris: SSBs månedssnitt for september 2026 (27,52 kr) |
| Ladbar hybrid | 4,2 l/100 km | 25 kr/l | ICCT |
| Tungt kjøretøy | 30 l/100 km | 27,50 kr/l | |

Forbruk og drivstoffpris kan justeres med glidebrytere i rutekortet for bensin, diesel og hybrid. Elbil har glidebryter for hurtigladepris når turen krever lading underveis. Verdiene huskes i nettleseren.

### Strøm for elbil

`src/strom.js`. Hjemmelading prises med spotprisen for startstedets prisområde på avreisedagen, etter strømstøtte, pluss nettleie. På lange turer regnes de første 80 % av bilens rekkevidde som hjemmeladet og resten som hurtiglading.

| Størrelse | Verdi | Kilde |
|---|---|---|
| Spotpris per time | hentes per prisområde | hvakosterstrommen.no |
| Strømstøtte 2026 | 90 % av prisen over 77 øre/kWh uten mva, time for time | regjeringen.no |
| Norgespris | 50 øre/kWh med mva (40 øre i Nord-Norge), ut 2026 | regjeringen.no / NVE |
| Nettleie og avgifter | 34 øre/kWh med mva (27 øre i Nord-Norge) | NVE-snitt 18,87 øre + elavgift 7,13 + Enova 1,0 |
| Hurtiglading | 5,90 kr/kWh | listepriser hos Circle K, Recharge og Kople |

Spotprisen er døgnsnittet etter strømstøtte. Prisområdet bestemmes omtrentlig ut fra startstedet. Norgespris brukes bare som reserve når spotprisen ikke er tilgjengelig.

For elbil viser rutekortet også besparelsen mot å kjøre samme tur med bensinbil.

## Kjøretøy og registreringsnummer

Med `SVV_API_KEY` satt kan brukeren oppgi registreringsnummer. Serveren slår opp bilen hos Statens vegvesen og finner kjøretøytype, WLTP-forbruk og rekkevidde (`src/kjoretoy.js`). Bilen huskes i nettleseren (`localStorage`), ikke på serveren. Biltype kan alltid velges uten registreringsnummer.

Nøkkelen bestilles hos [Statens vegvesen](https://www.vegvesen.no/dinside/data-og-api-er/tilgang-til-api-for-kjoretoyopplysninger/) («API for tekniske kjøretøyopplysninger») og legges i `.env` som `SVV_API_KEY`, uten «Apikey » foran. Tjenesten tillater 50 000 oppslag per nøkkel per døgn, gir ikke eieropplysninger og gjelder bare norskregistrerte biler. Se [Vegvesenets dokumentasjon](https://autosys-kjoretoy-api.atlas.vegvesen.no/api-ui/index-enkeltoppslag.html).

## Tur/retur

`src/turretur.js`. Hver retning planlegges for seg, men bompengene prises samlet, slik at timesregelen kan gjøre returen gratis. Returen starter rett etter ankomst, og hjemreisen planlegges fra ankomsttiden til hvert alternativ.

## Slik velges rutene

`src/ruteplan.js`, testet i `test/ruteplan.test.js`.

1. **Raskeste** beregnes uten begrensninger, og bommene langs ruta prises.
2. **Billigste:** først en rute der rutetjenesten unngår veier merket som bomvei i OpenStreetMap. Den prises med Rutepris' egne data. Bommer som fortsatt koster penger sperres med små polygoner (ca. 24 × 14 m rundt kjørebanen), og nabobommene i samme bomring sperres med unngå-punkter, før ruta beregnes på nytt.
3. **Kompromiss:** skal spare omtrent halvparten av forskjellen mellom raskeste og billigste. Akkurat så mange av bommene på raskeste rute unngås at halve besparelsen dekkes (én gang med de dyreste først, én gang med de billigste først), og i tillegg prøves «myk» bomunngåelse i Valhalla. Kandidaten nærmest 50 % velges, og bare hvis den sparer mellom 30 og 70 % og er raskere enn den billigste. Finnes ingen slik rute, vises ikke noe kompromiss.

**Ferjer.** Går rutetjenestens raskeste rute med ferje, er det den som blir «Raskeste», slik navigasjonsappene også regner. Veien uten ferje beregnes i tillegg og kan bli kompromiss eller billigste, siden den sparer ferjebilletten. Ferja velges bare bort når veien er raskere selv uten ventetid. Kjøretiden i kortet har ventetiden på kaia med. Med bryteren «Ferjer» slått av legges alle ruter utenom ferjer der det finnes vei.

Ruter som tar mer enn dobbelt så lang tid som den raskeste, forkastes. En bomring unngås ikke når start eller mål ligger innenfor den, og utregningen forklarer hvorfor hver gjenværende bom ikke ble unngått.

Bare bilprofil brukes (`auto`, eller `truck` for tungt kjøretøy), så ruta går ikke på gang- og sykkelveier eller veier stengt for motortrafikk.

## Sverige og Danmark

Ruter kan starte, slutte og gå gjennom Sverige og Danmark. Dataene ligger i `data/utland.json` og lages av `scripts/lib/utland.js` som en del av `npm run oppdater-data`.

| Hva | Dekning | Kilde |
|---|---|---|
| Trängselskatt Stockholm | 60 portaler, beløp etter klokkeslett og sesong, dagstak 135/105 SEK | Transportstyrelsen (takster), OpenStreetMap (posisjoner) |
| Trängselskatt Göteborg | 72 portaler, beløp etter klokkeslett, flerpassasjeregel (60 min), dagstak 60 SEK | Transportstyrelsen, OpenStreetMap |
| Broavgift Motala, Sundsvall, Skuru | 5, 9 og 4 SEK for personbil | Transportstyrelsen, OpenStreetMap |
| Storebæltsbroen | 235 DKK, 205 DKK med brikke eller skiltgjenkjenning | storebaelt.dk |
| Øresundsbron | 470 DKK (normalpris i betalingsanlegget) | oresundsbron.com |
| Vegferjer i Sverige | 44 ferjelinjer fra Trafikverket Färjerederiet, gratis | OpenStreetMap, trafikverket.se |
| Valutakurs | siste kurs for SEK og DKK, hentet ved oppstart og deretter én gang i døgnet (`src/valuta.js`) | Norges Bank |
| Stedssøk | byer, tettsteder og landsbyer (lokalt register), pluss stasjoner, flyplasser og ferjekaier | OpenStreetMap, Entur, med Photon som reserve for adresser |
| Strømpris | spotpris for SE1–SE4 og DK1–DK2 | elprisetjustnu.se, elprisenligenu.dk |

Regler som er lagt inn (`src/pris.js`, testet i `test/tur.test.js`):

- **Fridager:** ingen trängselskatt lørdag, søndag og helgdager. Göteborg har i tillegg fri dagen før helgdag og hele juli. Stockholm har fri trettondagsafton, midsommarafton, julaften og nyttårsaften, og i juli unntatt de fem første hverdagene. Reglene er kontrollert mot Transportstyrelsens datolister for 2026.
- **Ingen rabatter:** trängselskatten er lik for alle kjøretøy. AutoPASS-brikke og elbil gir ikke lavere pris i Sverige eller på Øresundsbron.
- **Valuta:** beløpene regnes om til kroner med Norges Banks siste kurs. Serveren henter den hver dag og regner om alle utenlandske takster uten omstart. Svarer ikke Norges Bank, beholdes forrige kurs. Beløpet i SEK eller DKK står i utregningen.

Takstene er lagt inn for hånd og må kontrolleres når året skifter. Posisjonene hentes ved dataoppdatering.

## Stedssøk

`src/geokoding.js`. Norske steder og adresser slås opp hos Kartverket og Entur. Søk på områder og naturnavn (dalfører, fjell, innsjøer) gir nærmeste by eller tettsted. Sverige og Danmark har et lokalt register (`data/steder-utland.json`) som tåler norsk skrivemåte («Gøteborg», «Århus»). Norske steder vises først når de passer like godt. Koordinater kan alltid skrives direkte (`57.7089, 11.9746`).

## Kartlenker

`src/lenker.js`.

- **Google Maps:** `https://www.google.com/maps/dir/?api=1&origin=…&destination=…&waypoints=…&travelmode=driving`, med inntil 9 via-punkter.
- **Apple Maps:** `https://maps.apple.com/directions?source=…&destination=…&waypoint=…&mode=driving`, med ett `waypoint` per via-punkt.

Via-punktene legges på ferjekaiene der ruta går om bord, der ruta avviker fra den raskeste, og som støttepunkter på lange ruter (ett per 60 km, høyst fire). Appene regner ruta selv mellom punktene og viser dem som stopp.
