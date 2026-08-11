# Stato dei lavori — 11 agosto 2026

Il lavoro prosegue in **sessioni separate**: i prompt da eseguire, uno per sessione, stanno in
`docs/prompt/`. Leggi `docs/prompt/README.md` per l'ordine e per cosa può girare in parallelo.

Quanto segue è **verificato, non dichiarato**: ogni numero viene da un comando eseguito.

```
npm test        303 test, 303 verdi, 0 rossi     (16 file, 5,4 s)
npm run build   verde, quattro file in dist/, autoconsistenza controllata con Chrome headless
                protocollo 2.156.993 · protocollo-narrato 2.157.795
                doppia-esposizione 2.169.217 · doppia-esposizione-narrata 2.170.019
```

---

## Fatto

**Il PDF campione** — `src/assets/sample.pdf`, 1285 byte, ASCII puro, PDF 1.7 scritto a mano.
`npm run pdf:validate` esce 0 su dodici sezioni di controllo, riscontro con poppler compreso.

```
sha256        8eb0f906ed51563c81f354f818e12dd3d561ff703fc4bb7d2b391b5e61e507a1
/Length       650 (dati 286..936)
riga importo  offset 576  (16 * 36)
cifra 1 -> 9  offset 577
"mille"       offset 589..594
xref          offset 1026, startxref 1026
```

Offset congelati in `src/assets/sample-offsets.json`, mappa annotata in `docs/pdf-campione.md`.

**Il motore** — `src/core/`: `bytes` `keys` `certificate` `cms` `pades` `attacks` `verify`.
Firma PAdES vera, verificata da strumenti terzi che non sanno niente di questo progetto:

- `openssl cms -verify` → *CMS Verification successful*; sul file con il byte 577 ribaltato → *verification failure* (exit 4);
- `openssl asn1parse` → `id-smime-aa-signingCertificateV2` fra gli attributi firmati, quindi `signing-certificate-v2` è ben formato;
- `pdfsig` → firma valida, emittente non fidato (è autofirmato, ed è previsto).

**Le viste** — `src/views/`: `hex-view` `asn1-view` `byte-ruler`. ViewModel puri, nessun DOM.

**I testi** — `src/ui/`: `copy.it.js` (15 pannelli), `script.it.js` (12 segmenti parlati),
`steps.js` (unica sorgente degli identificatori).

**Lo scaffold** — `vite.config.js`, `src/entries/`, `scripts/build/`. Quattro build separate,
`vite-plugin-singlefile`, flag di compilazione `__NARRATED__`.

**La sonda vocale** — `narration-probe/`. Voce decisa: `say -v Alice` di macOS, 160 parole al
minuto. Kokoro scartato dopo l'ascolto, modelli cancellati.

**La fase 5 è chiusa: le due direzioni visive esistono, e la demo si percorre per intero.**

`src/ui/machine.js` — la macchina a stati, senza un solo accesso al DOM, provata in node dai
dodici passi veri. Documenta in cima la forma dello stato: è il contratto su cui le due direzioni
sono state costruite in parallelo. Due invarianti che hanno deciso la forma di tutto il resto: i
pannelli **si impilano e non si cancellano** (i risultati per passo sono congelati e nessun passo
successivo li riscrive), e **niente esplode** — un passo fuori sequenza mette in stato d'errore una
frase in italiano e la demo resta navigabile. `restoreSigned()` non tocca la storia; `reset()` la
cancella. Il righello dei byte lo calcola **la macchina**, con `buildRuler`, e lo mette nello stato:
se lo calcolassero le due pagine, i suoi ingressi divergerebbero.

`src/ui/pdf-render.js` — il ponte verso pdf.js, uno solo per tutto il progetto, copiato alla lettera
da `spikes/pdfjs/RECIPE.md`. Non lancia mai: un PDF rotto torna `{ ok:false, error }` in italiano.
Raccoglie anche gli **avvisi** di pdf.js, perché `Indexing all PDF objects` è l'appiglio onesto del
passo 1b (vedi punto 2 qui sopra) e la pagina lo mostra.

`src/design/protocollo/` e `src/design/doppia/` — le due direzioni, ognuna con la sua critica
indipendente e due giri di riparazioni misurate. Percorse per intero sui file di `dist/`: dodici
passi, quindici pannelli, verdetti `valid → invalid → valid → invalid → valid → extended`, zero
eccezioni, zero richieste di rete, e in console i due soli avvisi previsti.

**Strumenti nuovi, che servono a chi arriva dopo:**

- `scripts/anteprima/anteprima.mjs` — costruisce **una** entry in una cartella propria, la apre da
  `file://` in Chrome headless, la **pilota** via DevTools Protocol e scatta. Serve perché
  `npm run build` svuota `dist/`, quindi due sessioni parallele si cancellerebbero il lavoro; e
  perché Chrome con `--screenshot` scrive il PNG e poi non esce. `--aiuto` spiega i copioni.
- `scripts/anteprima/copioni/demo-intera.json` — percorre la demo pilotando `window.__demo`, quindi
  vale per tutte e due le direzioni.
- `scripts/anteprima/copioni/regressioni-doppia.json` — gli invarianti della direzione C che node
  non può vedere. **Non è dentro `npm test`**: costa 20 s e un browser. Si lancia a mano.
- `docs/contratti-dom.md` — i ganci nel DOM, fissati prima del fan-out: `window.__demo`, i
  marcatori su `<body>`, `[data-passo]`, `[data-pannello]`, `[data-righello]`, `[data-canvas-pdf]`.

---

## Da fare

Vedi `docs/prompt/`: 5b (narrazione), 6b (pannelli delle vulnerabilità), 6 (collaudo finale).

**Attenzione, un pezzo è senza prompt.** `docs/prompt/02-narrazione-audio.md` copre solo la
*generazione* dell'audio e vieta esplicitamente di scrivere `src/ui/narrator.js`, perché quando fu
scritto la macchina a stati non esisteva. Adesso esiste. Chi esegue la 5b così com'è si ritrova con
dodici file `.opus` e niente che li suoni: il driver che lega i segmenti ai passi va assegnato.

**Oggi le due varianti narrate non suonano, e non è un guasto: l'audio non c'è.** Non esistono
`scripts/narration/`, `src/assets/narrazione/` né `src/ui/narrator.js`; fra un file muto e il suo
narrato ballano **802 byte**, cioè il segnaposto minificato e nient'altro (cinque minuti di Opus a
32 kbps sarebbero ~1,6 MB in base64). Il gancio `if (__NARRATED__)` è intatto e viene eseguito.
Nota che `npm run build:check` dice «narrazione presente» controllando **solo** l'attributo
sentinella: quel verde non è una prova che ci sia una voce.

---

## Tre esiti misurati che hanno cambiato il piano

**1. `@signpdf/placeholder-pdf-lib` non è utilizzabile.** 1285 → 6210 byte, prefisso in comune con
l'originale 9 byte: pdf-lib ri-serializza invece di appendere, distrugge la struttura artigianale
e sposta ogni offset congelato. `pades.js` scrive quindi il placeholder **a mano**, come
incremental update — append puro, i primi 1285 byte restano identici. È il primo test del file: se
qualcuno reintroduce pdf-lib, quel test si spegne per primo.

**2. L'attacco 1b non fa fallire pdf.js.** Il piano prevedeva che il documento si rifiutasse di
renderizzare: falso. Il file è davvero incoerente (`/Length` dichiara 650, i byte sono 653;
`startxref` dichiara 1026, la tabella è a 1029) ma **sia pdf.js sia poppler lo ricostruiscono** e
mostrano `1.000 euro (novemila euro)`. La morale onesta è più forte di quella pianificata: *il
renderer perdona, la firma no* — vedere il documento renderizzato non è verificarlo. I testi sono
già scritti su questa versione.

**3. Il verdetto a tre stati era bucato: l'attacco dell'esca.** Trovato dal collaudo avversariale,
riparato. Vedi `docs/decisioni.md`, sezione «`verify()` diventa multi-firma». In breve: il campo
firma veniva individuato con `lastIndexOf('/ByteRange')`, cioè su byte che chiunque può appendere;
un attaccante appendeva una **seconda firma con le proprie chiavi e lo stesso Common Name** e il
documento falsificato passava per valido. Oggi `verify()` trova **tutte** le firme, prende il
verdetto peggiore, e restituisce l'impronta SHA-256 di ogni certificato — perché il Common Name
non identifica nessuno.

Riscontro dopo la riparazione, su `scripts/collaudo/firma-reale/out/`:

```
firmato.pdf          valid      1 firma
esca.pdf             extended   2 firme, multipleSignatures=true    (prima: valid)
attacco2-reale.pdf   extended   1 firma
manomesso-1a.pdf     invalid    1 firma
manomesso-coda.pdf   extended   1 firma                             (prima: invalid)
```

---

## Come si lavora qui

- La cartella **è un repository git pubblico su GitHub**: i lavori aperti sono tracciati come
  issue, e due sessioni che toccano gli stessi file devono comunque coordinarsi — su branch
  separati, che adesso sono possibili.
- **Mai `npm install`.** Le dipendenze installate sono: `vite` 8.2.1, `vite-plugin-singlefile`
  2.3.3, `pdfjs-dist` 6.2.108, `pdf-lib` 1.17.1, `@signpdf/placeholder-pdf-lib` 3.3.0 (presente
  ma **non usato**, vedi sopra), `pkijs` 3.4.0, `asn1js` 3.0.10, `pvutils`.
- Test: `npm test`, che gira `node --test` dalla radice. **Su node 26 `node --test <directory>`
  non funziona** (prova a caricare la directory come modulo e fallisce con `MODULE_NOT_FOUND`):
  usa `npm test` oppure i file espliciti. Chi lancia la forma con le directory legge `exit 1` e
  crede di aver rotto qualcosa.
- Strumenti di sistema disponibili: `ffmpeg`, `say` (voci `it_IT`, fra cui Alice), `openssl`,
  poppler (`pdftotext` `pdfinfo` `pdfsig` `pdftoppm`), `certutil`, Chrome headless in
  `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`. **Non** disponibili: `qpdf`,
  `mutool`.
- Documenti normativi: `docs/contratti-ui.md` (forme dei ViewModel, vocabolario dei `kind`, i
  dodici passi), `docs/decisioni.md` (voce, mappa fonetica, `verify()` multi-firma, vulnerabilità
  come contenuto), `docs/pdf-campione.md` (offset congelati),
  `spikes/pdfjs/RECIPE.md` (pdf.js inlineato senza rete, ricetta verificata).
