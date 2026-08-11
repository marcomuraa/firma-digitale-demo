# Decisioni prese durante l'esecuzione

Registro delle scelte fatte dopo la stesura del piano. Il piano resta la fonte per tutto il
resto; qui finisce solo cio che il piano lasciava aperto o che l'esecuzione ha dovuto fissare.

## Voce della narrazione — deciso

**`say -v Alice` di macOS.** Giudizio all'ascolto sui campioni della sonda, 10 agosto 2026:
prima si era scelto `im_nicola` di Kokoro, poi un ascolto piu attento ha fatto preferire Alice.

Il piano teneva Alice come ripiego; diventa la strada principale. Il baratto e favorevole:
sparisce la dipendenza da Kokoro, dai 340 MB di modello ONNX, da `uv` e da espeak-ng —
e con essa la issue #54 sulle consonanti anglicizzate, che era il rischio dichiarato del
piano. In cambio, la generazione della narrazione diventa **eseguibile solo su macOS**.
Non e un problema: la narrazione si genera a build time sulla macchina di sviluppo e finisce
nei file come base64.

Conseguenze operative per la fase 5b (`scripts/make-narration.mjs`):

- un segmento per passo, generato con
  `say -v Alice -r <ritmo> --file-format=WAVE --data-format=LEI16@22050 -f seg.txt -o seg.wav`,
  poi `ffmpeg -c:a libopus -b:a 32k -ac 1`;
- ritmo predefinito di Alice misurato: **160 parole al minuto**;
- peso misurato: **Opus mono 32 kbps = 239 kB per minuto di parlato**, quindi cinque minuti
  ≈ 1,2 MB, ≈ 1,6 MB una volta in base64. I pesi stimati nel piano per i due file narrati
  (~4 MB) reggono;
- niente modelli da scaricare, niente `~/.cache/kokoro-onnx/` (340 MB, cancellabili);
- `narration-probe/` conserva la prima sonda: serve come prova documentata del perche Kokoro
  e stato scartato, non va cancellata.

**Mappa fonetica — ritarata su Alice e decisa** (seconda sonda, 10 agosto 2026):

| A schermo | La voce dice |
|---|---|
| `PAdES` | `pades` |
| `ByteRange` | `bait reinge` |

Sono le uniche due sostituzioni. Tutto il resto e italiano ortografico puro, che e il caso in
cui una voce italiana nativa da il meglio.

**Ritmo: 160 parole al minuto**, cioe il predefinito di Alice — nessun `-r` da passare.

I due nomi inglesi **si pronunciano**: si e scelto di nominarli invece di aggirarli.
Vincolo che ne discende per il copione della fase 4: un termine si pronuncia **quando lo si
introduce**, non ogni volta che compare a schermo. La regola del piano — la voce spiega, lo
schermo mostra — resta valida per tutto il resto: nessuna etichetta gia visibile va riletta
ad alta voce, e nessuna stringa esadecimale va mai pronunciata.

Materiale della sonda: `narration-probe/` (testo, campioni, pagina di ascolto, rapporto).

## `verify()` diventa multi-firma — 11 agosto 2026

Il collaudo avversariale ha bucato il verdetto a tre stati, ed è il tipo di buco che il piano
chiedeva di cercare (fase 6, lente 3). L'attacco, chiamato **l'esca**:

1. si parte dal PDF già manomesso con l'attacco 2 — importo cambiato *dopo* la firma;
2. l'attaccante appende un **secondo dizionario di firma**, con una sua coppia di chiavi e un suo
   certificato autofirmato che dichiara lo **stesso** Common Name;
3. quella firma è matematicamente ineccepibile e copre tutto il file nuovo.

Esito: il nostro `verify()` diceva `valid`, copertura completa, coda zero — su un documento che
`pdftotext` legge come **`1.000.000 euro (un milione di euro)`** e che `pdfsig` giudica
*«Not total document signed»*, elencando gli intervalli della firma vera: `[0-1663]`, `[9857-10273]`.

La causa è una riga: il campo firma veniva individuato con `lastIndexOf('/ByteRange')`, cioè su
byte che stanno **dopo** la firma e che chiunque può appendere.

**Il contratto si estende, in modo additivo.** `verify(pdfBytes)` continua a restituire
`verdict`, `coverage`, `digest`, `signature`, `identity` riferiti alla firma **primaria** (la
prima del file: quella che ha firmato il documento originale), così nulla di ciò che è già
scritto si rompe. In più restituisce:

```js
signatures: [{ index, byteRange, contentsStart, coverage, digest, signature, identity }]
                       // una voce per ogni dizionario di firma trovato, in ordine di file
multipleSignatures: boolean
```

E il verdetto complessivo è il **peggiore** fra le firme, non il più comodo.

`identity` porta anche `fingerprint` — SHA-256 del DER del certificato — perché il Common Name
non identifica nessuno: nell'attacco è identico. È l'impronta che cambia, e va mostrata.

Questa non è una toppa: è la lezione vera della demo, e rende dimostrabile ciò che il piano
dichiarava soltanto. *Firma valida* non vuol dire *documento autentico*: senza un ancoraggio di
fiducia, chiunque può produrre una firma valida a nome di chiunque.

## Le vulnerabilità trovate entrano nella presentazione — 11 agosto 2026

Decisione presa. Ciò che il collaudo avversariale scopre non si limita a rientrare come
lavoro: diventa **contenuto della demo**. Sono la parte più interessante del progetto, perché
sono le uniche cose che nessuno ha pianificato — le ha trovate qualcuno che cercava di rompere.

Il taglio da dare, e non è un dettaglio di stile: si mostrano **gli attacchi provati e il loro
esito**, non un elenco di bug. Gli attacchi che falliscono valgono quanto quelli che riescono,
perché è il fallimento a dimostrare che il controllo esiste davvero. Tre famiglie:

1. **attacchi che rompono la firma** — l'attacco 1a: il digest non torna, verdetto ❌;
2. **attacchi che non rompono la firma ma cambiano il documento** — l'attacco 2: verdetto ⚠️,
   ed è la ragione per cui il verdetto ha tre stati e non due;
3. **attacchi che ingannano il verificatore** — l'esca: la firma dell'attaccante è
   matematicamente ineccepibile, e finché il verificatore guarda l'ultima firma invece di tutte,
   e non dice *di chi* è, il documento falsificato passa per valido.

La terza famiglia è quella nuova, ed è la più istruttiva: sposta la domanda da *«la firma è
valida?»* a *«valida di chi?»*. È anche il ponte naturale verso il pannello eIDAS, dove la
risposta istituzionale a questa domanda è il certificato qualificato.

**Conseguenza sul contratto della UI.** L'elenco dei pannelli non è più chiuso ai quindici: si
aggiunge la famiglia `vulnerabilita-*`, un pannello per attacco documentato, popolata da ciò che
il collaudo conferma davvero. Va scritta in `docs/contratti-ui.md` quando l'elenco è noto — non
prima, per non inventare pannelli che nessuno ha guadagnato sul campo.

Regola di onestà, visto che questi pannelli parlano di sicurezza: si mostra solo ciò che è stato
**eseguito e misurato**, con la prova accanto. Nessuna vulnerabilità teorica, nessun «si potrebbe
anche». Se un attacco non è stato provato, non entra.

## Contratti fissati prima del fan-out

Il piano fissa le firme dei moduli. L'esecuzione ha dovuto fissare anche due cose che il
piano non copriva, perche agenti paralleli le avrebbero inventate in modi incompatibili.

**Formato di `src/assets/sample-offsets.json`** — offset assoluti dall'inizio del file, `end`
esclusivo. Chiavi: `fileLength`, `sha256`, `objects[]`, `sections[]` (che tassellano
`[0, fileLength)` senza buchi ne sovrapposizioni: sono la mappa anatomica del righello dei
byte), `contentStream`, `amount`, `signatureDrawing`, `xref`. Lo schema completo e in
`docs/pdf-campione.md`.

**Layout dei sorgenti**

```
src/core/     keys certificate cms pades attacks verify
src/views/    hex-view asn1-view byte-ruler        (ViewModel puri, niente DOM)
src/ui/       copy.it script.it narrator
src/assets/   sample.pdf sample-offsets.json
src/entries/  protocollo.{html,js} doppia-esposizione.{html,js}
src/design/protocollo/   direzione A
src/design/doppia/       direzione C
```

## Aggiunte rispetto al piano

- **Collaudo avversariale del PDF campione gia in fase 1**, non solo in fase 6. Motivo:
  pdf.js ricostruisce da solo un `xref` rotto scandendo il file, quindi "pdf.js apre il
  documento" non dimostra niente sugli offset. Il controllo dell'`xref` e manuale sui byte, e
  una lente di collaudo corrompe l'`xref` apposta per verificare che il validatore se ne
  accorga.
- **Spike pdf.js inlineato** (`spikes/pdfjs/`), anticipato alla fase 1: il worker di pdf.js
  caricato da blob o data URI puo essere rifiutato da Chrome su `file://`, e i font base-14
  potrebbero richiedere risorse esterne — proprio quelli che usa il PDF campione.
