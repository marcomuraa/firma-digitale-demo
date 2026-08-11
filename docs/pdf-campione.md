# Il PDF campione — mappa annotata

Questo documento descrive `src/assets/sample.pdf`, il documento su cui l'intera demo si appoggia.
È scritto per gli agenti delle fasi successive: **gli offset qui sotto sono congelati, non vanno
reinventati**. Chi ha bisogno di un byte del campione lo legge da `src/assets/sample-offsets.json`,
non lo cerca a mano.

| | |
|---|---|
| File | `src/assets/sample.pdf` |
| Offset congelati | `src/assets/sample-offsets.json` |
| Generatore | `scripts/pdf/make-sample-pdf.mjs` (logica in `build-sample-pdf.mjs`) — `npm run pdf` |
| Validatore | `scripts/pdf/validate-sample-pdf.mjs` — `npm run pdf:validate` |
| Dump annotato | `scripts/pdf/dump-sample-pdf.mjs` |
| Esperimento pdf-lib | `scripts/pdf/exp-pdflib-roundtrip.mjs` |

---

## 1. Numeri congelati

| Grandezza | Valore |
|---|---:|
| Lunghezza del file | **1285** byte |
| SHA-256 | `8eb0f906ed51563c81f354f818e12dd3d561ff703fc4bb7d2b391b5e61e507a1` |
| Versione PDF | 1.7 |
| Pagine | 1, A4 (`MediaBox [0 0 595 842]`) |
| Oggetti | 5, tutti in chiaro, nessuna compressione |
| `/Length` del content stream | **650** (dati `286..936`) |
| `xref` | offset **1026**, 6 voci da 20 byte |
| `startxref` | valore **1026** |
| `/ID` | `<0A1B2C3D4E5F60718293A4B5C6D7E8F9>` ripetuto due volte, costante |

Il generatore è **deterministico**: due esecuzioni producono byte identici. Non c'è `/Info`, non c'è
data di creazione, l'`/ID` è cablato nel sorgente. Se questi numeri cambiano è perché qualcuno ha
modificato il generatore — e allora vanno aggiornati anche i consumatori.

### Sezioni (tassellano `[0, 1285)` senza buchi)

| id | label | start | end | byte |
|---|---|---:|---:|---:|
| `header` | Intestazione | 0 | 9 | 9 |
| `obj1` | Oggetto 1 — Catalogo | 9 | 58 | 49 |
| `obj2` | Oggetto 2 — Albero delle pagine | 58 | 115 | 57 |
| `obj3` | Oggetto 3 — Pagina | 115 | 253 | 138 |
| `obj4` | Oggetto 4 — Contenuto della pagina | 253 | 954 | 701 |
| `obj5` | Oggetto 5 — Font Times-Roman | 954 | 1026 | 72 |
| `xref` | Tabella xref | 1026 | 1155 | 129 |
| `trailer` | Trailer | 1155 | 1264 | 109 |
| `startxref` | startxref | 1264 | 1279 | 15 |
| `eof` | Fine file | 1279 | 1285 | 6 |

Queste dieci sezioni sono la **mappa anatomica del righello dei byte** in cima alla pagina: coprono
il file per intero, in ordine, senza sovrapposizioni. `buildRuler()` può usarle così come sono.

### Oggetti (`start` = inizio di `N 0 obj`, `end` = subito dopo `endobj`)

| # | tipo | label | start | end |
|---:|---|---|---:|---:|
| 1 | Catalog | Catalogo | 9 | 57 |
| 2 | Pages | Albero delle pagine | 58 | 114 |
| 3 | Page | Pagina | 115 | 252 |
| 4 | ContentStream | Contenuto della pagina | 253 | 953 |
| 5 | Font | Font Times-Roman | 954 | 1025 |

La differenza fra `objects[].end` e `sections[].end` è di un byte: la sezione include il LF che
chiude la riga `endobj`, l'oggetto no. Serve perché le sezioni devono tassellare il file.

### Punti caldi

| Chiave in `sample-offsets.json` | Offset | Byte |
|---|---:|---|
| `amount.lineStart` | **576** | `(` — inizio della riga dell'importo, `576 = 16 × 36` |
| `amount.digitOffset` / `digitsStart` | **577** | `1` (`0x31`) — il bersaglio dell'attacco 1a |
| `amount.digitsEnd` | 582 | fine di `1.000` |
| `amount.wordsStart` | **589** | `m` di `mille` — il bersaglio dell'attacco 1b |
| `amount.wordsEnd` | 594 | fine di `mille` |
| `amount.lineEnd` | 604 | fine della riga (esclusa, il LF sta a 604) |
| `contentStream.dataStart` | 286 | primo byte dopo `stream\n` |
| `contentStream.dataEnd` | 936 | primo byte di `\nendstream` |
| `contentStream.lengthValueStart..End` | 272..275 | le tre cifre di `/Length 650` |
| `signatureDrawing.start..end` | 726..936 | il blocco `q … Q` della firma autografa |
| `xref.startxrefValueStart..End` | 1274..1278 | le quattro cifre dopo `startxref` |

---

## 2. Il testo del documento

```
PROMESSA DI PAGAMENTO
Documento dimostrativo, privo di valore legale.

Io sottoscritto Lorenzo Rossi prometto di pagare
al signor Mario Bianchi la somma di

    1.000 euro (mille euro)

entro il giorno 30 settembre 2026.

Roma, 10 agosto 2026
```

Tre vincoli da rispettare se mai si toccasse questo testo:

1. **Nessuna lettera accentata.** Non è una preferenza di stile: il file è ASCII puro, e in
   WinAnsiEncoding `à` ed `è` sono byte ≥ 0x80 che nel dump esadecimale diventano punti, bucando la
   leggibilità proprio nel pannello che deve dimostrare che il file è leggibile. La stesura evita
   l'accento scegliendo parole che non ce l'hanno (*prometto di pagare*, non *pagherò*).
2. **La riga «Documento dimostrativo, privo di valore legale.» è marcatura obbligatoria.** Sta a
   12 pt subito sotto il titolo, ben visibile nella pagina renderizzata. Una demo sulla
   falsificazione non deve lasciare in giro un artefatto che, staccato dal contesto, somigli a un
   documento vero. I nomi (Lorenzo Rossi, Mario Bianchi) sono palesemente fittizi per lo stesso motivo.
3. **Le parentesi di `(mille euro)` non sono sottoposte a escape.** In una stringa letterale PDF le
   parentesi bilanciate sono legali senza backslash, e nel dump si leggono meglio. Sia pdf.js sia
   poppler le accettano: verificato, nessun ripiego sull'escape è stato necessario.

Il font è **Times-Roman**, una delle 14 base, non incorporata: l'oggetto 5 pesa 72 byte in tutto.

---

## 3. Perché la riga dell'importo comincia a un multiplo di 16

Un dump esadecimale si legge a 16 byte per riga. Se la riga dell'importo cominciasse a un offset
qualunque, nel dump apparirebbe spezzata a metà fra due righe, e il pannello «guarda il byte che
cambia» perderebbe metà della sua forza. Con `lineStart = 576 = 16 × 36` la riga comincia
esattamente all'inizio di una riga di dump:

```
 576  0240  28 31 2e 30 30 30 20 65 75 72 6f 20 28 6d 69 6c  |(1.000 euro (mil|
 592  0250  6c 65 20 65 75 72 6f 29 29 20 54 6a 0a 45 54 0a  |le euro)) Tj.ET.|
```

L'allineamento **non è cablato**. Il generatore inserisce spazi di riempimento nel content stream
immediatamente prima della riga dell'importo (gli spazi fra operatori sono whitespace, non cambiano
il rendering), poi ricalcola `/Length` e tutti gli offset dell'`xref`, poi rimisura. Aggiungere
spazi può far crescere di una cifra il valore di `/Length`, che sta *prima* dei dati e quindi
sposta di nuovo tutto: per questo è un **punto fisso**, non una sottrazione secca. Con il testo
attuale converge in **2 iterazioni** con **3 spazi** di riempimento (`alignment` in
`sample-offsets.json`). Si vedono nel dump alla riga `0x0230`, subito prima dell'importo:

```
 560  0230  0a 31 31 30 20 36 33 36 20 54 64 0a 20 20 20 0a  |.110 636 Td.   .|
```

Se qualcuno cambia una parola del documento, il punto fisso rigira e `lineStart` resta multiplo di
16 con un altro riempimento. Non serve intervenire a mano — ma tutti gli offset a valle cambiano.

---

## 4. I due bersagli d'attacco

### 1a — «Falsifica la cifra» (offset 577)

Scrivere `0x39` all'offset `amount.digitOffset` = **577**. Un byte, lunghezza invariata, struttura
intatta: `/Length` continua a tornare, l'`xref` continua a puntare dove deve, il documento si
renderizza. Cambia solo quello che si legge:

> `9.000 euro (mille euro)`

È la **difesa antica** che entra in scena: cifre e lettere non concordano più, e un umano che legge
se ne accorge. Ma serviva un umano che leggesse — mentre l'impronta crittografica se ne accorge da
sola. Verificato dal validatore: dopo la modifica pdf.js apre ancora il documento ed estrae proprio
quella stringa.

### 1b — «Falsifica anche le lettere» (offset 589..594)

Sostituire i byte `589..594` (`mille`) con `novemila`. Il file cresce di **3 byte** e la struttura
si rompe in due punti misurati:

- `/Length` dichiara ancora **650**, ma i byte reali fra `stream` e `endstream` diventano **653**;
- la voce `xref` dell'oggetto 5 dichiara offset **954**, dove ora non c'è più `5 0 obj`.
  Gli oggetti 1–4 stanno prima del punto di modifica e restano corretti.

**Attenzione, misura controintuitiva.** Il piano prevedeva che «pdf.js si rifiuta di renderizzare».
**Non è quello che succede.** Misurato con pdfjs-dist 6.2.108 e poppler 26.07:

| Renderer | Comportamento dopo 1b |
|---|---|
| pdf.js | **apre e renderizza**: 1 pagina, la firma vettoriale sopravvive, testo estratto `1.000 euro (novemila euro)` |
| poppler `pdftotext` | **estrae ancora il testo**, stessa riga |

Entrambi hanno logica di recupero: ricostruiscono l'`xref` scandendo il file e ritrovano
`endstream` ignorando il `/Length` sbagliato. **Non si può quindi raccontare l'attacco 1b come
«il documento non si apre più».** Il racconto onesto è un altro, e regge meglio:

> Il file è *strutturalmente rotto* — `/Length` mente e l'`xref` punta a vuoto, e la pagina lo
> dimostra con i byte — eppure i visualizzatori lo aprono lo stesso, perché sono progettati per
> essere indulgenti. L'incoerenza `1.000` / `novemila` resta visibile a occhio. È la firma
> digitale, non il renderer, che si accorge della manomissione.

Il pannello della fase 4 deve quindi mostrare **`/Length` dichiarato contro reale** e **le voci
`xref` che non puntano più a `N 0 obj`**, non aspettarsi un'eccezione dal renderer. Se serve
comunque uno stato di errore gestito, va provocato di proposito, non sperato.

---

## 5. La firma autografa è solo geometria (offset 726..936)

Sotto la data, il content stream disegna un ghirigoro con `m` (moveto), `c` (curve di Bézier) e `S`
(stroke), dentro un `q … Q`. Due tratti: la firma vera e propria (5 curve) e lo svolazzo sottostante
(1 curva). In tutto **210 byte di coordinate**, tutti leggibili nel dump:

```
 752  02f0  30 2e 34 35 20 52 47 0a 37 38 20 35 30 32 20 6d  |0.45 RG.78 502 m|
 768  0300  0a 38 36 20 35 33 38 20 39 38 20 35 35 30 20 31  |.86 538 98 550 1|
 784  0310  30 36 20 35 32 34 20 63 0a 31 31 33 20 35 30 32  |06 524 c.113 502|
```

Nessuna immagine, nessun XObject, nessun pattern: il validatore lo verifica sia sui byte sia sulla
lista operatori di pdf.js (nessun `paintImageXObject`). È il materiale del pannello «firma digitale
≠ firma scansionata»: quella riga di numeri *è* tutta la firma grafica, e chiunque può riscriverla.

---

## 6. La mappa annotata, byte per byte

Rigenerabile con `node scripts/pdf/dump-sample-pdf.mjs`.

```
sample.pdf — 1285 byte — sha256 8eb0f906ed51563c81f354f818e12dd3d561ff703fc4bb7d2b391b5e61e507a1
dec    hex   byte                                              ascii

---- header       0..9    (riga 0x0000, colonna 0)  Intestazione

---- obj1         9..58   (riga 0x0000, colonna 9)  Oggetto 1 - Catalogo
   0  0000  25 50 44 46 2d 31 2e 37 0a 31 20 30 20 6f 62 6a  |%PDF-1.7.1 0 obj|
  16  0010  0a 3c 3c 20 2f 54 79 70 65 20 2f 43 61 74 61 6c  |.<< /Type /Catal|
  32  0020  6f 67 20 2f 50 61 67 65 73 20 32 20 30 20 52 20  |og /Pages 2 0 R |

---- obj2        58..115  (riga 0x0030, colonna 10)  Oggetto 2 - Albero delle pagine
  48  0030  3e 3e 0a 65 6e 64 6f 62 6a 0a 32 20 30 20 6f 62  |>>.endobj.2 0 ob|
  64  0040  6a 0a 3c 3c 20 2f 54 79 70 65 20 2f 50 61 67 65  |j.<< /Type /Page|
  80  0050  73 20 2f 4b 69 64 73 20 5b 33 20 30 20 52 5d 20  |s /Kids [3 0 R] |
  96  0060  2f 43 6f 75 6e 74 20 31 20 3e 3e 0a 65 6e 64 6f  |/Count 1 >>.endo|

---- obj3       115..253  (riga 0x0070, colonna 3)  Oggetto 3 - Pagina
 112  0070  62 6a 0a 33 20 30 20 6f 62 6a 0a 3c 3c 20 2f 54  |bj.3 0 obj.<< /T|
 128  0080  79 70 65 20 2f 50 61 67 65 0a 20 20 20 2f 50 61  |ype /Page.   /Pa|
 144  0090  72 65 6e 74 20 32 20 30 20 52 0a 20 20 20 2f 4d  |rent 2 0 R.   /M|
 160  00a0  65 64 69 61 42 6f 78 20 5b 30 20 30 20 35 39 35  |ediaBox [0 0 595|
 176  00b0  20 38 34 32 5d 0a 20 20 20 2f 52 65 73 6f 75 72  | 842].   /Resour|
 192  00c0  63 65 73 20 3c 3c 20 2f 46 6f 6e 74 20 3c 3c 20  |ces << /Font << |
 208  00d0  2f 46 31 20 35 20 30 20 52 20 3e 3e 20 3e 3e 0a  |/F1 5 0 R >> >>.|
 224  00e0  20 20 20 2f 43 6f 6e 74 65 6e 74 73 20 34 20 30  |   /Contents 4 0|

---- obj4       253..954  (riga 0x00f0, colonna 13)  Oggetto 4 - Contenuto della pagina
 240  00f0  20 52 0a 3e 3e 0a 65 6e 64 6f 62 6a 0a 34 20 30  | R.>>.endobj.4 0|
 256  0100  20 6f 62 6a 0a 3c 3c 20 2f 4c 65 6e 67 74 68 20  | obj.<< /Length |
 272  0110  36 35 30 20 3e 3e 0a 73 74 72 65 61 6d 0a 42 54  |650 >>.stream.BT|
 288  0120  0a 2f 46 31 20 31 38 20 54 66 0a 37 30 20 37 36  |./F1 18 Tf.70 76|
 304  0130  32 20 54 64 0a 28 50 52 4f 4d 45 53 53 41 20 44  |2 Td.(PROMESSA D|
 320  0140  49 20 50 41 47 41 4d 45 4e 54 4f 29 20 54 6a 0a  |I PAGAMENTO) Tj.|
 336  0150  45 54 0a 42 54 0a 2f 46 31 20 31 32 20 54 66 0a  |ET.BT./F1 12 Tf.|
 352  0160  37 30 20 37 33 34 20 54 64 0a 28 44 6f 63 75 6d  |70 734 Td.(Docum|
 368  0170  65 6e 74 6f 20 64 69 6d 6f 73 74 72 61 74 69 76  |ento dimostrativ|
 384  0180  6f 2c 20 70 72 69 76 6f 20 64 69 20 76 61 6c 6f  |o, privo di valo|
 400  0190  72 65 20 6c 65 67 61 6c 65 2e 29 20 54 6a 0a 45  |re legale.) Tj.E|
 416  01a0  54 0a 42 54 0a 2f 46 31 20 31 32 20 54 66 0a 37  |T.BT./F1 12 Tf.7|
 432  01b0  30 20 36 39 36 20 54 64 0a 28 49 6f 20 73 6f 74  |0 696 Td.(Io sot|
 448  01c0  74 6f 73 63 72 69 74 74 6f 20 4c 6f 72 65 6e 7a  |toscritto Lorenz|
 464  01d0  6f 20 52 6f 73 73 69 20 70 72 6f 6d 65 74 74 6f  |o Rossi prometto|
 480  01e0  20 64 69 20 70 61 67 61 72 65 29 20 54 6a 0a 30  | di pagare) Tj.0|
 496  01f0  20 2d 31 38 20 54 64 0a 28 61 6c 20 73 69 67 6e  | -18 Td.(al sign|
 512  0200  6f 72 20 4d 61 72 69 6f 20 42 69 61 6e 63 68 69  |or Mario Bianchi|
 528  0210  20 6c 61 20 73 6f 6d 6d 61 20 64 69 29 20 54 6a  | la somma di) Tj|
 544  0220  0a 45 54 0a 42 54 0a 2f 46 31 20 31 35 20 54 66  |.ET.BT./F1 15 Tf|
 560  0230  0a 31 31 30 20 36 33 36 20 54 64 0a 20 20 20 0a  |.110 636 Td.   .|
 576  0240  28 31 2e 30 30 30 20 65 75 72 6f 20 28 6d 69 6c  |(1.000 euro (mil|   <-- riga dell importo (multiplo di 16)
 592  0250  6c 65 20 65 75 72 6f 29 29 20 54 6a 0a 45 54 0a  |le euro)) Tj.ET.|
 608  0260  42 54 0a 2f 46 31 20 31 32 20 54 66 0a 37 30 20  |BT./F1 12 Tf.70 |
 624  0270  35 39 36 20 54 64 0a 28 65 6e 74 72 6f 20 69 6c  |596 Td.(entro il|
 640  0280  20 67 69 6f 72 6e 6f 20 33 30 20 73 65 74 74 65  | giorno 30 sette|
 656  0290  6d 62 72 65 20 32 30 32 36 2e 29 20 54 6a 0a 45  |mbre 2026.) Tj.E|
 672  02a0  54 0a 42 54 0a 2f 46 31 20 31 32 20 54 66 0a 37  |T.BT./F1 12 Tf.7|
 688  02b0  30 20 35 35 36 20 54 64 0a 28 52 6f 6d 61 2c 20  |0 556 Td.(Roma, |
 704  02c0  31 30 20 61 67 6f 73 74 6f 20 32 30 32 36 29 20  |10 agosto 2026) |
 720  02d0  54 6a 0a 45 54 0a 71 0a 31 2e 31 20 77 0a 31 20  |Tj.ET.q.1.1 w.1 |   <-- firma autografa: sola geometria
 736  02e0  4a 0a 31 20 6a 0a 30 2e 31 30 20 30 2e 31 33 20  |J.1 j.0.10 0.13 |
 752  02f0  30 2e 34 35 20 52 47 0a 37 38 20 35 30 32 20 6d  |0.45 RG.78 502 m|
 768  0300  0a 38 36 20 35 33 38 20 39 38 20 35 35 30 20 31  |.86 538 98 550 1|
 784  0310  30 36 20 35 32 34 20 63 0a 31 31 33 20 35 30 32  |06 524 c.113 502|
 800  0320  20 31 30 33 20 34 38 37 20 39 37 20 35 30 31 20  | 103 487 97 501 |
 816  0330  63 0a 31 30 34 20 35 32 39 20 31 32 37 20 35 34  |c.104 529 127 54|
 832  0340  30 20 31 34 33 20 35 31 34 20 63 0a 31 35 37 20  |0 143 514 c.157 |
 848  0350  34 39 32 20 31 36 37 20 35 32 35 20 31 37 39 20  |492 167 525 179 |
 864  0360  35 31 39 20 63 0a 31 39 31 20 35 31 33 20 31 39  |519 c.191 513 19|
 880  0370  35 20 34 38 39 20 32 31 33 20 35 31 33 20 63 0a  |5 489 213 513 c.|
 896  0380  53 0a 38 34 20 34 38 39 20 6d 0a 31 33 30 20 34  |S.84 489 m.130 4|
 912  0390  38 31 20 31 37 38 20 34 39 35 20 32 31 37 20 34  |81 178 495 217 4|
 928  03a0  38 35 20 63 0a 53 0a 51 0a 65 6e 64 73 74 72 65  |85 c.S.Q.endstre|

---- obj5       954..1026 (riga 0x03b0, colonna 10)  Oggetto 5 - Font Times-Roman
 944  03b0  61 6d 0a 65 6e 64 6f 62 6a 0a 35 20 30 20 6f 62  |am.endobj.5 0 ob|
 960  03c0  6a 0a 3c 3c 20 2f 54 79 70 65 20 2f 46 6f 6e 74  |j.<< /Type /Font|
 976  03d0  20 2f 53 75 62 74 79 70 65 20 2f 54 79 70 65 31  | /Subtype /Type1|
 992  03e0  20 2f 42 61 73 65 46 6f 6e 74 20 2f 54 69 6d 65  | /BaseFont /Time|
1008  03f0  73 2d 52 6f 6d 61 6e 20 3e 3e 0a 65 6e 64 6f 62  |s-Roman >>.endob|

---- xref      1026..1155 (riga 0x0400, colonna 2)  Tabella xref
1024  0400  6a 0a 78 72 65 66 0a 30 20 36 0a 30 30 30 30 30  |j.xref.0 6.00000|
1040  0410  30 30 30 30 30 20 36 35 35 33 35 20 66 20 0a 30  |00000 65535 f .0|
1056  0420  30 30 30 30 30 30 30 30 39 20 30 30 30 30 30 20  |000000009 00000 |
1072  0430  6e 20 0a 30 30 30 30 30 30 30 30 35 38 20 30 30  |n .0000000058 00|
1088  0440  30 30 30 20 6e 20 0a 30 30 30 30 30 30 30 31 31  |000 n .000000011|
1104  0450  35 20 30 30 30 30 30 20 6e 20 0a 30 30 30 30 30  |5 00000 n .00000|
1120  0460  30 30 32 35 33 20 30 30 30 30 30 20 6e 20 0a 30  |00253 00000 n .0|
1136  0470  30 30 30 30 30 30 39 35 34 20 30 30 30 30 30 20  |000000954 00000 |

---- trailer   1155..1264 (riga 0x0480, colonna 3)  Trailer
1152  0480  6e 20 0a 74 72 61 69 6c 65 72 0a 3c 3c 20 2f 53  |n .trailer.<< /S|
1168  0490  69 7a 65 20 36 20 2f 52 6f 6f 74 20 31 20 30 20  |ize 6 /Root 1 0 |
1184  04a0  52 20 2f 49 44 20 5b 3c 30 41 31 42 32 43 33 44  |R /ID [<0A1B2C3D|
1200  04b0  34 45 35 46 36 30 37 31 38 32 39 33 41 34 42 35  |4E5F60718293A4B5|
1216  04c0  43 36 44 37 45 38 46 39 3e 3c 30 41 31 42 32 43  |C6D7E8F9><0A1B2C|
1232  04d0  33 44 34 45 35 46 36 30 37 31 38 32 39 33 41 34  |3D4E5F60718293A4|
1248  04e0  42 35 43 36 44 37 45 38 46 39 3e 5d 20 3e 3e 0a  |B5C6D7E8F9>] >>.|

---- startxref 1264..1279 (riga 0x04f0, colonna 0)  startxref

---- eof       1279..1285 (riga 0x04f0, colonna 15)  Fine file
1264  04f0  73 74 61 72 74 78 72 65 66 0a 31 30 32 36 0a 25  |startxref.1026.%|
1280  0500  25 45 4f 46 0a                                   |%EOF.|
```

Note di lettura:

- Non c'è la riga di commento binario `%âãÏÓ` che quasi tutti i generatori mettono dopo `%PDF-1.7`:
  sono quattro byte ≥ 0x80 e violerebbero il vincolo ASCII. Nessun parser se n'è lamentato.
- L'oggetto 3 è scritto su più righe apposta: nel dump il dizionario `/Page` si legge come un elenco,
  non come una sbrodolata.
- Le voci `xref` sono lunghe esattamente 20 byte (`nnnnnnnnnn ggggg n \n`), come vuole lo standard.
- L'`xref` è **verificato a mano** dal validatore: pdf.js ricostruisce da solo una tabella rotta
  scandendo il file, quindi «pdf.js apre il documento» non dimostra assolutamente nulla sull'`xref`.

---

## 7. Come consumare `sample-offsets.json`

```js
import offsets from '../assets/sample-offsets.json';

// il byte che l'attacco 1a ribalta
bytes[offsets.amount.digitOffset] = 0x39;          // '1' -> '9'

// l'intervallo che l'attacco 1b sostituisce
const { wordsStart, wordsEnd } = offsets.amount;   // 'mille' -> 'novemila'

// la mappa per il righello dei byte
buildRuler({ fileLength: offsets.fileLength, objects: offsets.objects, ... });
```

Contratto del formato: `version` è 1; tutti gli offset sono **byte assoluti dall'inizio del file**
con `end` **escluso**; i campi elencati nel piano non vengono rinominati. Il file contiene anche
`padCount`, `alignment` e `text`, aggiunti per comodità: si possono leggere, non si può contare sul
fatto che restino.

**Ogni offset è ricalcolato dai byte dal validatore**, che non si fida né del generatore né del
JSON. Se `npm run pdf:validate` esce 0, il JSON e il PDF concordano.

---

## 8. Avvertenza per la fase 2 — pdf-lib riscrive, non appende

Misurato da `scripts/pdf/exp-pdflib-roundtrip.mjs` (eseguirlo per riprodurre):

| Misura | `PDFDocument.load` + `save({useObjectStreams:false})` | con `@signpdf/placeholder-pdf-lib` |
|---|---|---|
| Lunghezza | 1285 → 1293 byte | 1285 → 4144 byte |
| Prefisso identico | **9 byte** (solo `%PDF-1.7\n`) | **9 byte** |
| `%%EOF` nel file | 1 | 1 |
| `/Prev` nel trailer | no | no |
| Offset congelati | **tutti spostati** (l'importo da 576 a 578) | **tutti spostati** (l'importo a 612) |
| Riga importo multipla di 16 | no | **no** (612 % 16 = 4) |
| Compressione comparsa | nessuna | **`/Filter /FlateDecode`** (lo stream di aspetto vuoto dell'annotazione firma) |
| Byte fuori ASCII | 4 (commento binario dopo l'header) | 5 |
| Testo in chiaro | sì | sì |

**Verdetto: `riscrittura-completa`.** pdf-lib non appende un incremental update: rilegge il modello a
oggetti e riscrive il file da capo. Un solo `%%EOF`, nessun `/Prev`, prefisso comune di 9 byte.
Passando da `@signpdf/placeholder-pdf-lib` il danno è maggiore: il file quadruplica, ricompaiono
byte non ASCII e — soprattutto — **ricompare `/FlateDecode`**, che è esattamente ciò che il PDF
campione esisteva per non avere.

Conseguenze per chi progetta la fase 2, in ordine di preferenza:

1. **Placeholder PAdES costruito a mano**, come incremental update appeso in coda al campione
   (stessa tecnica dell'attacco 2, già prevista dal piano perché «pdf-lib riscrive invece di
   appendere»). Il campione resta intatto byte per byte, gli offset congelati restano validi, il
   dump resta ASCII. È più lavoro, ed è l'unica strada che preserva l'intera premessa didattica.
2. **Usare `@signpdf/placeholder-pdf-lib` e ricalcolare tutto** sul file che ne esce. Funziona per
   la firma, ma butta via il PDF trasparente: il dump non è più ASCII puro, contiene uno stream
   compresso, e `sample-offsets.json` va rigenerato sul nuovo file. In quel caso questo documento e
   il righello dei byte vanno rifatti sul file post-placeholder, non sul campione.

La decisione non è mia: è della fase 2. Questo documento fornisce la misura, non la scelta.

---

## 9. Come rieseguire i controlli

```bash
npm run pdf            # rigenera sample.pdf e sample-offsets.json (deterministico)
npm run pdf:validate   # 10 famiglie di controlli, esce non-zero al primo fallimento
node scripts/pdf/dump-sample-pdf.mjs        # dump annotato
node scripts/pdf/exp-pdflib-roundtrip.mjs   # esperimento pdf-lib (--json per l'output grezzo)
```

Cosa copre il validatore, in sintesi:

1. purezza ASCII, solo LF, nessun byte di controllo;
2. assenza di `/Filter`, `/ObjStm`, `/XRefStm`, `/FlateDecode`, `/Encrypt`, `/Info`;
3. pdf.js: 1 pagina, tutte le righe di testo, percorsi con curve di Bézier e stroke, nessuna immagine;
4. poppler come **secondo parser indipendente**: `pdftotext -layout` e `pdfinfo` (1 pagina, PDF 1.7);
5. `xref` verificata **a mano sui byte**: ogni voce `n` punta davvero a `N 0 obj`, `startxref` punta
   alla parola chiave, `/Size` coincide, nessun oggetto sfugge alla tabella;
6. `/Length` dichiarato contro byte reali fra `stream` e `endstream`;
7. ogni campo di `sample-offsets.json` ricalcolato dai byte, sezioni che tassellano `[0, fileLength)`,
   `lineStart` multiplo di 16, byte `0x31` in `digitOffset`, `1.000` e `mille` dove dichiarato;
8. simulazione degli attacchi 1a e 1b su copie in memoria, con la reazione dei renderer **registrata**
   e non imposta (vedi §4);
9. dimensione entro 2560 byte (attuale: 1285);
10. determinismo: il generatore rilanciato due volte su cartelle temporanee produce gli stessi byte,
    e gli stessi byte del file su disco.
