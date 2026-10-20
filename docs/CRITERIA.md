# Vidalo scancriteria en sectoren


De scan beoordeelt per vraag of een AI-antwoord over een bedrijf klopt, niet klopt of ontbreekt, op twaalf feitcategorieën die een klant tot kopen of afhaken brengen. Elk criterium is gekozen omdat het aantoonbaar vaak fout gaat, verifieerbaar is tegen de eigen opgave van de ondernemer, en herstelbaar bij de bron. Per sector verschilt welke feiten doorslaggevend zijn; daarom krijgt elke sector een eigen vragenset.

## Uitgangspunten

De scan is een keuring, geen mening. Zes regels bepalen wat er wel en niet wordt beoordeeld.

1. **Alleen feiten die de ondernemer zelf kan bevestigen.** Openingstijden, telefoonnummer, diensten, werkgebied, prijzen. Niet: of je "goed" bent, of je "de beste" bent, hoe vaak je genoemd wordt tegenover concurrenten. Dat laatste is marketing; het eerste is waarheid, en alleen waarheid kun je herstellen.
2. **Elk oordeel heeft een maatstaf.** De maatstaf is de door de eigenaar bevestigde opgave (het feitenrecord). Zonder bevestigde opgave is er geen oordeel, alleen een voorlopige vergelijking.
3. **Drie oordelen, nooit twee.** Klopt, klopt niet, niet gevonden. "Niet gevonden" is een eigen uitkomst, omdat een bedrijf dat de AI niet kent net zo goed de klant verliest als een bedrijf waarover de AI iets verkeerds zegt. In een controle van 10.000 bedrijven herkende ChatGPT 93% wel, maar gaf het bij slechts 56% een volledig kloppend antwoord; de rest zat tussen fout en onvolledig.
4. **Herhaald meten.** Een AI geeft zelden twee keer hetzelfde antwoord: SparkToro mat minder dan 1% kans dat ChatGPT dezelfde bedrijvenlijst twee keer teruggeeft. Daarom stellen we elke vraag meerdere keren en rapporteren we een frequentie ("7 van de 10 keer"), nooit een enkel antwoord.
5. **Elke fout krijgt een bron.** Een fout zonder herkomst is niet te herstellen. We halen de bronnen op die de AI citeert en zoeken de pagina waar de foute waarde letterlijk staat. Lukt dat niet, dan staat er eerlijk: uit het geheugen van het model.
6. **Ernst weegt zwaarder dan aantal.** Eén fout "permanent gesloten" kost meer klanten dan vijf foute prijzen. Elk criterium heeft daarom een ernstklasse, en de kleur van de stip volgt de ernst, niet het aantal.

## De twaalf criteria

Twaalf feitcategorieën, gerangschikt op ernst. De eerste vijf zijn *afhakers*: één fout en de klant komt niet. De volgende vier zijn *misleiders*: de klant komt wel, maar voor het verkeerde, en gaat teleurgesteld weg. De laatste drie zijn *verwarring*: de AI haalt jou door elkaar met een ander of mist waar je voor staat.

| # | Criterium | Vraag die een klant stelt | Klopt niet als | Drempel | Ernst | Waarom dit erin zit |
|---|---|---|---|---|---|---|
| 1 | **Bestaan** | Bestaat X in Y nog? Is X open? | AI zegt gesloten, failliet, verhuisd of "bestaat niet" terwijl je open bent | 1 van N samples | Afhaker | De duurste fout die er is: een boekwinkel in Ohio verloor wekenlang omzet na "permanent gesloten" in Google AI. Komt vooral uit oude gidsen en naamgenoten. |
| 2 | **Telefoonnummer** | Wat is het nummer van X? | Ander nummer dan jouw opgave (genormaliseerd naar +31) | 1 van N | Afhaker | Bij 30 tot 39% van de bedrijven geeft ChatGPT of Perplexity een verkeerd nummer (Insites, 10.000 bedrijven). De klant belt een ander of niemand. |
| 3 | **Openingstijden** | Is X op zondag open? Tot hoe laat op zaterdag? | Dag/tijd wijkt af van opgave; "gesloten" terwijl open of andersom | ≥ 30% van samples | Afhaker | De meest gestelde praktische vraag. Gidsen uit 2022 en een ongeclaimd Google-profiel zijn de gebruikelijke bron. |
| 4 | **Werkgebied** | Komt X ook in Z? Werkt X in regio Y? | AI zegt nee voor een plaats binnen je werkgebied, of ja voor een plaats erbuiten | ≥ 30% | Afhaker | Voor vakmensen en dienstverleners is dit hét selectiecriterium: "welke loodgieter komt in Heemstede" sluit je uit als de AI je werkgebied niet kent. Staat bijna nooit in gidsen. |
| 5 | **Spoed en beschikbaarheid** | Heeft X een 24-uursdienst? Kan X vandaag nog komen? | AI zegt geen spoeddienst terwijl je die hebt, of andersom | ≥ 30% | Afhaker | Bij lekkage, storing of uitval kiest de klant de eerste die "ja" zegt. De AI beslist dat voor je op basis van wat het kon vinden. |
| 6 | **Diensten: wel** | Doet X ook warmtepompen? Verkoopt X glutenvrij? | AI zegt nee of noemt het niet, terwijl jij het doet | ≥ 30% | Misleider | Nieuwe diensten staan vaak alleen op je eigen site, en die is één bron van vijf. Zonder dit kom je niet in de aanbeveling voor die dienst. |
| 7 | **Diensten: niet** | Repareert X ook fietsen? Doet X particulieren? | AI zegt ja terwijl jij dat niet doet | ≥ 30% | Misleider | Kost tijd aan foute aanvragen en levert slechte reviews op ("ze doen het niet eens"). |
| 8 | **Adres en locatie** | Waar zit X? Is er parkeergelegenheid? | Ander adres, oud adres, andere plaats | 1 van N | Misleider | Verhuizingen blijven jaren in gidsen staan. Bij 16% klopt de website-URL niet (Insites). |
| 9 | **Prijzen en tarieven** | Wat kost een APK bij X? Wat is het uurtarief? | Afwijking groter dan 10% van opgave, of verouderde prijs | ≥ 30% | Misleider | De klant komt met een verkeerde verwachting of kiest een ander op een prijs die niet bestaat. |
| 10 | **Afspraken en voorwaarden** | Alleen op afspraak? Pinnen? Offerte gratis? Voorrijkosten? | AI stelt een voorwaarde die niet geldt, of mist er een | ≥ 30% | Misleider | Kleine feiten met grote irritatie: "alleen contant" terwijl je pint, "op afspraak" terwijl je inloop hebt. |
| 11 | **Identiteit en naamgenoot** | Is X hetzelfde als X in Z? | AI koppelt nieuws, sluiting of adres van een ander bedrijf met dezelfde naam aan jou | 1 van N | Verwarring | Een bakkerij in Ontario kreeg een sluitingsdatum van een naamgenoot in Illinois. Herstelbaar met een feitenpagina die de verwarring expliciet uitsluit. |
| 12 | **Erkenningen en kwalificaties** | Is X erkend installateur? Heeft X een BIG-registratie? Is X aangesloten bij Techniek Nederland? | AI ontkent een erkenning die je hebt, of kent er een toe die je niet hebt | ≥ 30% | Verwarring | Voor vakwerk en zorg is dit vaak de doorslag in de aanbeveling ("erkende installateurs in Haarlem"). Staat zelden ergens machineleesbaar. |

Drempels: bij de afhakers 1, 2, 8 en 11 is één afwijkend antwoord al een bevinding, omdat één klant die dat antwoord krijgt al verloren is. Bij de overige criteria geldt 30% omdat AI-antwoorden ruis bevatten; onder 10% noemen we het "instabiel" en rapporteren we het zonder herstelactie.

**Niet gevonden** geldt voor elk criterium apart: als bij ≥ 50% van de samples de AI geen informatie heeft ("ik kan niets vinden over"), telt dat als niet gevonden voor dat criterium. Niet gevonden bij criterium 1 (bestaan) weegt als afhaker.

## Ernst en kleur: de stipregel

De stip is de samenvatting van alle oordelen in één kleur. De regel is eenvoudig genoeg om aan een klant uit te leggen en streng genoeg om nooit groen te geven aan een bedrijf dat klanten verliest.

| Kleur | Betekenis | Regel |
|---|---|---|
| Grijs | AI kent je niet | ≥ 60% van alle antwoorden is niet gevonden, óf criterium 1 (bestaan) is niet gevonden bij ≥ 50% |
| Rood | AI stuurt klanten weg | Minstens één afhaker-bevinding (criterium 1 t/m 5), óf ≥ 30% van alle antwoorden klopt niet |
| Oranje | AI misleidt | Geen afhakers, maar ≥ 1 misleider- of verwarringsbevinding, óf 25 tot 60% niet gevonden |
| Groen | Klopt | Geen bevindingen; ≤ 10% instabiel; < 25% niet gevonden |

De kleur wordt per AI-systeem berekend en daarna samengevat: de slechtste kleur van de systemen met minstens 10% gebruik in Nederland bepaalt de stip. ChatGPT alleen kan je dus rood maken; Perplexity alleen niet.

Waarom niet een score van 0 tot 100: een score suggereert dat 78 beter is dan 71, terwijl één "permanent gesloten" bij 78 erger is dan drie foute prijzen bij 71. Kleur plus ernst is eerlijker en begrijpelijker, en de scan toont altijd de losse bevindingen eronder.

## Meetmethode

**Welke AI-systemen.** ChatGPT (ruim 75% van het Nederlandse chatbotverkeer, StatCounter, juni 2026), Google AI Overviews en AI Mode (verschijnt boven Google-zoekresultaten, dus bij vrijwel elke lokale zoekopdracht), Copilot (standaard in Windows en Edge), Gemini en Perplexity. De gratis scan doet de eerste drie; de maandcontrole alle vijf. Claude kan als zesde worden ingeschakeld voor zakelijke dienstverleners, waar het gebruik hoger ligt.

**Hoe vaak.** Gratis scan: 6 vragen × 3 systemen × 3 keer = 54 antwoorden. Maandcontrole: 20 tot 30 vragen × 5 systemen × 10 keer, rond de 1.000 tot 1.500 antwoorden. Tien herhalingen is het minimum om een frequentie van 30% betrouwbaar te onderscheiden van ruis.

**In welke taal en vanuit welke plek.** Nederlandse vragen, geformuleerd zoals een klant ze typt ("is bakkerij de vries zondag open"), met Nederland als locatie en zonder gespreksgeschiedenis. Elke vraag staat op zichzelf, zodat het ene antwoord het andere niet kleurt.

**Hoe een antwoord een oordeel wordt.** Uit elk antwoord halen we de feitelijke beweringen ("zondag gesloten", "023 535 22 18", "doet geen warmtepompen") en zetten die om naar dezelfde vorm als de opgave van de eigenaar. Een bewering over een ander bedrijf met dezelfde naam wordt apart gemarkeerd. Daarna vergelijken we per criterium.

**Hoe we de bron vinden.** AI-systemen met zoekfunctie citeren hun bronnen. We halen die pagina's op en zoeken de pagina waar de foute waarde letterlijk staat. Die pagina wordt de bron van de bevinding en bepaalt de herstelroute: eigen website, Google-profiel, gids met formulier, gids per e-mail, nieuwsbericht, naamgenoot. Geen citaat en toch fout: uit het geheugen van het model, en dat zeggen we zo.

**De grenzen, eerlijk.** Antwoorden met zoekfunctie reageren binnen dagen tot weken op een herstelde bron. Antwoorden uit het geheugen van het model veranderen pas bij een nieuwe modelversie; we controleren die opnieuw na elke grote release. Welke bronnen een AI gebruikt verschuift maandelijks (bij ChatGPT wisselde tot 60% van de bronnen in één maand), dus een controle is een momentopname en herhaling is geen luxe.

## Twee soorten vragen

Klanten stellen AI twee soorten vragen, en de scan doet ze allebei.

**Vragen over jou** ("Is De Vries zondag open?"). Hier controleren we of het antwoord klopt met je opgave. Dit zijn de twaalf criteria hierboven.

**Vragen om een aanbeveling** ("Wat is de beste Chinees in Rotterdam?", "Lekkage, wie kan vandaag nog komen in Utrecht?", "Wie installeert warmtepompen in Breda?"). Dit is de vraag die een klant echt stelt, en hier valt de beslissing. Hier controleren we niet of je op nummer één staat, dat is marketing. We controleren één ding: word je genoemd. Per sector stellen we bij elke volledige controle zes aanbevelingsvragen, één per bedoeling van de klant:

| Bedoeling | Voorbeeld | Gekoppeld aan | Criterium |
|---|---|---|---|
| Kwaliteit | Wat is de beste loodgieter in Utrecht? | je bent open | 6, misleider |
| Vertrouwen | Betrouwbare loodgieter in Utrecht, wie raad je aan? | je bent open | 6, misleider |
| Nu | Lekkage, wie kan vandaag nog komen? / Welke bakker is op zondag open? | spoed of openingstijden | 5 of 3 |
| Specialisme | Wie installeert warmtepompen in Utrecht? | een dienst of erkenning die je hebt | 6 of 12 |
| Prijs | Betaalbare loodgieter in Utrecht? (niet in de zorg) | je bent open | 9, misleider |
| Plek | Welke loodgieter komt ook in Nieuwegein? / Loodgieter bij mij in de buurt? | je werkgebied, of je bent open | 4 of 6 |

Er zijn dus twee soorten. Bij de vragen die aan een feit hangen (spoed, zondag, een dienst, een plaats in je werkgebied) betekent niet genoemd worden dat de AI een feit mist: word je niet genoemd voor warmtepompen terwijl je ze installeert, dan is dat een bevinding bij criterium 6. Bij de open vragen (kwaliteit, vertrouwen, prijs, in de buurt) hangt het ook af van reviews en lijstjes van anderen. Niet genoemd worden telt daar als misleider (oranje, nooit rood), en we laten zien wie de AI wel noemt en van welke sites het dat haalt. Reviews en lijstjes maken we niet; we zorgen dat je feiten overal kloppen en vindbaar zijn, en we wijzen de bronnen aan.

Dit onderscheid houdt de scan eerlijk. We beloven niet dat je genoemd wordt; we beloven dat je niet buiten de boot valt door een fout die wij kunnen herstellen, en dat je ziet waarom een ander wel genoemd wordt. Per sector krijgen de aanbevelingsvragen de vorm die klanten echt gebruiken: "loodgieter met spoed in Zwolle", "VvE-beheerder voor 12 appartementen in Utrecht", "fysio zonder verwijzing in Amersfoort".

**Vragenbank.** Naast de vaste zes heeft elke sector een bank van 20 tot 30 aanbevelingsvragen: andere bewoordingen (AI noemt op "beste Chinees" andere namen dan op "waar eet ik lekker Chinees"), de andere plaatsen in je werkgebied, je andere diensten en het seizoen ("terras in de zon" in de zomer, "verwarming doet het niet" in de winter). Bij elke volledige controle draaien er zes mee, elke maand andere, seizoensvragen alleen in hun seizoen. Zo is na een paar maanden alles gevraagd terwijl de kosten per controle gelijk blijven. Een vraag uit de bank waarbij je in minder dan de helft van de antwoorden genoemd wordt, schuift door naar de vaste set (hoogstens twee per controle).

## Sectoren: wat klanten vragen en wat er misgaat

De twaalf criteria gelden overal, maar per vak verschilt welke vraag de klant stelt en welk feit de doorslag geeft. Hieronder per sector: hoe een klant AI gebruikt, wat er typisch misgaat, welk feit het meest telt, en waarom het voor dit vak zo belangrijk is. Elke sector krijgt in de scan een eigen vragenset bovenop de basis.

### Loodgieters, installateurs, elektriciens, cv-monteurs

*Hoe de klant AI gebruikt:* bijna altijd met haast. "Lekkage, wie kan vandaag komen in Zwolle?" "Cv-ketel doet het niet, is er een 24-uursdienst in Breda?" "Wie installeert warmtepompen en is erkend?" De klant belt de eerste die de AI noemt en die "ja" zegt.

*Wat er misgaat:* de AI kent je werkgebied niet (je staat alleen op je vestigingsplaats), weet niet dat je spoeddienst hebt, of denkt dat je alleen cv doet omdat je website uit 2019 is. Gidsen hebben vaak je oude nummer.

*Doorslaggevend:* werkgebied (4), spoed (5), diensten wel (6), erkenning (12).

*Waarom dit ertoe doet:* een installateur haalt het grootste deel van nieuwe klanten uit "iemand zoekt nu een vakman". Als de AI bij die vraag drie anderen noemt omdat jouw werkgebied of spoeddienst onbekend is, merk je dat alleen aan een stille telefoon. Je kunt niet zien welke klanten je nooit belden.

*Extra vragen in de scan:* "Komt X ook in [plaats 10 km verder]?" "Heeft X een storingsdienst in het weekend?" "Is X erkend voor [warmtepomp / zonnepanelen / gas]?" "Rekent X voorrijkosten?"

### Aannemers, dakdekkers, schilders, hoveniers, stukadoors

*Hoe de klant AI gebruikt:* oriënterend, met een budget in het hoofd. "Wat kost een dakkapel ongeveer en wie doet dat in Haarlem?" "Schilder voor buitenwerk, kan ik een gratis offerte krijgen?"

*Wat er misgaat:* de AI noemt je niet voor de specifieke klus (je site zegt "aannemer", niet "dakkapellen"), koppelt een slechte review of faillissement van een naamgenoot aan jou, of noemt een uurtarief van jaren geleden.

*Doorslaggevend:* diensten wel (6), naamgenoot (11), prijzen (9), werkgebied (4).

*Waarom dit ertoe doet:* grote klussen beginnen met een shortlist. Sta je niet op de shortlist van de AI, dan krijg je de offerteaanvraag niet, en bij een naamgenoot met een faillissement word je weggestreept voordat iemand je gebeld heeft.

### VvE-beheer en vastgoedbeheer

*Hoe de klant AI gebruikt:* een bestuurslid van een VvE, meestal een vrijwilliger, zoekt zakelijk en vergelijkend. "VvE-beheerder voor 24 appartementen in Utrecht, wat kost dat per maand?" "Welke beheerders doen ook technisch beheer en MJOP?" "Is X aangesloten bij een branchevereniging?"

*Wat er misgaat:* de AI kent je niet (beheerders staan zelden in consumentengidsen), weet niet welke diensten je doet (financieel, technisch, administratief), noemt een verouderd tarief per appartement, of verwart je met een makelaar met dezelfde naam.

*Doorslaggevend:* bestaan/niet gevonden (1), diensten wel (6), prijzen (9), erkenning (12), werkgebied (4).

*Waarom dit ertoe doet:* een VvE kiest een beheerder voor jaren, op basis van een vergelijking die steeds vaker in een AI-gesprek begint. Wie daar niet in voorkomt, doet niet mee. Het is de sector met de hoogste kans op een grijze stip en de hoogste waarde per klant.

### Fysiotherapie, tandarts, huisarts, dierenarts, psycholoog

*Hoe de klant AI gebruikt:* praktisch en vertrouwelijk. "Fysio in Amersfoort zonder verwijzing?" "Tandarts die nieuwe patiënten aanneemt?" "Dierenarts met spoeddienst vanavond?" "Welke verzekeraars heeft X een contract mee?"

*Wat er misgaat:* "neemt geen nieuwe patiënten aan" terwijl dat allang weer kan; verkeerde spoedinformatie; een specialisatie die niet genoemd wordt; een BIG-registratie die de AI niet kan bevestigen.

*Doorslaggevend:* bestaan en beschikbaarheid (1, 5), spoed (5), voorwaarden zoals verwijzing en verzekeraars (10), erkenning (12).

*Waarom dit ertoe doet:* een patiënt die hoort "neemt geen nieuwe patiënten aan" belt niet om het te controleren; die gaat verder. En bij spoed telt alleen wie de AI als bereikbaar ziet.

### Horeca: restaurants, cafés, lunchrooms

*Hoe de klant AI gebruikt:* in het moment. "Restaurant in Haarlem dat nu open is en reserveren kan voor 6?" "Hebben ze vegetarische opties?" "Kan ik daar pinnen?"

*Wat er misgaat:* openingstijden per dag (de keukentijden verschillen van de deurtijden), "gesloten op maandag" uit een oude gids, een menu van twee jaar geleden, een naamgenoot in een andere stad.

*Doorslaggevend:* openingstijden (3), bestaan (1), voorwaarden zoals reserveren en pinnen (10), diensten zoals terras en groepen (6).

*Waarom dit ertoe doet:* horeca-vragen zijn directe omzet: de klant die hoort dat je dicht bent, zit een half uur later bij de buren. En binnenkort reserveert de AI zelf, bij de zaak die volgens zijn gegevens open is.

### Winkels en retail

*Hoe de klant AI gebruikt:* "Verkoopt X ook [product]?" "Open op koopzondag?" "Kan ik online bestellen en afhalen?"

*Wat er misgaat:* koopzondagen en feestdagen, assortiment dat de AI niet kent, verhuizingen die in gidsen blijven hangen.

*Doorslaggevend:* openingstijden (3), adres (8), diensten wel (6).

*Waarom dit ertoe doet:* de klant staat met de jas aan. Een fout antwoord is een bezoek dat niet plaatsvindt.

### Autogarages, fietsenmakers, reparatie

*Hoe de klant AI gebruikt:* "APK in Zwolle, wat kost het bij X?" "Repareren ze ook elektrische fietsen?" "Kan ik zonder afspraak langskomen?"

*Wat er misgaat:* oude APK-prijs, merkspecialisatie die niet bekend is, "alleen op afspraak" terwijl je inloop hebt.

*Doorslaggevend:* prijzen (9), diensten wel/niet (6, 7), voorwaarden (10).

*Waarom dit ertoe doet:* garages concurreren op prijs en gemak; de AI vergelijkt dat voor de klant, met de cijfers die het toevallig vond.

### Kappers, schoonheid, wellness

*Hoe de klant AI gebruikt:* "Kapper in Leiden zonder afspraak?" "Doen ze ook herenkapsels?" "Wat kost knippen?"

*Wat er misgaat:* openingstijden, prijzen, en of je zonder afspraak terecht kunt. Veel kleine zaken zonder website zijn grijs.

*Doorslaggevend:* openingstijden (3), voorwaarden (10), prijzen (9), niet gevonden.

### Advocaten, notarissen, accountants, administratiekantoren

*Hoe de klant AI gebruikt:* zakelijk en zoekend naar een specialisme. "Advocaat arbeidsrecht in Den Bosch die ook particulieren helpt?" "Accountant voor een BV met 5 man, wat kost een jaarrekening?" "Doet notaris X ook een levenstestament?"

*Wat er misgaat:* specialismen die de AI niet kent, een "alleen zakelijk" dat niet klopt, tarieven uit een oud artikel, een naamgenoot met een tuchtzaak.

*Doorslaggevend:* diensten wel/niet (6, 7), naamgenoot (11), erkenning (12), prijzen (9).

*Waarom dit ertoe doet:* vertrouwen begint bij het eerste antwoord. Een verkeerde specialisatie of een verwarring met een tuchtzaak kost je de klant voordat je er iets van weet.

### Makelaars en hypotheekadviseurs

*Hoe de klant AI gebruikt:* "Makelaar in Hilversum met vaste prijs?" "Doet X ook verhuur?" "Is X NVM-lid?"

*Wat er misgaat:* courtage uit een oude pagina, lidmaatschap onbekend, werkgebied te smal.

*Doorslaggevend:* prijzen (9), erkenning (12), werkgebied (4).

### Kinderopvang, sportscholen, rijscholen

*Hoe de klant AI gebruikt:* "Kinderopvang in Zwolle met plek voor een baby?" "Sportschool open om 6 uur?" "Rijschool met automaat?"

*Wat er misgaat:* wachtlijst of beschikbaarheid, openingstijden, aanbod.

*Doorslaggevend:* beschikbaarheid (5), openingstijden (3), diensten wel (6).

*Waarom dit ertoe doet:* "wachtlijst" of "vol" is een afhaker; als de AI dat uit een oud bericht haalt, loop je inschrijvingen mis zonder het te merken.

### Samengevat per sector

| Sector | Doorslaggevend feit | Typische bron van de fout | Grootste risico |
|---|---|---|---|
| Loodgieter / installateur / elektricien | Werkgebied, spoed, erkenning | Gidsen, oude website | Niet genoemd bij spoedvraag |
| Aannemer / dakdekker / schilder / hovenier | Specifieke klus, naamgenoot | Naamgenoot, oud tarief | Niet op de shortlist |
| VvE-beheer / vastgoedbeheer | Bestaan, diensten, tarief | Nergens vindbaar | Grijze stip |
| Fysio / tandarts / dierenarts | Nieuwe patiënten, spoed, verwijzing | Oud bericht, gids | "Neemt niemand aan" |
| Horeca | Openingstijden, reserveren, pinnen | Gids 2022, naamgenoot | "Gesloten" terwijl open |
| Winkel | Koopzondag, adres, assortiment | Gidsen na verhuizing | Bezoek dat niet komt |
| Garage / fietsenmaker | Prijs, specialisatie, inloop | Oude prijs op site | Verkeerde vergelijking |
| Kapper / schoonheid | Zonder afspraak, prijs | Geen website | Grijze stip |
| Advocaat / notaris / accountant | Specialisme, naamgenoot | Oud artikel, tuchtzaak naamgenoot | Vertrouwen weg |
| Makelaar / hypotheek | Courtage, lidmaatschap, werkgebied | Oude pagina | Verkeerde prijs |
| Kinderopvang / sportschool / rijschool | Beschikbaarheid, tijden | Oud bericht | "Vol" terwijl plek |

## Wat de scan bewust niet beoordeelt

- **Reviews en sentiment.** "De AI zegt dat je service matig is." Dat is een mening uit reviews, geen feit dat je kunt corrigeren zonder de reviews zelf te veranderen. Reputatiebeheer is een ander vak, met een andere ethiek.
- **Ranking en share of voice.** Op welke plek je staat in een lijstje, of hoe vaak je genoemd wordt tegenover concurrenten. Dat wisselt per vraag en per dag (minder dan 1% reproduceerbaar), en het suggereert controle die niemand heeft.
- **Of de AI jou aanbeveelt.** We beoordelen alleen of je *ten onrechte ontbreekt* door een feit dat fout is of mist. Dat is herstelbaar; een voorkeur van een AI is dat niet.
- **Trainingsgeheugen als zodanig.** Als een AI zonder te zoeken een fout antwoord geeft, melden we dat als bevinding met bron "geheugen van het model", maar we beloven geen herstel. Dat verandert pas bij een nieuwe modelversie.
- **Vergelijkingen met concurrenten.** Geen tabel "jij versus de buren". Het leidt af van wat te herstellen valt en nodigt uit tot het soort claims dat we niet kunnen waarmaken.

## Wat dit betekent voor de bouw

Drie dingen moeten in de scanner veranderen om deze criteria te dragen.

**1. Sectorvragensets.** Nu genereert de scanner 20 algemene vragen uit het feitenrecord. Daar komt een sectorlaag bovenop: per sector tot 6 extra vragen over het bedrijf en zes aanbevelingsvragen, één per bedoeling (kwaliteit, vertrouwen, nu, specialisme, prijs, plek), plus een wisselende vragenbank. De sector wordt afgeleid uit de Google-categorie of de KvK SBI-code van het bedrijf, met een handmatige keuze als terugvaloptie. Het feitenrecord krijgt drie velden erbij die nu ontbreken: **werkgebied** (lijst van plaatsen of straal in km), **spoed/beschikbaarheid** (ja/nee plus tijden) en **erkenningen** (vrije lijst). Zonder die velden kunnen criteria 4, 5 en 12 niet worden beoordeeld.

**2. Ernstgewichten en de stipregel.** Elk criterium krijgt een ernstklasse (afhaker, misleider, verwarring) en een eigen drempel (1 van N of 30%). De stipkleur wordt berekend per AI-systeem en samengevat volgens de regel in dit document. Rapport, e-mails en dashboard tonen kleur plus bevindingen, nooit een score.

**3. Aanbevelingsvragen met ontbrekingsdetectie.** Een aanbevelingsvraag ("welke loodgieter in Zwolle met spoed") wordt niet beoordeeld op positie maar op één vraag: staat het bedrijf erbij, en zo nee, welk feit is daarvan de oorzaak? Daarvoor koppelt elke aanbevelingsvraag aan één criterium (bijvoorbeeld spoed), zodat ontbreken een bevinding bij dat criterium wordt.

De vragen per sector, de velden en de regel zijn hier vastgelegd zodat ze letterlijk in de code en in de klantteksten kunnen worden overgenomen. Wat erin staat moet een loodgieter, een VvE-bestuurslid en een fysiotherapeut zonder uitleg kunnen lezen; waar dat niet lukt, is de tekst fout, niet de lezer.
