# Cirkel-Civ: spec v0.1

*Arbetsnamn. Spelet får ett riktigt namn längre fram.*

Ett eget strategispel i civ-anda som vi bygger tillsammans, som funkar för människor i multiplayer och som AI-agenter kan träna på. Inte en Civ 6-kopia. Det här dokumentet är första tolkningen och styr vad som byggs i första demon.

## 1. Kärnidén: alla beordrar samtidigt, allt händer samtidigt

I Civ med simultaneous turns verkställs order direkt när man klickar. Den som klickar först i en strid agerar först. Det gör strid till en klicktävling.

Här är det annorlunda:

1. **Planering.** Alla spelare ger order till sina enheter och städer. Ingen ser vad de andra planerar.
2. **Verkställning.** När alla tryckt *Klar* körs alla order samtidigt, i sex små tidssteg (tick). Ingen får gå före.
3. **Uppspelning.** Alla ser vad som hände, steg för steg. Sedan börjar nästa planering.

Det är som ett riktigt slag: man har en plan, man vet inte vad fienden gör, och planen håller tills den möter fienden.

**Ingen tärning.** Strid är helt deterministisk. All osäkerhet kommer från vad motståndarna har beordrat. Samma order ger alltid samma utfall, vilket också gör spelet enklare att träna agenter på.

## 2. Designprinciper

- **Lätt att lära sig, svårt att bemästra.** Få enhetstyper med tydliga styrkor och svagheter. Djupet kommer från timing, position och att gissa vad andra gör.
- **Flera tidshorisonter.** Kort sikt: vart går mina trupper i den här turen? Mellan: vilken armé bygger jag? Lång sikt: växer jag mina städer och expanderar, eller satsar jag på krig nu?
- **Höjd betyder något.** Varje hexagon har sin egen höjd. Höjd påverkar förflyttning, strid och räckvidd.
- **Samma motor för människor och botar.** Spelreglerna är en ren, headless motor utan grafik. Webbklienten, servern och träningsskript använder exakt samma kod.

## 3. Verkställningen, tick för tick

En tur har sex tick. Varje enhet har en fart. Varje tick samlar enheten fartpoäng, och när den har tillräckligt för nästa hexagon på sin väg kliver den in. En ryttare (fart 3) hinner alltså före en spjutbärare (fart 2) till samma ställe, även om båda fick sin order samtidigt.

I varje tick händer detta, i den här ordningen:

1. **Befälhavarna reagerar** (se avsnitt 6). En försiktig enhet som fått fiendekontakt stannar. En anfallande enhet byter mål till närmaste fiende.
2. **Möten.** Två fiender som försöker kliva in i samma tomma hexagon drabbar samman i ett mötesslag. Två fiender som försöker byta plats med varandra möts på mitten. I båda fallen slåss de och stannar resten av turen.
3. **Förflyttning.** Enheter kliver in i tomma hexagoner, eller i hexagoner som en vän lämnar samma tick. En enhet som går in i en fiende som står kvar anfaller den.
4. **Närstrid.** Alla anfall i samma tick räknas på styrkan i början av ticket och skadan delas ut samtidigt. Dör försvararen kliver anfallaren in.
5. **Bevakning.** Bågskyttar som står i försvar skjuter på första fiende som kommer inom räckhåll.

Efter sjätte ticket skjuter övriga bågskyttar och städer sina salvor, samtidigt. Sedan grundas nya städer, städerna producerar och växer, och enheter läker.

En order som är längre än en tur fortsätter automatiskt nästa tur, tills du ändrar den.

## 4. Enheter och strid

| Enhet | Kostnad | Fart | Anfall | Försvar | Speciellt |
|---|---|---|---|---|---|
| Spjutbärare | 20 | 2 | 4 | 4 | Dubbel styrka mot ryttare |
| Bågskytt | 25 | 2 | 2 (närstrid), 4 (skott) | 2 | Skjuter 2 hexagoner bort |
| Ryttare | 30 | 3 | 5 | 3 | Snabbast |
| Nybyggare | 30 | 2 | 0 | 1 | Grundar en stad, kostar en invånare |

Det blir en enkel triangel: spjut slår ryttare, ryttare hinner ikapp och slår bågskyttar, bågskyttar skjuter sönder spjut innan de kommer fram.

**Skada.** Varje enhet har 10 i hälsa. I närstrid får båda skada: ungefär 3 gånger kvoten mellan styrkorna, mellan 1 och 10. Lika starka enheter tar alltså cirka 3 i skada var. Skadade enheter slåss sämre.

**Modifierare:**
- Högre mark: +15 % per höjdnivå över motståndaren (max +45 %). Skyttar från hög mark (2+ nivåer) når en hexagon längre.
- Skog: +25 % i försvar.
- Hållning *Försvar*: +50 % i försvar.
- I en stad: +50 % i försvar, mur ger ytterligare +50 %.
- Mötesslag: båda använder sin anfallsstyrka, ingen får försvarsbonus.

**En enhet per hexagon.** Det gör positionering viktigt och gör kollisioner tydliga.

## 5. Städer och ekonomi

- En nybyggare grundar en stad i slutet av turen. Städer måste ligga minst tre hexagoner från varandra. Om två nybyggare försöker grunda för nära varandra i samma tur misslyckas båda.
- Varje stad brukar lika många rutor som den har invånare, inom två steg. Rutorna ger mat och produktion beroende på terräng.
- Mat får staden att växa. Produktion bygger enheter eller en mur. Produktion som inte används sparas till nästa sak i kön.
- Städer har 20 i hälsa, skjuter själva (räckvidd 2) och läker varje tur. En stad utan garnison och med hälsa 0 erövras av första närstridsenhet som går in.
- **Seger:** ta alla motståndares städer. Annars vinner högst poäng efter 60 turer (städer, invånare, enheter).

## 6. Lokala befälhavare (hållningar)

Tanken är att lokala AI-befälhavare ska påverka hur slagen utspelar sig. Första versionen är enkel: varje enhet har en hållning som styr hur den reagerar på det oväntade under verkställningen, när spelaren inte kan ingripa.

- **Försiktig** (standard): följer sin väg men stannar så fort en fiende dyker upp bredvid. Anfaller bara om du uttryckligen beordrat det.
- **Anfall:** söker strid. Om en fiende står bredvid och enheten är redo att röra sig, anfaller den den svagaste.
- **Försvar:** står still med +50 % i försvar. Bågskyttar bevakar och skjuter på första fiende som kommer inom räckhåll.

Senare kan en hållning bytas mot en riktig befälhavare: en liten tränad modell eller ett skript som en spelare skriver, som får se läget varje tick och fatta beslut åt enheten.

## 7. Kartan

- Hexagoner med individuell höjd (0 till 8). Under nivå 2 är det vatten.
- Terräng: hav, grunt vatten, strand, gräs, slätt, skog, kullar, berg (oframkomligt) och snö.
- Klättring kostar extra fart. En höjdskillnad på mer än två nivåer är en klippa som inte går att passera.
- Kartan genereras från ett frö, så samma frö ger samma värld. Med två spelare är kartan punktsymmetrisk, så båda startar på exakt lika villkor.

## 8. Arkitektur

```
src/engine/   Ren TypeScript, ingen grafik: hexmatte, kartgenerator, regler, verkställning, botar
src/server/   Node: rum, turordning, sparade spel, websockets. Servern äger sanningen.
src/client/   Webbläsaren: Three.js för kartan, React för panelerna
scripts/sim   Kör tusentals bot-mot-bot-spel headless och mäter fart
scripts/gym   Ett enkelt JSON-över-stdin-protokoll så att Python-agenter kan spela
```

Motorn är en ren funktion: `verkställ(tillstånd, allas order) → nytt tillstånd + händelser`. Det gör den lätt att köra parallellt, lätt att testa och lätt att spela upp igen.

**Om CUDA:** det är för tidigt. Reglerna kommer att ändras varje vecka i början, och en GPU-version låser fast dem. Först gör vi spelet roligt med en snabb motor i TypeScript. När reglerna satt sig kan själva verkställningen skrivas om i Rust eller JAX för massiv parallell träning, med den här versionen som facit.

## 9. Första demon (det som byggs nu)

**Med:**
- Online-multiplayer för 2 till 4 spelare, via en länk. Tomma platser fylls med botar.
- Spela mot bot direkt, utan att vänta på någon.
- Hela turcykeln: planera i hemlighet, tryck *Klar*, se verkställningen spelas upp tick för tick.
- Hexkarta med höjder i 3D, fyra enhetstyper, städer, tillväxt, murar, erövring och seger.
- Fungerar på mobilen.
- En enkel bot och ett headless simuleringsskript.

**Inte med än:**
- Dimma (fog of war). Hålls utanför tills grundreglerna känns rätt, men servern skickar redan varje spelares egen vy så att det går att lägga till.
- Teknologier, diplomati, handel, väder och fysik, berättelse.
- Riktiga AI-befälhavare och tränade agenter.

## 10. Öppna frågor

1. Ska mötesslag stoppa båda enheterna resten av turen, eller bara ett tick?
2. Ska spelet ha dimma tidigt? Det gör höjd och spaning viktigare, men turerna blir mer gissning.
3. Hur långa ska turerna vara i ett spel mellan oss? Ingen tidsgräns (spela över flera dagar) eller till exempel 2 minuter?
4. Vad ska den långa horisonten handla om: teknologi, kultur, religion, eller något helt eget?
5. Vad ska spelet heta?

## 11. Hur vi jobbar

- Idéer, regeländringar och buggar samlas löpande. Ändringar byggs, testas och läggs ut på samma länk, med en kort rad om vad som är nytt.
- Den här specen uppdateras när besluten ändras, med en rad i ändringsloggen.

## Ändringslogg

- **v0.1** (12 oktober 2026): första spec.
