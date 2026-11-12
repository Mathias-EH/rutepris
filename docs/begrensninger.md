# Kjente begrensninger

Tallene under gjelder datasettet per november 2026.

## Bomdata

- 17 av 443 bommer er merket «pris usikker»: 16 private bomveier (takst kun fra NVDB, to av dem uten takst) og Småstrandgaten i Bergen. Bare én privat bomvei er kontrollert mot driverens side (Visdalsvegen); listen ligger i `PRIVATE_TAKSTER` i `scripts/lib/kilder.js`.
- 10 NVDB-objekter utelates fordi de ikke er bommer i drift: uten navn, operatør og takst (AutoPASS-lesere på ferjekaier), duplikater, og bommer selskapet ikke lister.
- 22 enveisbommer har motstridende retningsdata i NVDB. De er avgjort ut fra stasjonsnavn eller bomringens form; én (Småstrandgaten i Bergen) står igjen som usikker.
- En bom regnes som passert når ruta går nærmere enn 30 m i riktig retning. Avvik mellom NVDB og OpenStreetMap kan i sjeldne tilfeller gi feil treff.
- Tolkerne leser selskapenes nettsider og kan slutte å virke når sidene endres. Oppdateringsscriptet melder da `FEIL` for kilden. Testene fanger feil i tolkerne, ikke at en side er lagt om.

## Ikke modellert

- Månedstak, hydrogen, el-varebil, fritak for forflytningshemmede og bostedsfritak.
- Særregler i Trondheim (tverrforbindelsen og Moholt).
- For tungt kjøretøy brukes Euro VI-takst i Oslo, Bergen og Kristiansand. Eldre kjøretøy betaler mer.
- Bompengeandel på ferje.

## Ferjer

- Ferjer uten rutetid hos Entur regnes uten ventetid, og med overfartstiden rutetjenesten oppgir.
- Ferjetider slås bare opp for rutene som vises, ikke for alle kandidater underveis.
- 20 av 796 ferjestrekninger mangler posisjon og får «ukjent pris».
- Moss–Horten er lagt inn for hånd med takstene for 2026: 304 kr, nullutslipp 213 kr. Rabattprisene (10 % med brikke, 30 % med egen avtale) er regnet ut fra disse. Fra 1.1.2027 vises «ukjent pris» til nye takster er lagt inn. Andre samband utenfor AutoPASS-regulativet er ikke med.
- Tunge kjøretøy prises etter lengde og får «ukjent» ferjepris.
- Der innkrevingen bare skjer én vei, gjelder prisen tur/retur. Den legges på uansett kjøreretning.

## Strøm og forbruk

- Forbruk per bilmodell er ikke lagt inn. Bilens eget tall brukes når kjøretøyregisteret har det; ellers brukes standardverdien for biltypen.
- På tur/retur regnes strømmen som én sammenhengende tur med hjemmelading bare ved start. Lading på bestemmelsesstedet gjør turen billigere enn vist.
- Hurtigladeprisen er én fast pris og skiller ikke mellom kjeder.
- Strømprisen for turer som starter i Sverige eller Danmark er spotpris med mva og strømavgift, uten nettavgift.

## Rutetjenesten

- Standard er den åpne Valhalla-serveren til FOSSGIS. Den er ment for lett bruk og har ingen oppetidsgaranti.
- Serveren tillater 20 polygoner og 50 unngå-punkter per kall. I de største ringene (Oslo) sperres derfor de nærmeste bommene, ikke nødvendigvis alle.
- Et polygon sperrer veien i begge retninger, også for en bom som bare krever inn én vei.
- Kjøretid er uten sanntidstrafikk. Passeringstidene er derfor beregnet, ikke målt, og nær et rushtidsskille kan faktisk pris avvike.
- Støtten for OpenRouteService er skrevet etter tjenestens dokumentasjon og er ikke prøvd mot tjenesten.

## Sverige og Danmark

- Betalstasjonene ved Essingeleden i Stockholm har to beløpstabeller som ikke lar seg skille sikkert i OpenStreetMap. De er merket «Usikker» og kan avvike med inntil 5 SEK.
- Beløpet for Skurubron (4 SEK) er hentet fra andre nettsteder, ikke fra Transportstyrelsen, og er merket «Usikker».
- Øresundsbron prises med normalpris. Onlinebillett (420 DKK) og ØresundGO-avtale (182 DKK) er ikke med.
- Tunge kjøretøy får «ukjent pris» på Storebælt og Øresund, der prisen følger lengden.
- Andre ferjer enn de svenske vegferjene har ikke pris: ferjer i Danmark, Helsingør–Helsingborg og ferjene mellom Norge og Danmark eller Sverige. En omvei med slik ferje vises ikke som billigere alternativ. Rutetider finnes bare for norske ferjer.
- Adresser i Sverige og Danmark slås opp hos Photon, som tåler få kall og settes på pause i ti minutter når den ikke svarer. Grender og gårder er ikke med i stedsregisteret.
- Oppslag på registreringsnummer gjelder bare norskregistrerte biler.

## Kartlenker

- Navigasjonsappene regner ruta selv mellom via-punktene, så ruta i appen kan avvike fra kartet på nettsiden. Kontroller ruta i appen før avreise.
- Apple Maps kan i enkelte tilfeller åpne uten via-punktene.
