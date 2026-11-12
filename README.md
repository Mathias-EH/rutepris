# Rutepris

*Hva koster turen? Bom, ferje og strøm i én sum.* (Het Bomruta tidligere; noen interne navn, som lagringsnøklene i nettleseren, heter fortsatt det.)

Merket ligger i `public/logo.svg`: lilla `#534AB7` med hvit rute og gul prikk `#FAC775`.

Nettside som beregner bompenger i Norge og finner den mest kostnadseffektive bilruten mellom to steder. Du får inntil tre alternativer – raskeste, kompromiss og billigste – sammenlignet på tid, avstand, antall bommer og pris, med kart og lenker til Google Maps og Apple Maps.

## Kom i gang

Krever [Node.js](https://nodejs.org) 20 eller nyere. Prosjektet har ingen andre avhengigheter, så det trengs ingen `npm install`.

```bash
npm start
```

Åpne deretter http://localhost:3000.

```bash
npm test
```

kjører enhetstestene (prisberegning, bomtreff, rutevalg, kartlenker og datakontroll).

### Innstillinger

Kopier `.env.example` til `.env` hvis du vil endre noe. Alt er valgfritt.

| Variabel | Betydning |
|---|---|
| `PORT` | Port for nettsiden (standard 3000) |
| `SVV_API_KEY` | Nøkkel til Statens vegvesens kjøretøyregister. Slår på oppslag på registreringsnummer (se under) |
| `ORS_API_KEY` | Nøkkel til OpenRouteService. Når den er satt, brukes ORS i stedet for Valhalla |
| `RUTETJENESTE` | Tving `valhalla` eller `ors` |
| `VALHALLA_URL` | Egen Valhalla-server (standard er den åpne `valhalla1.openstreetmap.de`) |
| `VALHALLA_MAKS_POLYGONER`, `VALHALLA_MAKS_PUNKTER` | Øk grensene hvis du kjører egen Valhalla |

API-nøkler ligger bare på serveren. Nettleseren snakker kun med `/api/…` på samme adresse.

## Oppdatere bomdataene

```bash
npm run oppdater-data
```

Scriptet skriver `data/bomstasjoner.json` på nytt og tar rundt et halvt minutt. Datoen vises i nettsiden som «Priser sist oppdatert». Start serveren på nytt etterpå, siden dataene leses ved oppstart.

- `node scripts/oppdater-data.js --frisk` henter også veggeometrien på nytt (ca. 450 kall mot NVDB). Bruk det når bommer har flyttet på seg.
- `node scripts/oppdater-data.js --vis-usikre` lister alle bommer som er merket «pris usikker», med begrunnelse.

Scriptet skriver én linje per kilde. `FEIL` betyr at en takstside ikke lot seg lese – da brukes NVDB-taksten, og bommene i prosjektet merkes som usikre i stedet for at noe gjettes.

Etter hver kjøring listes hva som er endret siden forrige (nye og fjernede bommer, prisendringer). De siste 30 endringsrapportene ligger i `data/endringslogg.json`.

### Automatisk oppdatering

Serveren oppdaterer dataene selv når de er eldre enn 7 dager: scriptet kjøres i bakgrunnen, og de nye prisene lastes inn uten omstart. Sett `AUTO_OPPDATER_DAGER` i `.env` for å endre intervallet (0 slår det av).

### Tester for tolkerne

`test/tolkere.test.js` kjører tolkerne mot øyeblikksbilder av selskapenes sider i `test/fixtures/`. Når et selskap legger om siden sin og tolkeren er rettet, fornyes bildene med `node scripts/lag-testdata.js` (da må også forventede tall i testen oppdateres).

### Kilder

| Kilde | Gir |
|---|---|
| [NVDB API Les v4](https://nvdbapiles.atlas.vegvesen.no), vegobjekttype 45 «Bomstasjon» | Posisjon, navn, innkrevingsretning, takst liten/stor bil, rushtid, timesregel og timesregel-gruppe |
| NVDB vegnett | Kjøreretningen på veien der bommen står |
| Fjellinjen, Ferde, Vegamot, Vegfinans, BPS Nord | Elbiltakst, takst per drivstoff, ferske takster, rushtidsregler |

autopass.no har ingen egen stasjonsoversikt og lenker selv til NVDB. Bompengeprosjektene kobles mot NVDB på `Operatør_Id`, og stasjoner på `Bomstasjon_Id` der selskapet oppgir stasjonsnummer. Koblingen ligger i `scripts/lib/kilder.js`, og tolkerne for hvert selskap i `scripts/lib/selskaper.js`.

Der NVDB og selskapet er uenige om taksten, brukes selskapets. Det gjelder blant annet Oslo, der NVDB oppgir dieseltaksten som «liten bil».

### Datafila

Hver stasjon i `data/bomstasjoner.json` har:

- `id` (NVDB), `navn`, `lat`, `lon`, `type` (`autopass` eller `privat`)
- `retning` (`en` eller `begge`) og `belastesKurs` (kjøreretningen som belastes, i grader)
- `prosjekt`, `prosjektNavn`, `selskap`
- `takster` for `bensin`, `diesel`, `elbil` og `tung` (takstgruppe 2), hver med `full`, `avtale`, `rushFull`, `rushAvtale`
- `elbilProsentAvAvtalepris` og `elbiltakstUtenAvtale`
- `rush` (klokkeslett, ukedager, unntak for helligdager og juli)
- `timesregel` (`aktiv`, `minutter`, `gruppe`, `regel`, `kreverAvtale`)
- `maanedstak` (kun til informasjon – brukes ikke i beregningen)
- `prisUsikker`, `usikkerGrunner`, `merknader`
- `kilder` (URL-er) og `sistVerifisert`

## Slik beregnes prisen

Logikken ligger i `src/pris.js` og er dekket av `test/pris.test.js`.

- **Standard** er elbil med AutoPASS-avtale. Du kan bytte til bensin, diesel, ladbar hybrid, tungt kjøretøy og «uten avtale».
- **Brikkerabatt:** 20 % for takstgruppe 1 med avtale ([autopass.no](https://www.autopass.no/no/kunde/takster-og-rabatter/)).
- **Elbil:** en prosentandel av ordinær avtalepris, hentet per bompengeprosjekt. I dag er den 70 % de fleste steder, 50 % i noen prosjekter og 0 % i noen (bl.a. Hålogalandsbrua og E6 Helgeland). I Oslo, Bergen og Kristiansand har elbil egen takst som også gjelder uten avtale. Ellers betaler elbil uten avtale full pris. Der prosjektets sats ikke er verifisert, vises elbilprisen som «ukjent» – den anslås ikke.
- **Energi:** kilometer × forbruk × pris. Forbruket er regnet om fra WLTP til forbruk på veien (se under). Uten registreringsnummer velger du biltype på oppstartssiden, og da brukes gjennomsnittstall for forbruk på veien, ikke typegodkjente tall: elbil 19 kWh/100 km i årssnitt (tallet NAF bruker i sine ladekostnadsberegninger), fordelt som 17,4 om sommeren og 21,2 om vinteren, med 448 km rekkevidde om sommeren. Bensin 7,4 l/100 km à 25 kr og diesel 6,2 l/100 km: Statens vegvesens snitt for de mest solgte bilene, pluss de 14 % ICCT måler at forbruket på veien ligger over typegodkjenningen. Utledningen står i `src/pris.js`. Forbruk, drivstoffpris og hurtigladepris kan justeres med glidebryterne i rutekortet, og huskes på enheten.
- **Strøm for elbil** (`src/strom.js`): hjemmelading prises med spotprisen for startstedets prisområde på avreisedagen, etter strømstøtte, pluss nettleie. Norgespris brukes bare som reserve når spotprisen ikke er tilgjengelig. På lange turer regnes de første 80 % av bilens rekkevidde som hjemmeladet, og resten som hurtiglading. Hurtigladeprisen er 5,90 kr/kWh til du endrer den med glidebryteren (0–10 kr) som vises i rutekortet når turen krever hurtiglading.
- **Råd om avreisetid:** samme rute prises for avreise opptil 90 minutter før og etter. Sparer du minst 1 kr, vises det nærmeste tidspunktet som gir størst besparelse. Trykk på rådet for å søke på nytt.
- **Tur/retur** (`src/turretur.js`): hver retning planlegges for seg, men bompengene prises samlet, slik at timesregelen kan gjøre returen gratis. Returen starter alltid rett etter ankomst, og hjemreisen planlegges fra ankomsttiden til hvert alternativ. Skjemaet har ikke noe eget felt for returtid.
- **Oppstartsside:** første gang siden åpnes på en enhet, vises en enkel forside med registreringsnummer og «Kom i gang». Feltet kan stå tomt. Siden vises ikke igjen på samme enhet, og heller ikke når noen åpner en delt lenke til et søk.
- **Bensinbil:** for elbil viser rutekortet også hva samme tur koster med bensinbil – bompenger, ferje og bensin hver for seg.
- **Ferje:** pris for kjøretøy inntil 6 m fra Statens vegvesens prismodul på autopassferje.no. Med brikke brukes prisen for AutoPASS-brikke (10 % rabatt); prisen med forskuddsavtale (50 %) står i utregningen. Elbil får nullutslippstakst. Rutene rangeres etter bom + ferje.
- **Ferjetider** (`src/ferjetid.js`): for de valgte rutene slås neste avgang opp hos Entur. Ventetid og faktisk overfartstid legges til kjøretiden, og bommer etter ferja prises på det nye tidspunktet.

### Strømpris

| Størrelse | Verdi | Kilde |
|---|---|---|
| Spotpris per time | hentes per prisområde | hvakosterstrommen.no |
| Strømstøtte 2026 | 90 % av prisen over 77 øre/kWh uten mva, time for time | regjeringen.no |
| Norgespris | 50 øre/kWh med mva (40 øre i Nord-Norge), ut 2026 | regjeringen.no / NVE |
| Nettleie og avgifter | 34 øre/kWh med mva (27 øre i Nord-Norge) | NVE-snitt 18,87 øre + elavgift 7,13 + Enova 1,0 |
| Hurtiglading | 5,90 kr/kWh | listepriser hos Circle K, Recharge og Kople (tek.no) |

Spotprisen er døgnsnittet etter strømstøtte. Prisområdet bestemmes omtrentlig ut fra startstedet.

### Realistisk forbruk

Typegodkjent forbruk (WLTP) regnes om slik (`FORBRUKSFAKTOR` i `src/pris.js`):

| Kjøretøy | Omregning | Grunnlag |
|---|---|---|
| Elbil, november–mars | WLTP × 1,22 | NAF El Prix vinter 2025: 18 % kortere rekkevidde enn WLTP ved −6 til +8 °C |
| Elbil, april–oktober | WLTP × 1,0 | NAF El Prix sommer 2025: bilene lå fra −13,7 % til +11,3 % mot WLTP |
| Bensin og diesel | WLTP × 1,14 | ICCT 2024: 14 % høyere forbruk på veien |
| Ladbar hybrid | 4,2 l/100 km | ICCT: 4,0–4,4 l/100 km for privateide biler, uansett WLTP-tall |

Dette er gjennomsnittstall. I streng kulde bruker elbiler mer (NAF målte 38 % kortere rekkevidde ved −7 til −32 °C i 2026).

### Registreringsnummer

Med `SVV_API_KEY` i `.env` må brukeren oppgi registreringsnummer før beregning. Serveren slår opp bilen hos Statens vegvesen, finner kjøretøytype og WLTP-forbruk, og regner om til forbruk på veien. Bilen huskes i nettleseren på enheten (`localStorage`), ikke på serveren. Uten nøkkel velger brukeren kjøretøytype selv, og valget huskes på samme måte.

Slik får du nøkkel:

1. Gå til [bestillingssiden hos Statens vegvesen](https://www.vegvesen.no/dinside/data-og-api-er/tilgang-til-api-for-kjoretoyopplysninger/) og logg inn med BankID, Buypass eller Commfides.
2. Bestill nøkkel til «API for tekniske kjøretøyopplysninger». Søknaden behandles automatisk, og du får nøkkelen med en gang. Hver person kan ha én aktiv nøkkel.
3. Kopier `.env.example` til `.env`, og sett `SVV_API_KEY=` til nøkkelen (uten «Apikey » foran).
4. Start serveren på nytt.

Tjenesten tillater 50 000 oppslag per nøkkel per døgn og gir ikke eieropplysninger. Mer om tjenesten står i [Vegvesenets dokumentasjon](https://autosys-kjoretoy-api.atlas.vegvesen.no/api-ui/index-enkeltoppslag.html).
- **Ladbar hybrid** belastes som bensinbil.
- **Rushtid:** hver bom prises etter estimert passeringstid (avreise + kjøretid fram til bommen), med ukedag, norske helligdager og Oslos juli-unntak.
- **Timesregel:** innenfor samme timesregel-gruppe betales bare én passering i vinduet fra første passering. Den dyreste belastes, unntatt der selskapet sier at første passering bestemmer prisen (Tromsø). Regelen gjelder aldri på tvers av grupper.
- **Retning:** enveisbommer belastes bare når kjøreretningen stemmer med innkrevingsretningen.
- **Ferjer** regnes ikke som bom. Ruter med ferje får en advarsel.
- **Usikker pris:** bommer uten kjent takst vises som «ukjent» og holdes utenfor summen, med varsel på rutekortet.

## Slik velges rutene

`src/ruteplan.js`, testet i `test/ruteplan.test.js`.

1. **Raskeste** beregnes uten begrensninger, og bommene langs ruta prises.
2. **Billigste:** først en rute der rutetjenesten unngår veier merket som bomvei i OpenStreetMap. Den prises med våre data. Bommer som fortsatt koster penger sperres med små polygoner (ca. 24 × 14 m rundt kjørebanen), og nabobommene i samme bomring sperres med unngå-punkter, før ruta beregnes på nytt.
3. **Kompromiss:** skal spare omtrent halvparten av forskjellen mellom raskeste og billigste. Vi unngår akkurat så mange av bommene på raskeste rute at halve besparelsen dekkes (én gang med de dyreste først, én gang med de billigste først), og prøver i tillegg «myk» bomunngåelse i Valhalla. Kandidaten nærmest 50 % velges, og bare hvis den sparer mellom 30 og 70 % og er raskere enn den billigste. Finnes ingen slik rute, vises ikke noe kompromiss.

**Ferjer.** Går rutetjenestens raskeste rute med ferje, er det den som blir «Raskeste», slik navigasjonsappene også regner. Veien uten ferje beregnes i tillegg og kan bli kompromiss eller billigste, siden den sparer ferjebilletten. Ferja velges bare bort når veien er raskere selv uten ventetid, regnet med overfartstiden fra rutetabellen. Kjøretiden i kortet har ventetiden på kaia med. Er ventetiden på første ferje 15 minutter eller mer, foreslår kortet hvor mye senere du kan dra og likevel rekke samme avgang. Med bryteren «Ferjer» slått av legges alle ruter utenom ferjer der det finnes vei.

Ruter som tar mer enn dobbelt så lang tid som den raskeste forkastes. En bomring unngås ikke når start eller mål ligger innenfor den, og utregningen forklarer hvorfor hver gjenværende bom ikke ble unngått. Raskeste rute er valgt i kartet når resultatet vises.

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
| Stedssøk | alle byer, tettsteder og landsbyer (lokalt register), pluss stasjoner, flyplasser og ferjekaier | OpenStreetMap, Entur, med Photon som reserve for adresser |
| Strømpris | spotpris for SE1–SE4 og DK1–DK2 | elprisetjustnu.se, elprisenligenu.dk |

Regler som er lagt inn (`src/pris.js`, testet i `test/tur.test.js`):

- **Fridager:** ingen trängselskatt lørdag, søndag og helgdager. Göteborg har i tillegg fri dagen før helgdag og hele juli. Stockholm har fri trettondagsafton, midsommarafton, julaften og nyttårsaften, og i juli unntatt de fem første hverdagene. Reglene er kontrollert mot Transportstyrelsens datolister for 2026.
- **Ingen rabatter:** trängselskatten er lik for alle kjøretøy. AutoPASS-brikke og elbil gir ikke lavere pris i Sverige eller på Øresundsbron.
- **Valuta:** beløpene regnes om til kroner med Norges Banks siste kurs. Serveren henter den hver dag og regner om alle utenlandske takster uten omstart. Svarer ikke Norges Bank, beholdes forrige kurs. Beløpet i SEK eller DKK står i utregningen.

Takstene er lagt inn for hånd og må kontrolleres når året skifter. Posisjonene hentes ved dataoppdatering, valutakursen hver dag.

**Begrensninger**
- Betalstasjonene ved Essingeleden i Stockholm har to beløpstabeller som ikke lar seg skille sikkert i OpenStreetMap. De er merket «Usikker» og kan avvike med inntil 5 SEK.
- Beløpet for Skurubron (4 SEK) er hentet fra andre nettsteder, ikke fra Transportstyrelsen, og er merket «Usikker».
- Øresundsbron prises med normalpris. Onlinebillett (420 DKK) og ØresundGO-avtale (182 DKK) er ikke med.
- Tunge kjøretøy får «ukjent pris» på Storebælt og Øresund, der prisen følger lengden.
- Andre ferjer enn de svenske vegferjene har ikke pris: ferjer i Danmark, Helsingør–Helsingborg og ferjene mellom Norge og Danmark eller Sverige. En omvei med slik ferje vises ikke som billigere alternativ. Rutetider finnes bare for norske ferjer.
- Stedssøket har et lokalt register (`data/steder-utland.json`) over byer, tettsteder og landsbyer i Sverige og Danmark, og tåler norsk skrivemåte («Gøteborg», «Århus»). Norske steder vises først når de passer like godt. Adresser i Sverige og Danmark slås opp hos Photon, som tåler få kall og settes på pause i ti minutter når den ikke svarer. Grender og gårder er ikke med. Du kan alltid skrive koordinater (`57.7089, 11.9746`).
- Strømprisen for turer som starter i Sverige eller Danmark er spotpris med mva og strømavgift, uten nettavgift.
- Oppslag på registreringsnummer gjelder bare norskregistrerte biler.

## Kartlenker

- **Google Maps:** `https://www.google.com/maps/dir/?api=1&origin=…&destination=…&waypoints=…&travelmode=driving`, med inntil 9 via-punkter (3 i mobilnettleser, som er Googles grense).
- **Apple Maps:** `https://maps.apple.com/directions?source=…&destination=…&waypoint=…&mode=driving`, med ett `waypoint` per via-punkt.

Via-punktene legges der ruta avviker fra den raskeste. Appene viser dem som stopp.

## Kjente begrensninger

**Ikke verifisert**
- Oppslag på registreringsnummer følger Vegvesenets publiserte spesifikasjon (endepunkt, nøkkelformat og feltnavn er kontrollert mot den), men er ikke kjørt mot tjenesten, siden det krever nøkkel. Testene bruker eksempelsvar bygget etter spesifikasjonen.
- OpenRouteService-støtten er skrevet etter dokumentasjonen, men ikke kjørt mot tjenesten (krever nøkkel).
- Kartlenkene er kontrollert for én rute (Kristiansand → Tønsberg): Google Maps og Apple Maps på nett ga begge 9 stopp og 3 t 28 min, likt kartet. Det er meldt om at Apple Maps i ett tilfelle åpnet uten stoppene. Sjekk ruta i appen før du kjører.

**Strøm og forbruk**
- Forbruk per bilmodell er ikke lagt inn. Bilens eget tall brukes når kjøretøyregisteret har det; ellers brukes standardverdien. Feltene for eget forbruk og egen strømpris er tatt ut av skjemaet.
- På tur/retur regnes strømmen som én sammenhengende tur med hjemmelading bare ved start. Lader du på bestemmelsesstedet, blir det billigere enn vist.
- Hurtigladeprisen er én fast pris og skiller ikke mellom kjeder.

**Ferjer**
- Ferjer uten rutetid hos Entur regnes uten ventetid, og med overfartstiden rutetjenesten oppgir.
- Ferjetider slås bare opp for raskeste rute og for rutene som vises, ikke for alle kandidater underveis.
- 20 av 796 ferjestrekninger mangler posisjon og får «ukjent pris».
- Moss–Horten er lagt inn for hånd (`EKSTRA_SAMBAND` i `scripts/lib/ferjer.js`) med takstene for 2026: 304 kr, nullutslipp 213 kr. Rabattprisene (10 % med brikke, 30 % med egen avtale) er regnet ut fra disse. Fra 1.1.2027 vises «ukjent pris» til nye takster er lagt inn. Andre samband utenfor AutoPASS-regulativet er ikke med.
- Tunge kjøretøy prises etter lengde og får «ukjent» ferjepris.
- Der innkrevingen bare skjer én vei, gjelder prisen tur/retur. Den legges på uansett kjøreretning.

**Rutetjenesten**
- Standard er den åpne Valhalla-serveren til FOSSGIS. Den er ment for lett bruk og har ingen oppetidsgaranti. Sett opp egen Valhalla eller bruk ORS-nøkkel hvis siden skal brukes av mange.
- Serveren tillater 20 polygoner og 50 unngå-punkter per kall. I de største ringene (Oslo) sperres derfor de nærmeste bommene, ikke nødvendigvis alle.
- Et polygon sperrer veien i begge retninger, også for en bom som bare krever inn én vei.
- Kjøretid er uten sanntidstrafikk. Passeringstidene er derfor beregnet, ikke målt, og nær et rushtidsskille kan faktisk pris avvike.

**Bomdataene**
- 17 av 443 bommer er merket «pris usikker»: 16 private bomveier (takst kun fra NVDB, to av dem uten takst) og Småstrandgaten i Bergen. Bare én privat bomvei er kontrollert mot driverens side (Visdalsvegen); listen ligger i `PRIVATE_TAKSTER` i `scripts/lib/kilder.js`.
- 10 NVDB-objekter utelates fordi de ikke er bommer i drift: uten navn, operatør og takst (AutoPASS-lesere på ferjekaier), duplikater, og bommer selskapet ikke lister.
- 22 enveisbommer har motstridende retningsdata i NVDB. De er avgjort ut fra stasjonsnavn eller bomringens form; én (Småstrandgaten i Bergen) står igjen som usikker.
- En bom regnes som passert når ruta går nærmere enn 30 m i riktig retning. Avvik mellom NVDB og OpenStreetMap kan i sjeldne tilfeller gi feil treff.
- Tolkerne leser selskapenes nettsider og kan slutte å virke når sidene endres. Oppdateringsscriptet melder da `FEIL` for kilden. Testene fanger feil i tolkerne, ikke at en side er lagt om.

**Ikke modellert**
- Månedstak, hydrogen, el-varebil, fritak for forflytningshemmede og bostedsfritak.
- Særregler i Trondheim (tverrforbindelsen og Moholt).
- For tungt kjøretøy brukes Euro VI-takst i Oslo, Bergen og Kristiansand. Eldre kjøretøy betaler mer.
- Ferjebilletter og bompengeandel på ferje.

## Legge siden på nett

Siden er en vanlig Node-server uten avhengigheter (`node server.js`, port fra `PORT`). Den trenger et sted som kan kjøre en prosess, gjøre utgående nettkall og holde på hemmeligheten `SVV_API_KEY`. Rene statiske verter (GitHub Pages, Netlify uten funksjoner) holder ikke.

**Anbefalt gratis: Render.** `render.yaml` i rota er en ferdig oppskrift.

1. Legg prosjektet i et GitHub-repo. `.env` er allerede utelatt i `.gitignore`.
2. Opprett konto på render.com, velg «New → Blueprint» og pek på repoet.
3. Legg inn `SVV_API_KEY` i kontrollpanelet (Environment).
4. Koble til eget domene under Settings hvis du har et.

Det du må leve med på gratisnivået (lest på render.com/docs/free i november 2026):

- Tjenesten sovner etter 15 minutter uten besøk. Første besøk etterpå tar omtrent ett minutt.
- Disken nullstilles ved hver omstart. Mellomlageret for ruter og søk i `data/cache` starter da tomt, og en automatisk dataoppdatering varer bare til neste omstart. Datafilene i repoet er derfor de som gjelder: kjør `npm run oppdater-data` lokalt og legg inn endringene.
- 750 timer i måneden, og Render kaller selv gratisnivået uegnet for produksjon.

**Alternativer:** en alltid-på gratis virtuell maskin hos Oracle Cloud (krever betalingskort og at du setter opp serveren selv), eller Google Cloud Run (krever betalingskort og en Dockerfile). Fly.io og Railway har ikke lenger et varig gratisnivå.

**Før du deler siden bredt**, sjekk vilkårene for tjenestene den lener seg på. Den åpne Valhalla-serveren (valhalla1.openstreetmap.de) og kartflisene fra openstreetmap.org er ment for begrenset bruk. Ved mye trafikk bør du sette opp egen Valhalla (`VALHALLA_URL`) og bruke en kartflisleverandør med avtale. Oppslag på registreringsnummer går med din personlige nøkkel hos Statens vegvesen.

## Lisens

Koden er lisensiert under [MIT-lisensen](LICENSE).

Lisensen gjelder koden, ikke dataene. Datafilene i `data/` er satt sammen fra åpne kilder som har egne vilkår, og de følger med når du bruker eller deler filene:

| Fil | Kilde | Vilkår |
|---|---|---|
| `data/bomstasjoner.json` | Statens vegvesen (NVDB) og bompengeselskapenes takstsider | [NLOD](https://data.norge.no/nlod/no/2.0) for NVDB-dataene |
| `data/ferjer.json` | Statens vegvesen (autopassferje.no), kaiposisjoner fra Entur | [NLOD](https://data.norge.no/nlod/no/2.0) |
| `data/utland.json` | © OpenStreetMap-bidragsytere (posisjoner), Transportstyrelsen, Storebælt og Øresundsbron (takster), Norges Bank (kurs) | [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/) for OpenStreetMap-dataene |
| `data/steder-norge.json`, `data/steder-utland.json` | © OpenStreetMap-bidragsytere | [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/) |

Nettsiden henter i tillegg data mens den kjører: kart fra OpenStreetMap, ruter fra Valhalla, stedsnavn fra Kartverket (CC BY 4.0) og Entur, ferjetider fra Entur, strømpriser fra hvakosterstrommen.no, elprisetjustnu.se og elprisenligenu.dk, valutakurs fra Norges Bank og kjøretøydata fra Statens vegvesen. Kartet tegnes med [Leaflet](https://leafletjs.com) (BSD 2-Clause).

## Mappestruktur

```
server.js                  backend: nettside + API-proxy
src/pris.js                prisberegning (rushtid, timesregel, rabatter, trängselskatt)
src/geo.js                 bomtreff langs rute, unngå-polygoner
src/ruteplan.js            raskeste / kompromiss / billigste / med ferje
src/turretur.js            tur og retur priset samlet
src/ruting.js              Valhalla og OpenRouteService
src/ferje.js               ferjepriser
src/ferjetid.js            neste ferjeavgang (Entur)
src/strom.js               strømpris for hjemmelading
src/kjoretoy.js            oppslag på registreringsnummer
src/geokoding.js           stedssøk (Kartverket, Entur, Photon)
src/lenker.js              Google Maps- og Apple Maps-lenker
src/cache.js               cache for rute- og adressekall
scripts/oppdater-data.js   henter NVDB, selskapenes takster, ferjer og utland
scripts/lib/utland.js      bom- og broavgifter i Sverige og Danmark
scripts/lib/ferjer.js      ferjepriser, og samband lagt inn for hånd
data/bomstasjoner.json     norske bomstasjoner
data/ferjer.json           ferjepriser
data/utland.json           Sverige og Danmark
public/                    frontend (HTML, CSS, JS, Leaflet)
test/                      enhetstester
```
