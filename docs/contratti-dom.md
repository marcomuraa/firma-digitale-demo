# Contratti del DOM — fissati prima del fan-out della fase 5

`docs/contratti-ui.md` fissa la forma dei ViewModel. Questo documento fissa la forma dei **ganci
nel DOM**: gli attributi con cui una pagina si lascia pilotare e misurare dall'esterno.

Perché serve, e perché adesso. Le due direzioni visive sono libere di essere diverse in tutto —
layout, colore, tipografia, ordine — ma **tre lettori non umani** devono poterle percorrere
entrambe senza sapere quale hanno davanti:

- `scripts/anteprima/anteprima.mjs`, che le costruisce, le pilota e ne scatta le schermate;
- i critici di design, che devono portare la pagina agli stati chiave per misurarli;
- la fase 5b (narrazione) e la fase 6 (collaudo end-to-end), che arrivano dopo e non possono
  chiedere a nessuno com'è fatto il markup.

Senza questo elenco ogni direzione inventa i propri agganci, e ogni strumento va scritto due volte.

**Questo documento non dice come deve apparire niente.** Dice solo dove si attacca la pinza.

---

## 1. La macchina, esposta

```js
window.__demo = createDemo()   // la stessa istanza che pilota la pagina, non una copia
```

Una riga, in ognuna delle due entry. È il gancio più importante: permette di portare la demo a
uno stato preciso senza dipendere da come quella direzione ha disegnato i suoi bottoni.

```js
await window.__demo.run('firma')      // esegue un passo
window.__demo.getState().verdetto     // legge lo stato
window.__demo.restoreSigned()         // torna al firmato integro
```

## 2. Marcatori su `<body>`

I primi cinque esistono già dalla fase 1 e li scrive `src/entries/marcatori.js`:
`scripts/build/check-selfcontained.mjs` fallisce se mancano o se sbagliano valore.

| Attributo | Valori | Chi lo scrive |
|---|---|---|
| `data-boot` | `ok` | marcatori.js, al boot |
| `data-direzione` | `protocollo` · `doppia-esposizione` | marcatori.js |
| `data-narrato` | `si` · `no` | marcatori.js, da `__NARRATED__` |
| `data-variante` | `<direzione>` o `<direzione>-narrato` | marcatori.js |
| `data-asset-inline` | `ok` · `ko` | marcatori.js |
| `data-narrazione` | sentinella della fase 5b | narration-placeholder.js |

I tre che aggiunge la fase 5, scritti dalla direzione a ogni cambio di stato:

| Attributo | Valori | Significato |
|---|---|---|
| `data-modalita` | `presentazione` · `studio` | la modalità attiva; **è la classe/attributo su cui il CSS commuta** |
| `data-passo-corrente` | uno `stepId`, oppure `''` | l'ultimo passo eseguito |
| `data-verdetto` | `valid` · `extended` · `invalid` · `''` | l'ultimo esito di `verify()`, vuoto se non c'è ancora |

`data-modalita` è l'unico di cui il prompt di fase 5 impone anche l'uso stilistico: la doppia
modalità si commuta con un attributo sul `<body>`, non con due fogli di stile.

## 3. Agganci sugli elementi

| Selettore | Su che cosa | Perché serve |
|---|---|---|
| `[data-passo="<stepId>"]` | il comando che esegue quel passo | percorrere la demo cliccando davvero |
| `[data-azione="ripristina"]` | il comando che richiama `restoreSigned()` | fra un attacco e l'altro |
| `[data-azione="reset"]` | il comando che richiama `reset()` | ricominciare |
| `[data-azione="modalita"]` | l'interruttore presentazione/studio | misurare i corpi nelle due modalità |
| `[data-pannello="<panelId>"]` | il pannello di quel contenuto | contarli, vederli impilarsi, aprirli |
| `[data-righello]` | il contenitore del righello dei byte | l'elemento firma condiviso |
| `[data-segmento="<segment.id>"]` | ogni segmento del righello | verificare che la copertura sia disegnata dov'è |
| `[data-canvas-pdf]` | il `<canvas>` in cui pdf.js disegna | provare che il documento è cambiato davvero |

Gli `stepId` e i `panelId` sono quelli di `src/ui/steps.js`: nessun nome inventato.

I comandi devono essere elementi **realmente attivabili da tastiera** — `<button>`, o qualcosa che
si comporti come tale. Un `<div>` con un gestore di click non soddisfa questo contratto, e non è un
dettaglio di accessibilità: un critico che percorre la pagina con Tab non lo raggiunge.

## 4. Che cosa NON è fissato qui

Tutto il resto: numero e ordine dei pannelli in pagina, gerarchia dei titoli, dove sta il righello,
come si aprono hex e ASN.1, quali comandi sono visibili insieme, che aspetto ha un verdetto. Le due
direzioni divergono, ed è il punto: se convergessero, non sarebbero due direzioni.
