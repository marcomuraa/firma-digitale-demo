# Firma digitale — demo didattica

Una demo che smonta una firma digitale **PAdES** pezzo per pezzo, mostrando i byte veri
a ogni passo. Gira interamente nel browser, da `file://`, **senza toccare la rete**.

La firma non e simulata. E una firma CMS/PAdES vera, che strumenti terzi — che di questo
progetto non sanno niente — riconoscono come valida:

```
openssl cms -verify   ->  CMS Verification successful
pdfsig                ->  firma valida, emittente non fidato   (il certificato e autofirmato: previsto)
```

E quando il documento viene manomesso, gli stessi strumenti la rifiutano.

## La tesi

**Il renderer perdona, la firma no.** Vedere un documento renderizzato non e verificarlo.

Non e una morale scritta a tavolino: e il risultato di un esperimento che ha smentito il
piano originale. L'attacco «1b» rompe davvero il PDF — `/Length` dichiara 650 byte quando
ne contiene 653, `startxref` dichiara 1026 quando la tabella e a 1029 — eppure **sia pdf.js
sia poppler lo ricostruiscono** e mostrano tranquillamente `1.000 euro (novemila euro)`.
Il documento a schermo sembra intatto. La firma, no.

C'e un secondo corollario, arrivato da un collaudo avversariale: **«firma valida» non vuol
dire «documento autentico»**. Vedi *Tre esiti misurati*, piu sotto.

## Cosa si vede

Il documento di partenza e `src/assets/sample.pdf`: 1285 byte, ASCII puro, PDF 1.7 scritto
a mano byte per byte. Una finta promessa di pagamento da 1.000 euro, marcata *«Documento
dimostrativo, privo di valore legale»*.

La demo lo percorre in **dodici passi** — documento, chiavi RSA-2048, certificato X.509
autofirmato, placeholder con il buco `/Contents` e il `/ByteRange`, impronta SHA-256, CMS
`SignedData`, firma, verifica, tre attacchi, chiusura — e a ogni passo mostra:

- il **dump esadecimale** dei byte in gioco;
- l'**albero ASN.1** delle strutture DER;
- un **righello dei byte**, che rappresenta l'intero file a scala reale: le zone coperte
  dalla firma, il buco, e l'eventuale coda non firmata.

Tre attacchi sono giocabili in pagina e producono un verdetto a tre stati:

| Attacco | Cosa fa | Verdetto |
|---|---|---|
| 1a | ribalta la cifra a offset 577 (`1` → `9`) | `invalid` — la firma non torna |
| 1b | sostituisce «mille» con «novemila», rompendo `/Length` e `xref` | `invalid`, ma **il documento si vede lo stesso** |
| 2 | appende un incremental update *dopo* la firma | `extended` — la firma regge, il documento e cambiato |

Il verdetto `extended` esiste proprio perche `valid`/`invalid` non bastano a raccontare
l'attacco 2.

Tutto questo viene compilato in **quattro HTML autoconsistenti**, in due direzioni visive
(«Protocollo» e «Doppia esposizione»), ciascuna in variante muta e narrata.

## Provarla

```bash
npm ci                # le versioni sono inchiodate in package-lock.json
npm run dev           # server di sviluppo, apre le due direzioni
```

Oppure costruire i file autoconsistenti e aprirli con un doppio clic:

```bash
npm run build         # scrive quattro HTML in dist/
```

> **Nota:** `npm run build` include un controllo di autoconsistenza che pilota **Chrome
> headless** e si aspetta di trovarlo in `/Applications/Google Chrome.app`. Senza Chrome
> installato li, la build fallisce all'ultima fase — gli HTML sono comunque gia stati scritti.

### Prerequisiti

- **Node ≥ 22.** Il codice usa `import … with { type: 'json' }` (`src/ui/machine.js`,
  `src/core/attacks.js`, `src/design/doppia/documento.js`). Provato su Node 26.
- **Google Chrome** in `/Applications` — solo per `npm run build` e `npm run build:check`.
- **poppler** (`pdftotext`, `pdfinfo`, `pdfsig`) — solo per `npm run pdf:validate`, che ci
  fa il riscontro incrociato.
- **openssl** — solo per i collaudi in `scripts/collaudo/`.

La demo in se non richiede niente di tutto questo: gli HTML in `dist/` si aprono e basta.

### Comandi

| Comando | Cosa fa |
|---|---|
| `npm test` | `node --test` dalla radice — 303 test su 16 file |
| `npm run dev` | server di sviluppo Vite |
| `npm run dev:narrato` | idem, con il flag di compilazione `__NARRATED__` attivo |
| `npm run build` | i quattro HTML autoconsistenti in `dist/`, piu il controllo con Chrome |
| `npm run build:check` | solo il controllo di autoconsistenza |
| `npm run pdf` | rigenera il PDF campione e i suoi offset congelati |
| `npm run pdf:validate` | dodici sezioni di controllo sul PDF campione, riscontro poppler compreso |

> `node --test <directory>` **non funziona** su Node 26: prova a caricare la directory come
> modulo e fallisce con `MODULE_NOT_FOUND`. Usa `npm test`, o i file espliciti.

## Com'e fatto

```
src/core/       il motore: bytes, keys, certificate, cms, pades, attacks, verify
src/views/      ViewModel puri — hex-view, asn1-view, byte-ruler. Nessun accesso al DOM
src/ui/         machine.js (macchina a stati, zero DOM), pdf-render.js (unico ponte
                verso pdf.js), copy.it.js (15 pannelli), script.it.js (12 segmenti
                parlati), steps.js (unica sorgente degli identificatori)
src/design/     le due direzioni visive: protocollo/ e doppia/
src/entries/    le quattro entry di build
scripts/        generazione del PDF campione, build, collaudi, anteprime
docs/           i documenti normativi — vedi sotto
spikes/pdfjs/   come si inlinea pdf.js senza rete: la ricetta e in RECIPE.md
```

Due invarianti hanno deciso la forma di tutto il resto:

- **i pannelli si impilano e non si cancellano** — i risultati di ogni passo sono congelati,
  nessun passo successivo li riscrive;
- **niente esplode** — un passo fuori sequenza mette in stato d'errore una frase in italiano,
  e la demo resta navigabile.

Il righello dei byte lo calcola **la macchina**, non le pagine: se lo calcolassero le due
direzioni, i suoi ingressi divergerebbero.

Nel vocabolario delle viste ci sono **due assi, non uno**: `kind` dice *che cosa sono* quei
byte (`object`, `structure`, `hole`, `tail`), mentre `covered: boolean` dice *se sono firmati*
e deriva solo dal `/ByteRange`. Chi colorasse il righello per `kind` perderebbe esattamente
la cosa che la demo deve mostrare.

## Tre esiti misurati che hanno cambiato il piano

**1. `@signpdf/placeholder-pdf-lib` non e utilizzabile qui.** pdf-lib ri-serializza il PDF
invece di appendere: distrugge la struttura artigianale e sposta ogni offset congelato.
`pades.js` scrive quindi il placeholder **a mano**, come incremental update — append puro,
i primi 1285 byte restano identici. E il primo test del file: se qualcuno reintroduce
pdf-lib, quel test si spegne per primo.

**2. L'attacco 1b non fa fallire il renderer.** Vedi *La tesi*, qui sopra. I testi della
demo sono scritti sulla versione misurata, non su quella pianificata.

**3. Il verdetto a tre stati era bucato: l'attacco dell'esca.** Il campo firma veniva
individuato con `lastIndexOf('/ByteRange')`, cioe su byte che chiunque puo appendere. Un
attaccante appendeva una **seconda firma, con le proprie chiavi e lo stesso Common Name**,
e un documento con l'importo alterato passava per `valid`. Oggi `verify()` trova **tutte**
le firme, prende il verdetto peggiore, ed espone l'impronta SHA-256 del DER di ogni
certificato — perche il Common Name non identifica nessuno.

## Documenti

| File | Cosa fissa |
|---|---|
| `docs/stato.md` | lo stato dei lavori, con i numeri misurati e non dichiarati |
| `docs/decisioni.md` | le decisioni prese e il loro perche |
| `docs/contratti-ui.md` | le forme dei ViewModel, il vocabolario dei `kind`, i dodici passi |
| `docs/contratti-dom.md` | i ganci nel DOM: `window.__demo`, `[data-passo]`, `[data-pannello]`, … |
| `docs/pdf-campione.md` | la mappa annotata del PDF campione e i suoi offset congelati |
| `docs/prompt/` | i lavori aperti, uno per file, con le loro dipendenze |
| `spikes/pdfjs/RECIPE.md` | come si inlinea pdf.js senza una sola richiesta di rete |

## Lavori aperti

Tracciati come **issue**. In sintesi: l'audio della narrazione e stato generato
(`src/assets/narrazione/segments.js`), ma **nessuno lo suona ancora** — manca il driver che
lega i segmenti ai passi (`src/ui/narrator.js` non esiste), quindi oggi le due varianti
«narrate» sono mute. Restano poi il collaudo di sicurezza, i pannelli delle vulnerabilita e
il collaudo finale end-to-end.

`docs/prompt/` contiene un file per lavoro aperto, autosufficiente: ognuno dichiara in quali
percorsi puo scrivere e da cosa dipende. `docs/prompt/README.md` ne descrive l'ordine e i
vincoli di sequenza — in particolare che due lavori che entrano in `src/design/**` non vanno
eseguiti insieme.

## Licenza

MIT — vedi [`LICENSE`](LICENSE). Il progetto incorpora materiale di terze parti che mantiene
la propria licenza, in particolare il font `FoxitSerif.pfb` di **pdf.js** (Apache-2.0):
l'elenco completo e in [`NOTICE`](NOTICE).

I nomi che compaiono nel PDF campione sono di fantasia, e il documento porta scritto di
essere privo di valore legale. Il certificato e autofirmato e dichiara nel proprio Common
Name di essere una demo.
