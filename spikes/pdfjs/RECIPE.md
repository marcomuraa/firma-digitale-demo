# Ricetta: pdf.js dentro un HTML singolo che apre da `file://`

**Risposta alla domanda dello spike: si, funziona.** Un singolo HTML autoconsistente aperto da
`file://` renderizza pagina 1 su canvas con zero richieste di rete. Verificato in Chrome
151.0.7922.108, headless e con finestra vera, con pdf.js 6.2.108 e Vite 8.2.1.

Prova: `spikes/pdfjs/dist/spike.html` (1.649.167 byte, un solo file). Aperto da `file://`,
il browser emette **una sola** richiesta — il documento stesso — e la pagina scrive nel DOM:

```
data-esito: ok
canvas 892x1263 · pixelNonBianchi 7794 · pixelBandaTesto 6153 · pixelBandaVettoriale 1641
testoEstratto "SPIKE PDFJS TIMES ROMANImporto di prova: 1.000 euro (mille euro)"
urlFontEsterni []  ·  richiesteDiRete []  ·  msTotali 45
```

`pixelBandaTesto` conta i pixel accesi in una fascia che contiene **solo** testo Times-Roman non
incorporato: e' la prova che i glifi sono stati rasterizzati davvero, non che c'e' un rettangolo
grigio da qualche parte.

---

## 1. La ricetta da copiare

Tre pezzi. Copiali cosi come sono.

### 1.1 Il worker: non esiste

```js
// PRIMA di pdf.mjs: il modulo worker entra nel bundle principale.
import { WorkerMessageHandler } from 'pdfjs-dist/build/pdf.worker.mjs';
import * as pdfjs from 'pdfjs-dist/build/pdf.mjs';

// Con questa riga PDFWorker usa il "fake worker" sul thread principale:
// niente workerSrc, niente new Worker(), niente import() dinamico.
globalThis.pdfjsWorker = { WorkerMessageHandler };
```

Nient'altro. Non impostare `GlobalWorkerOptions.workerSrc`, non impostare
`GlobalWorkerOptions.workerPort`. pdf.js stampa `Warning: Setting up fake worker.` ed e' il
comportamento voluto, non un problema da zittire.

### 1.2 Gli asset binari: dalla pagina, mai dalla rete

```js
import { STANDARD_FONTS } from './standard-fonts.js'; // { 'FoxitSerif.pfb': '<base64>' }

class InlineBinaryDataFactory {
  async fetch({ kind, filename }) {
    if (kind === 'standardFontDataUrl' && STANDARD_FONTS[filename]) {
      return base64ToBytes(STANDARD_FONTS[filename]);
    }
    throw new Error(`asset non inlineato: ${kind}/${filename}`);
  }
}
```

`standard-fonts.js` si genera cosi (il file e' gia in `spikes/pdfjs/src/`, rigeneralo se serve):

```js
const b = readFileSync('node_modules/pdfjs-dist/standard_fonts/FoxitSerif.pfb');
// export const STANDARD_FONTS = { 'FoxitSerif.pfb': '<b.toString("base64")>' };
```

### 1.3 Le opzioni di `getDocument`

```js
const doc = await pdfjs.getDocument({
  data: bytesDelPdf,          // Uint8Array; pdf.js ne prende possesso, passa una copia
  cMapUrl: null,              // devono restare null: vedi trappola 3
  standardFontDataUrl: null,
  wasmUrl: null,
  iccUrl: null,
  useWorkerFetch: false,
  useSystemFonts: false,                       // vedi sezione 3
  BinaryDataFactory: InlineBinaryDataFactory,  // serve i font gia in pagina
  stopAtErrors: false,
  verbosity: 1,               // gli avvisi servono: sono materiale didattico
}).promise;

const page = await doc.getPage(1);
const viewport = page.getViewport({ scale: 1.5 });
canvas.width = Math.floor(viewport.width);
canvas.height = Math.floor(viewport.height);
await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
```

`canvasContext` e' ancora un parametro di prima classe in 6.2.108, nessuna deprecazione.

### 1.4 La configurazione Vite

```js
plugins: [viteSingleFile({ removeViteModuleLoader: true })],
build: {
  assetsInlineLimit: 100 * 1024 * 1024,
  cssCodeSplit: false,
  chunkSizeWarningLimit: 100000,   // altrimenti 1,6 MB genera un muro di avvisi
}
```

**Costruisci una entry per volta.** Con piu' entry nello stesso `rollupOptions.input` rollup crea
chunk condivisi e l'inlining va verificato caso per caso; con una entry per build il risultato e'
sempre un file solo. Le quattro pagine del progetto sono quattro build.

---

## 2. Le strade scartate, e perche'

Tutte misurate, ognuna ripetuta 3 volte, esito identico ogni volta.
`spikes/pdfjs/verify-all.sh` ricostruisce la tabella.

| Variante | Come carica il worker | Esito da `file://` |
|---|---|---|
| **B — `spike-b.html`** | nessun worker, fake worker sul thread principale | **ok** |
| **F / definitiva — `spike.html`** | come B, piu' font base-14 inlineati | **ok** |
| C — `spike-c.html` | come B ma con `pdfjs-dist/legacy/build/*` | ok, ma +102 KB inutili |
| A/iife — `spike-a-iife.html` | Vite `?worker&inline`, `worker.format: 'iife'` → worker **classico** da `blob:` | ok |
| D — `spike-d.html` | worker **modulo** da `data:text/javascript;base64,` | ok, ma +81 KB e ~640 ms contro 45 |
| **A/es — `spike-a-es.html`** | Vite `?worker&inline`, `worker.format: 'es'` → worker **modulo** da `blob:` | **fallisce** |
| **E — `spike-e.html`** | worker **modulo** da `blob:` costruito a mano | **fallisce** |

Il messaggio che Chrome scrive sulle due varianti che falliscono:

```
[error] Refused to cross-origin redirects of the top-level worker script.
```

La regola empirica che ne esce, da un documento `file://` (origine opaca, `blob:null/...`):

- worker **modulo** da `blob:` → **rifiutato**;
- worker **classico** da `blob:` → accettato;
- worker **modulo** da `data:` → accettato.

Quindi il sospetto iniziale era **meta' vero**: `?worker&inline` funziona, ma solo con
`worker.format: 'iife'`. Il default di Vite per un progetto ESM e' `'es'`, ed e' proprio quello
che Chrome rifiuta.

**Perche' scartiamo comunque il worker vero.** Non perche' non funzioni, ma perche' non paga:

1. **Costa 4.372 byte in piu'** e non fa risparmiare nulla: il codice del worker sta nel bundle in
   entrambi i casi, e' l'intero motore di pdf.js.
2. **Non serve.** Il PDF campione e' ~1,5 KB, una pagina: il render impiega ~45 ms sul thread
   principale, e la demo lo rifa' a ogni attacco. Non c'e' niente da liberare.
3. **Il modo di fallire e' pessimo.** Impostare `GlobalWorkerOptions.workerPort` **disattiva** il
   ripiego automatico di pdf.js sul fake worker (`#initializeFromPort` non ha nessun `catch`). Se
   il browser rifiuta il worker, `getDocument().promise` **non si risolve e non viene rifiutata**:
   la pagina resta ferma per sempre, senza eccezioni e senza errori in console tranne quella riga
   di Chrome. Su un proiettore, davanti a una sala, e' il peggior modo possibile di rompersi.
4. **Dipende da una politica del browser** che vale per Chrome oggi e che nessuno ci garantisce su
   Safari o Firefox aperti da `file://`. La strada B non ha nessuna politica da rispettare: non
   crea nessun worker.

Sulla **build legacy** (variante C): funziona, ma trascina core-js (+102.512 byte) e con esso una
dozzina di stringhe `https://...` usate come casi di prova del polyfill di `URL`, che fanno
scattare un controllo statico di autoconsistenza. Chrome 151 non ha bisogno di nessun polyfill.
Usa la build moderna.

---

## 3. I font base-14 — il punto critico

Il PDF campione dichiara `/BaseFont /Times-Roman` **senza incorporarlo**. La domanda era: pdf.js
prova a scaricare i dati del font da un URL?

**Risposta: no, in nessuna delle configurazioni provate.** Verificato tre volte: la sentinella in
pagina non registra nessuna `fetch`, il controllo sui `@font-face` iniettati non trova nessun
`url()` non-`data:`, e il browser via DevTools Protocol vede **una sola** richiesta, il documento.

Il perche' sta in `node_modules/pdfjs-dist/build/pdf.worker.mjs`:

- con `useSystemFonts: true` (il default nel browser) `fetchStandardFontData()` esce subito con
  `return null` per ogni font che non sia `Symbol` o `ZapfDingbats`, e pdf.js costruisce un
  `@font-face` di sostituzione con solo sorgenti `local(...)`;
- nella tabella `substitutionMap`, la voce `Times-Roman` ha `local: [...]` e `ultimate: "serif"`
  ma **non ha `path`**. Solo le quattro voci Helvetica hanno un `path`
  (`LiberationSans-*.ttf`), ed e' l'unico caso in cui pdf.js emette un
  `url(${standardFontDataUrl}...)`. **Times-Roman non ne emette mai.**

Restano tre configurazioni utilizzabili, tutte senza rete:

| Configurazione | Cosa disegna | Costo | Pagina di prova |
|---|---|---|---|
| `useSystemFonts: true` (default) | `@font-face` con `local("Times New Roman"), local("Times"), … , serif` | 0 | `spike-b.html` |
| `useSystemFonts: false` **senza** font inlineati | nessun `@font-face`, ripiego sul `serif` di sistema; avvisa `Ensure that the standardFontDataUrl API parameter is provided` | 0 | `spike-g.html` |
| **`useSystemFonts: false` + `BinaryDataFactory`** | il vero Foxit Serif, byte per byte | **+26.288** | `spike.html`, `spike-f.html` |

**Prendi la terza.** Le prime due disegnano con il font del sistema: sulla macchina di sviluppo
esce Times New Roman e va benissimo, su una macchina senza quel font esce un serif qualsiasi.
Le metriche restano giuste in ogni caso — le larghezze vengono dal PDF, non dal font — ma per
26 KB su 1,6 MB (l'1,6 %) il documento a schermo diventa **identico ovunque**, e in una demo in
cui il punto e' «guarda che il documento e' cambiato» avere un rendering deterministico vale il
prezzo. Il numero di pixel accesi lo dimostra: 6.153 con il Foxit inlineato contro 6.097 con il
font di sistema — sono due disegni diversi.

**Se in futuro il PDF usasse altri font base-14**, aggiungi la riga corrispondente a
`standard-fonts.js` (mappa presa da `getFontNameToFileMap()` nel worker):

| `/BaseFont` | file | byte | base64 |
|---|---|---|---|
| `Times-Roman` | `FoxitSerif.pfb` | 19.469 | 25.960 |
| `Times-Bold` | `FoxitSerifBold.pfb` | 19.395 | 25.860 |
| `Times-Italic` | `FoxitSerifItalic.pfb` | 21.227 | 28.304 |
| `Times-BoldItalic` | `FoxitSerifBoldItalic.pfb` | 20.733 | 27.644 |
| `Helvetica*` | `LiberationSans-*.ttf` | 135–162 K | 180–216 K |
| `Courier*` | `FoxitFixed*.pfb` | ~18 K | ~24 K |
| `Symbol` / `ZapfDingbats` | `FoxitSymbol.pfb` / `FoxitDingbats.pfb` | 16,7 K / 29,5 K | 22 K / 39 K |

Un font mancante **non rompe niente**: `InlineBinaryDataFactory` lancia, pdf.js registra un avviso
e ripiega sul serif di sistema (e' esattamente il caso `spike-g.html`).

**CMap e wasm non servono.** Le CMap predefinite riguardano i font CID, che il PDF campione non
usa. Il wasm (`jbig2`, `openjpeg`, `qcms`) viene caricato pigramente solo per immagini JBIG2/JPEG2000
e profili ICC: con `wasmUrl: null` pdf.js si limita a
`warn("No ICC color space support due to missing wasmUrl API option")` e non tenta nessun caricamento.
Non inlinearli: sarebbero 1,5 MB per niente.

---

## 4. Il costo in byte

Misurato con `spikes/pdfjs/misura-byte.sh` (rimisura tutto da zero).

| Contenuto | Bundle JS grezzo | File singolo | gzip |
|---|---|---|---|
| solo API `pdf.mjs` (sonda, non renderizza) | 427.982 | 428.035 | 126.567 |
| API + modulo worker = **ricetta senza font** | 1.622.134 | 1.622.879 | 494.437 |
| **ricetta definitiva** (+ Foxit Serif) | 1.648.422 | **1.649.167** | 514.609 |

Scomposizione utile alla fase 5:

- API di pdf.js: **~428 KB**
- motore (`pdf.worker.mjs`, obbligatorio, e' il parser+renderer): **~1.194 KB**
- font base-14 Times-Roman in base64: **+26 KB**
- il PDF campione da 741 byte in base64: **+988 byte**

**L'inlining non costa il 33 % di base64.** `vite-plugin-singlefile` incolla il JS come testo
dentro un `<script type="module">`: dal bundle grezzo al file singolo si passa da 1.648.422 a
1.649.167, cioe' **+745 byte**, che sono lo scheletro HTML. La penale del base64 la pagano solo
gli asset **binari** che inliniamo noi (il PDF e il font), e nel conto sopra e' gia inclusa.

**Segnalazione per la fase 5 e per il piano.** Il piano stima ~2,5 MB per file non narrato: pdf.js
da solo ne occupa **1,65 MB**, quindi restano ~850 KB per WebCrypto/PKI.js/asn1js/pdf-lib/@signpdf,
CSS, copy e viste. E' stretto ma plausibile. Le quattro pagine sommate fanno **~6,6 MB** di solo
pdf.js, replicato quattro volte: se il peso complessivo diventasse un problema, l'unica leva vera e'
ridurre il numero di file, non il renderer.

---

## 5. Trappole note

1. **`workerPort` toglie la rete di sicurezza.** Con `GlobalWorkerOptions.workerPort` impostato,
   pdf.js non ripiega piu' sul fake worker: un worker rifiutato = promise appesa per sempre.
   Se per qualunque ragione si tornasse a un worker vero, mettere **sempre** un timeout attorno a
   `getDocument().promise` (in questo spike: `withTimeout` in `src/harness.js`).
2. **Il `try/catch` di Vite attorno al worker inline non protegge da niente.** Il fallback su
   `data:` scatta solo se `new Worker()` **lancia**; Chrome invece accetta la costruzione e fallisce
   dopo, con un evento `error`. Il ripiego non parte mai.
3. **`cMapUrl`/`standardFontDataUrl`/`wasmUrl` vanno passati `null`, non `''` e non un percorso
   senza slash finale.** `getFactoryUrlProp()` lancia
   `Invalid factory url: "…" must include trailing slash.`
4. **`isEvalSupported` non esiste piu' in pdf.js 6.x.** Passarlo e' un no-op silenzioso. Non
   contarci per irrigidire la pagina: non fa niente.
5. **`useWorkerFetch` si calcola da solo** e vale `false` quando gli URL sono `null`, ma passalo
   esplicito: rende evidente l'intenzione a chi legge.
6. **Non importare il worker con `?raw`.** Costa +81 KB rispetto all'import del modulo (le sequenze
   di escape della stringa) e obbliga a usare un worker vero.
7. **`chunkSizeWarningLimit`**: senza alzarlo, ogni build sputa un avviso su 1,6 MB e nasconde gli
   avvisi veri.
8. **`getImageData` vuole `willReadFrequently: true`** sul contesto, altrimenti Chrome avvisa. Serve
   solo se la pagina rilegge i pixel (qui lo fa per contarli); la demo vera probabilmente non ne ha
   bisogno.
9. **Non fidarsi di `--dump-dom` con `--virtual-time-budget`** per giudicare un worker vero: il
   tempo virtuale affama il worker e un ritardo diventa indistinguibile da un blocco. Nelle prime
   misure di questo spike due varianti **funzionanti** risultavano fallite per questo motivo.
   `spikes/pdfjs/cdp-run.mjs` pilota Chrome via DevTools Protocol a tempo reale e conta le richieste
   di rete viste dal browser: e' quello lo strumento da usare.

---

## 6. Fuori tema ma importante: l'attacco 1b non fa quello che il piano dice

Il piano (riga «Attacco 1b») da' per scontato che allungando `mille` → `novemila` il `/Length` e
l'`xref` diventino incoerenti e **pdf.js si rifiuti di renderizzare**. Ho misurato: non e' vero.

`spikes/pdfjs/dist/spike-i.html` prova i tre file uno dopo l'altro. Esito:

| Caso | Renderizza | Testo estratto | Avviso di pdf.js |
|---|---|---|---|
| originale | si | `… 1.000 euro (mille euro)` | — |
| 1a, cifra falsificata a lunghezza invariata | si | `… 9.000 euro (mille euro)` | nessuno |
| 1b, `mille`→`novemila`, +3 byte | **si** | `… 1.000 euro (novemila euro)` | `Warning: Indexing all PDF objects` |

pdf.js e' deliberatamente tollerante: quando l'`xref` non torna **ricostruisce la tabella** scandendo
tutto il file, e disegna il documento falsificato senza battere ciglio. E' il comportamento giusto
per un lettore di PDF del mondo reale, ed e' incompatibile con la battuta narrativa «per falsificare
bene non basta cambiare il testo, bisogna riparare il file».

La parte crittografica di 1b regge (i byte sono cambiati, la firma va a ❌). Quello che non regge e'
il beat visivo. **Non e' una modifica che posso fare io** — tocca il piano e i testi, fuori dal mio
perimetro — quindi la riporto e basta. Due uscite possibili, a scelta di chi decide:

- **riscrivere il beat**: l'appiglio onesto e' l'avviso `Indexing all PDF objects`, che si puo'
  intercettare e mostrare come «il lettore ha dovuto riparare il file per aprirlo». Racconta la
  stessa morale con un fatto vero;
- **tagliare 1b**, come il piano stesso prevede («se lo scope stringe, questo e' il primo pezzo da
  tagliare»).

---

## 7. Come rifare le verifiche

Dalla radice del progetto:

```sh
./spikes/pdfjs/build-all.sh      # rigenera il PDF di prova e costruisce tutte le varianti
./spikes/pdfjs/verify-all.sh 3   # ognuna 3 volte in Chrome headless a tempo reale, via CDP
./spikes/pdfjs/misura-byte.sh    # tabella dei byte: bundle grezzo, file singolo, gzip

node spikes/pdfjs/cdp-run.mjs dist/spike.html             # una sola pagina, esito completo
node spikes/pdfjs/cdp-run.mjs dist/spike.html --headful   # stessa cosa con una finestra vera
node spikes/pdfjs/check-offline.mjs spikes/pdfjs/dist/spike.html   # controllo statico
./spikes/pdfjs/run-headless.sh dist/spike.html            # la via rapida con --dump-dom
```

`check-offline.mjs` cerca URL assolute e attributi `src`/`href` esterni. Le URL ammesse sono
elencate una per una nel file con il motivo: sono namespace XML, basi fittizie passate a
`new URL()` dal parser dei link delle annotazioni, e intestazioni di licenza. Nessuna finisce in
una `fetch`, in un `src` o in un `href`. Su `spike.html`: **0 URL non ammesse, 0 attributi esterni**.

### Cosa c'e' in questa cartella

| File | A cosa serve |
|---|---|
| `src/main.js` | **la ricetta definitiva**, e' questo il codice da copiare |
| `src/harness.js` | banco di prova condiviso: render, conteggio pixel, timeout, esito nel DOM |
| `src/sentinel.js` | intercetta `fetch`/XHR/`Worker` e la console prima che pdf.js parta |
| `src/main-a.js` … `main-i.js` | le varianti confrontate nella sezione 2 |
| `src/standard-fonts.js` | Foxit Serif in base64 (generato) |
| `src/sample-pdf.js` | il PDF di prova in base64 (generato) |
| `make-sample-pdf.mjs` | scrive `sample.pdf`: 741 byte, ASCII, Times-Roman non incorporato |
| `cdp-run.mjs` | driver Chrome via DevTools Protocol, tempo reale, conta le richieste |
| `check-offline.mjs` | controllo statico di autoconsistenza |
| `build-all.sh` `verify-all.sh` `misura-byte.sh` `run-headless.sh` | gli script sopra |
| `extract-esito.py` | estrae il blocco `#esito` dal DOM stampato da `--dump-dom` |
| `dist/spike.html` | **la prova richiesta**: un file, apre da `file://`, renderizza, si giudica da solo |
