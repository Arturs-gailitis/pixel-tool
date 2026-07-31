# Pixel Level Tool

Patstāvīgs pārlūkprogrammas redaktors 2D flīžu spēļu līmeņu veidošanai un eksportēšanai uz JSON.

## Palaišana

Nepieciešams Node.js 18 vai jaunāks.

```powershell
npm start
```

Atver `http://localhost:8974`. Windows vidē var arī palaist `start-editor.bat`.

## Iespējas

- zīmēšana ar otu, dzēšgumiju, laukuma aizpildīšanu un krāsas/flīzes paņemšanu;
- PNG, JPG, WebP vai GIF attēla imports uz 12 × 12 režģi ar objekta/svarīgākā apgabala atrašanu, adaptīvu krāsu atlasi un pārklājuma analīzi, kas saglabā silueta līknes un plānās detaļas;
- maināms režģa un flīžu izmērs;
- rediģējama flīžu palete ar tipu, krāsu un simbolu;
- vairāki paslēpjami, pārsaucami un dzēšami slāņi;
- manuāli veidojami Prism Pop! `containers` ar krāsu, ietilpību, kolonnu un rindu;
- `mystery` objekta veidošana ar `proportion`, `revealAt` un paletes krāsu `exclude` izvēli;
- `thick`, nosauktu `regions` un `shutters` (`covers`/`key`) veidošana un JSON validācija;
- attēla importa 12 × 12 priekšskatījums ar Auto, objekta/logo, fotogrāfijas un pilnā attēla režīmiem;
- lietotāja izvēlēts 2–10 krāsu mērķis, kas saglabā dominējošās krāsas, starptoņus un atšķirīgus akcentus;
- undo/redo un automātisks lokālais melnraksts pārlūkā;
- līmeņu saraksts ar pārslēgšanos starp visiem importētajiem līmeņiem, validācija, priekšskatījums, JSON imports un eksports;
- pašas Prism Pop! spēles simulatorā balstīta automātiska grūtība (`Easy`, `Medium`, `Hard`, `Brutal`, `Fragile`, `Unwinnable`, `Broken`) ar `casual`, `careful`, `patient`, `drainer` un 24 seed `random fleet` izspēlēm;
- publicēšanas vārti HP paritātei un nestabiliem rezultātiem; iespējami negodīgi `shutter`/`mystery` slazdi tiek rādīti kā brīdinājumi; vienas krāsas trauku virknes garums kolonnā ir atļauts;
- peles, skārienekrāna un tastatūras saīsņu atbalsts.

## Grūtības sertifikācija

Redaktors grūtību neaprēķina pēc režģa izmēra vai mehāniku skaita. Serveris katras pārbaudes
laikā nolasa Prism Pop! `index.html`, izvelk spēles `createSim`, `runPolicy` un četras spēlētāja
politikas un izspēlē līmeni ar tieši tiem pašiem noteikumiem, kurus izmanto spēle.

Spēles mape tiek meklēta šādā secībā:

1. `VITRAZA_DIR` vides mainīgajā;
2. šī projekta `game/index.html`;
3. blakus esošajā `../prism-pop-level-tool/game/index.html`.

Ja spēles avots vai izvilkšanas marķieri nav atrodami, pārbaude apstājas ar kļūdu un grūtība
netiek minēta ar rezerves formulu. Kategoriju kāpnes atbilst etalona README:

- `Easy`: casual uzvar un random fleet uzvaru īpatsvars ir vismaz 0.30;
- `Medium`: casual uzvar, bet random fleet īpatsvars ir zem 0.30;
- `Hard`: casual zaudē un uzvar vismaz divas prasmīgās politikas;
- `Brutal`: casual zaudē un uzvar tikai viena prasmīgā politika;
- `Fragile`: uzvara gadās, bet neuzvar neviena prasmīgā politika, vai spēles paletes likums liedz publicēšanu;
- `Unwinnable`: neuzvar neviena politika un neviens random fleet spēlētājs;
- `Broken`: līmeņa dati vai HP/ietilpības paritāte ir nederīga.

Publicējamība tiek vērtēta atsevišķi no kategorijas. Vismaz vienai no `careful`, `patient` vai
`drainer` politikām jāuzvar, un līmenim jāiztur visi statiskie likumi, tostarp HP paritāte.
Trauks ar ietilpību `1` un gara vienas krāsas trauku virkne kolonnā ir atļauti, ja paritāte ir korekta.

## Prism Pop! JSON formāts

Eksports izmanto tādu pašu kolekcijas struktūru kā `all-levels.json`. Importējot kolekciju,
visi tās līmeņi ir redzami sadaļā **Visi līmeņi**, un eksports saglabā tos vienā `levels` masīvā.
Ja nav importēts JSON fails, poga **Jauns** sāk tukšu projektu ar slotu `1`.
Poga **Pievienot līmeni** pievieno nākamo slotu pašreizējai kolekcijai; **Jauns** notīra visu
pašreizējo kolekciju un sāk jaunu JSON failu.

```json
{
  "game": "Prism Pop!",
  "exported": "2026-07-30",
  "count": 1,
  "levels": [
    {
      "slot": 1,
      "name": "Mans līmenis",
      "tier": "Medium",
      "source": "tool",
      "grid": ["KKKK", "KRGK", "KKKK"],
      "palette": {
        "K": "#262B44",
        "R": "#A96B3E",
        "G": "#3FC155"
      },
      "containers": [
        { "c": "K", "cap": 8, "r": 0, "col": 0 }
      ],
      "links": [],
      "mystery": null,
      "thick": null,
      "regions": null,
      "shutters": null,
      "beltCap": 24,
      "seed": 19001,
      "fillRule": "gravity"
    }
  ]
}
```

Redaktora slāņi eksportā tiek saplacināti vienā `grid`. Tukšas šūnas kļūst par tumšā fona
krāsu `K`. Katrai flīzei paletes dialogā ir unikāls vienas rakstzīmes JSON kods.
`containers` tiek automātiski sadalīti pa 2–8 pērlēm un četrām kolonnām tā, lai to kopējā
ietilpība katrai krāsai sakristu ar attiecīgās krāsas šūnu skaitu režģī.

Var importēt gan viena līmeņa objektu, gan pilnu `all-levels.json`. Ja kolekcijā ir vairāki
līmeņi, redaktors palūgs izvēlēties importējamo slotu.
