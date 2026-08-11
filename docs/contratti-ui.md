# Contratti della UI — fissati prima del fan-out della fase 4

Il piano fissa le *firme* dei moduli di vista, ma non la *forma* dei ViewModel che
restituiscono. Senza quella forma, le due direzioni visive della fase 5 renderizzerebbero
strutture diverse e non potrebbero condividere le viste — che è tutto il motivo per cui le
viste restituiscono ViewModel puri invece di DOM.

Questo documento è normativo. Chi implementa non inventa campi: se un campo manca, lo segnala
invece di aggiungerlo di testa sua.

**Regola generale.** Le viste sono funzioni pure: nessun DOM, nessun accesso a `window`,
nessuno stato globale, nessuna stringa di presentazione con markup. I numeri sono offset
assoluti in byte, con `end` **esclusivo**. Il testo destinato all'occhio umano sta in
`copy.it.js`, non dentro le viste.

---

## Vocabolario condiviso — **due assi, non uno**

> Correzione del 10 agosto 2026, dopo la prova di integrazione della fase 4. La prima stesura
> metteva `covered` fra i `kind`, e non funzionava: nel righello i `kind` sono una **partizione**
> (un byte, un `kind`), nell'esadecimale sono **strati sovrapponibili**. Sul campione firmato
> reale i segmenti risultavano `object` 2493 e `hole` 8194 con **zero** segmenti `covered`,
> mentre `coverage.coveredBytes` valeva 2493: chi avesse colorato il righello per `segment.kind`
> non avrebbe visto nessuna banda coperta, cioè avrebbe perso esattamente la cosa che la demo
> deve mostrare. Le due domande sono indipendenti e vanno tenute su assi separati.

**Asse 1 — `kind`: che cosa *sono* quei byte.**

| `kind` | Significato | Dove |
|---|---|---|
| `object` | un oggetto PDF, per la mappa anatomica | righello + esadecimale |
| `structure` | header, `xref`, trailer, `startxref`, `%%EOF` | righello + esadecimale |
| `hole` | il buco `/Contents` | righello + esadecimale |
| `tail` | coda oltre la copertura: l'incremental update dell'attacco 2 | righello + esadecimale |
| `target` | il bersaglio di un attacco, prima che scatti | **solo** esadecimale |
| `changed` | byte modificati da un attacco | **solo** esadecimale |

I primi quattro tassellano il file nel righello. `target` e `changed` sono strati che si
accendono sopra, quindi nel righello non compaiono mai.

**Asse 2 — `covered: boolean`: se quei byte sono *firmati*.**

Deriva **solo** dal `/ByteRange`, mai dal `kind`. `hole` e `tail` sono per definizione non
coperti; `object` e `structure` lo sono se cadono dentro un intervallo. Un segmento del righello
non può essere coperto a metà: dove il confine della copertura taglia un oggetto, il segmento si
spezza (vedi `byte-ruler`).

`covered` **non è un `kind`**: chi lo cerca fra i `kind` sta commettendo l'errore che questa
nota documenta.

**Validazione: stesso meccanismo, insiemi diversi.** Un `kind` fuori vocabolario è un errore di
programmazione, non un dato: entrambe le viste lanciano con `code: 'UNKNOWN_KIND'` e il nome del
colpevole nel messaggio. Ma le due viste non accettano lo stesso insieme, perché non ricevono la
stessa cosa:

| | Accetta in ingresso | Perché |
|---|---|---|
| `hex-view`, `highlights[].kind` | tutti e sei, obbligatorio | sono strati, e `target`/`changed` sono proprio il suo mestiere |
| `byte-ruler`, `objects[].kind` | `object` · `structure` · `hole` · `tail`, opzionale (default `object`) | `target` e `changed` sono strati e nel righello non esistono; un segmento con quel `kind` sarebbe un colore che chi disegna la fascia non ha |

`covered` è rifiutato da entrambe: è l'asse 2, non un `kind`.

La distinzione che regge tutto: **un `kind` sbagliato è codice, un intervallo degenere è dato.**
Il primo lancia, il secondo (lunghezza zero, `start > end`, elemento nullo, array assente) viene
ignorato in silenzio. I dati non si rifiutano.

---

## `src/views/hex-view.js`

```js
buildHexWindow(bytes, centerOffset, span, highlights) -> HexViewModel
```

`bytes: Uint8Array` · `centerOffset: number` · `span: number` (byte totali desiderati, la
finestra viene allargata all'allineamento di 16) · `highlights: Highlight[]`.

```js
Highlight = { id: string, start: number, end: number, kind: Kind, label?: string }

HexViewModel = {
  start, end,            // finestra effettiva, start multiplo di 16
  bytesPerRow: 16,
  fileLength,
  rows: [{
    offset,              // offset del primo byte della riga, multiplo di 16
    offsetHex,           // '000007a0', per la colonna di sinistra
    cells: [{
      offset,
      hex,               // '31', minuscolo, sempre 2 caratteri
      byte,              // valore numerico
      char,              // carattere stampabile, oppure '.' se non lo e
      printable,         // boolean
      highlightIds       // string[], vuoto se nessuno
    }]                   // sempre 16 celle: le celle fuori dal file hanno byte === null
  }],
  highlights,            // gli stessi ricevuti, clampati alla finestra, ordinati per start
  truncated: { before: boolean, after: boolean }
}
```

Una cella può appartenere a più highlight: `highlightIds` è un array, e l'ordine è quello di
`highlights`. La vista non decide chi vince — lo decide il rendering.

---

## `src/views/asn1-view.js`

```js
buildAsn1Tree(der) -> Asn1ViewModel
```

`der: Uint8Array`. Non deve mai lanciare: un DER malformato produce `ok: false`.

```js
Asn1ViewModel = {
  ok: boolean,
  error: string | null,
  totalLength: number,
  root: Asn1Node | null,
  flat: Asn1Node[]        // stessa gerarchia in ordine di visita, per liste e ricerca
}

Asn1Node = {
  id,                     // '0.2.1', percorso stabile nell'albero
  depth,
  offset, length,         // dell'elemento intero, header compreso
  headerLength,           // byte di tag + lunghezza
  contentOffset, contentLength,
  tagClass,               // 'universal' | 'application' | 'context' | 'private'
  tagNumber,
  constructed: boolean,
  tagLabel,               // 'SEQUENCE', 'OBJECT IDENTIFIER', '[0]', ...
  valueKind,              // 'oid'|'integer'|'utctime'|'generalizedtime'|'octetstring'|
                          // 'bitstring'|'utf8string'|'printablestring'|'null'|'boolean'|'raw'
  valuePreview,           // stringa breve, gia leggibile, mai piu di 64 caratteri
  oid,                    // '1.2.840.113549.1.9.4' se valueKind === 'oid', altrimenti null
  oidLabel,               // 'messageDigest' se conosciuto, altrimenti null
  children: Asn1Node[]
}
```

`oidLabel` deve riconoscere almeno gli OID che compaiono davvero nella nostra catena:
`1.2.840.113549.1.7.1` id-data · `1.2.840.113549.1.7.2` id-signedData ·
`1.2.840.113549.1.9.3` contentType · `1.2.840.113549.1.9.4` messageDigest ·
`1.2.840.113549.1.9.5` signingTime · `1.2.840.113549.1.9.16.2.47` signing-certificate-v2 ·
`2.16.840.1.101.3.4.2.1` sha-256 · `1.2.840.113549.1.1.1` rsaEncryption ·
`1.2.840.113549.1.1.11` sha256WithRSAEncryption · `2.5.4.3` commonName · `2.5.4.6` countryName ·
`2.5.4.10` organizationName · `2.5.29.14` subjectKeyIdentifier · `2.5.29.15` keyUsage ·
`2.5.29.19` basicConstraints · `2.5.29.37` extKeyUsage.

Gli OID sconosciuti restano con `oidLabel: null`: nessuna invenzione.

---

## `src/views/byte-ruler.js`

```js
buildRuler({ fileLength, byteRange, uncoveredTail, objects }) -> RulerViewModel
```

`byteRange: [a, b, c, d]` nella convenzione PAdES (dall'offset `a` per `b` byte, poi
dall'offset `c` per `d` byte; il buco `/Contents` sta fra `a+b` e `c`).
`uncoveredTail: number` byte oltre `c+d`, cioè 0 finché non scatta l'attacco 2.
`objects: [{ id, label, start, end, kind? }]` — arriva da `sections[]` di
`src/assets/sample-offsets.json`, il cui schema è congelato in `docs/pdf-campione.md`.
**Non leggere quel file dentro la vista**: è un parametro, e resta un parametro.

```js
RulerViewModel = {
  fileLength,
  segments: [{ id, label, start, end, fraction, kind, covered }],
                          // ordinati, tassellano [0, fileLength), `covered` uniforme su ognuno
  coverage: {
    coveredBytes, holeBytes, tailBytes,
    coveredFraction,        // 0..1
    complete: boolean       // true se coveredBytes + holeBytes === fileLength
  },
  byteRange,
  marks: [{ offset, label, kind }]   // confini notevoli: inizio buco, fine copertura, %%EOF
}
```

`segments` deve tassellare l'intero file senza buchi né sovrapposizioni, anche quando gli
`objects` in ingresso non lo fanno: le zone non coperte da un oggetto diventano segmenti
`kind: 'structure'` con `label` generica. È questo invariante che rende il righello una mappa
anatomica affidabile e non un disegno approssimato.

**`covered` è uniforme su ogni segmento.** Dove un confine del `/ByteRange` cade in mezzo a un
oggetto, il segmento **si spezza in due**, stesso `kind` e stessa `label`, `covered` diverso.
Senza questa regola il righello non potrebbe disegnare il confine della copertura nel punto
giusto, ed è quel confine il punto in cui l'attacco 2 diventa visibile. `kind` nel righello vale
solo `object`, `structure`, `hole`, `tail`: mai `covered`, mai `target`, mai `changed`.

Quando `byteRange` è assente (documento non ancora firmato) tutti i segmenti hanno
`covered: false` e `coverage.coveredBytes` vale 0: il righello resta una mappa anatomica valida,
semplicemente senza copertura da mostrare.

`marks[].kind` è **il `kind` di ciò che comincia a quel byte**: la tacca di fine copertura vale
`tail` dopo l'attacco 2 e `structure` quando lì finisce il file. Se una direzione visiva vuole
dare alla tacca della copertura un colore tutto suo, non deve dedurlo dal `kind`: chieda un campo
in più, e lo si aggiunge qui.

---

## `src/ui/copy.it.js`

```js
export const COPY = { [panelId]: { titolo, occhiello, corpo: string[] } }
```

`occhiello` è la riga breve sopra il titolo, quella che si legge da tre metri. `corpo` è un
array di paragrafi in testo semplice: niente HTML, niente markdown. La modalità
*presentazione* mostra `occhiello` + `titolo` + il **primo** paragrafo; la modalità *studio* li
mostra tutti. Scrivi quindi il primo paragrafo in modo che regga da solo.

Identificatori dei pannelli, **chiusi**: i dodici passi qui sotto più
`teoria-certificato`, `teoria-scansionata`, `teoria-eidas`.

## `src/ui/steps.js` — unica sorgente di verità degli identificatori

```js
export const STEP_IDS  = [...]   // i dodici passi, nell'ordine della tabella
export const PANEL_IDS = [...]   // STEP_IDS più i tre pannelli teorici
```

`copy.it.js` e `script.it.js` **importano** da qui invece di ridichiarare la lista. Due array
identici in due file sono due sorgenti di verità: prima o poi qualcuno riordina un passo in uno
solo dei due, e il disallineamento si manifesta come una narrazione che apre il pannello
sbagliato.

## `src/ui/script.it.js`

```js
export const SCRIPT = { [stepId]: { testo, testoFonetico, durataStimata } }
```

`testo` è italiano ortografico, quello che si legge a schermo nei sottotitoli.
`testoFonetico` è ciò che si dà in pasto a `say -v Alice`: differisce da `testo` **solo** per
la mappa fonetica decisa in `docs/decisioni.md` (`PAdES` → `pades`, `ByteRange` →
`bait reinge`). `durataStimata` in secondi, calcolata a **160 parole al minuto**.

## Passi della demo — elenco chiuso e ordinato

| # | `stepId` | Cosa succede a schermo |
|---|---|---|
| 1 | `documento` | il PDF campione, il testo e i suoi byte |
| 2 | `chiavi` | generazione della coppia RSA-2048 |
| 3 | `certificato` | costruzione del certificato X.509 self-signed |
| 4 | `placeholder` | si apre il buco `/Contents` e nasce il `/ByteRange` |
| 5 | `impronta` | SHA-256 sui due intervalli coperti |
| 6 | `cms` | il `SignedData` e i suoi attributi firmati |
| 7 | `firma` | la firma entra nel buco |
| 8 | `verifica` | verdetto a tre stati: valida e completa |
| 9 | `attacco-cifra` | 1a — la cifra falsificata, verdetto non valida |
| 10 | `attacco-lettere` | 1b — anche le lettere, la struttura si sfalda |
| 11 | `attacco-coda` | 2 — modifica dopo la firma, verdetto esteso dopo la firma |
| 12 | `chiusura` | cosa resta dimostrato, e cosa no |

I tre pannelli teorici non hanno un passo narrato: si aprono a richiesta e la loro voce, se
mai servirà, si aggiunge dopo.

Fra un attacco e l'altro il documento torna allo stato firmato integro. È un'**azione**, non un
passo: non ha un segmento di voce, e il ritorno si racconta nella prima frase dell'attacco
successivo.
