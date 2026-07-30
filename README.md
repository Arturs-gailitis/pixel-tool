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
- PNG, JPG, WebP vai GIF attēla imports uz 12 × 12 režģi ar automātisku objekta/svarīgākā apgabala atrašanu, adaptīvu krāsu atlasi un vairāku avota pikseļu analīzi katrai flīzei;
- maināms režģa un flīžu izmērs;
- rediģējama flīžu palete ar tipu, krāsu un simbolu;
- vairāki paslēpjami, pārsaucami un dzēšami slāņi;
- manuāli veidojami Prism Pop! `containers` ar krāsu, ietilpību, kolonnu un rindu;
- undo/redo un automātisks lokālais melnraksts pārlūkā;
- līmeņa validācija, priekšskatījums, JSON imports un eksports;
- peles, skārienekrāna un tastatūras saīsņu atbalsts.

## Prism Pop! JSON formāts

Eksports izmanto tādu pašu kolekcijas struktūru kā `all-levels.json`. Redaktorā izveidotais
līmenis tiek ievietots `levels` masīvā, tādēļ jaunā faila `count` ir `1`.

```json
{
  "game": "Prism Pop!",
  "exported": "2026-07-30",
  "count": 1,
  "levels": [
    {
      "slot": 19,
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
