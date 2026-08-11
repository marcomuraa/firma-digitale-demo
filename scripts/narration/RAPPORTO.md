# Fase 5b — l'audio della narrazione

Dodici segmenti di voce, uno per passo, generati da `src/ui/script.it.js` e consegnati come
modulo importabile. **Il driver che li fa suonare non è qui: è la fase 5c**
(`docs/prompt/02b-fase5c-driver-narrazione.md`). Finché non gira, i dodici `.opus` esistono e non
li suona nessuno.

Ogni numero di questo documento viene da un comando eseguito. I comandi ci sono.

---

## 1. Cosa c'è, e cosa è generato

| File | Peso | Generato da |
|---|---:|---|
| `make-narration.mjs` | 31.605 B | scritto a mano — è il generatore |
| `make-narration.test.mjs` | 13.191 B | scritto a mano — 21 test dentro `npm test` |
| `ascolta.html` | 16.788 B | **generato** |
| `out/<passo>.txt` (12) | 5.460 B | **generato** — è ciò che si dà in pasto a `say` |
| `out/<passo>.wav` (12) | 14.046.166 B | **generato** — intermedio, non si consegna |
| `out/<passo>.opus` (12) | 1.273.429 B | **generato** — il formato di consegna |
| `out/manifesto.json` | 5.260 B | **generato** — impronte e misure, servono al giro dopo |
| `src/assets/narrazione/segments.js` | 1.700.270 B | **generato** — il modulo che entra nel bundle |

Tutti e cinque i prodotti generati dichiarano in testa di esserlo, e con quale comando si
rifanno. Nessuno contiene una data: una marca temporale renderebbe diverse due esecuzioni
identiche, che è esattamente ciò che questo script promette di non fare.

## 2. La catena, e l'unica deviazione dal prompt

```sh
say -v Alice --file-format=WAVE --data-format=LEI16@22050 -f <passo>.txt -o <passo>.wav
ffmpeg -y -i <passo>.wav -c:a libopus -b:a 32k -ac 1 -fflags +bitexact <passo>.opus
```

Voce, formato dati, bitrate e canali sono quelli decisi in `docs/decisioni.md`. Nessun `-r`: 160
parole al minuto è il ritmo predefinito di Alice, e passarlo esplicitamente sarebbe una finzione.
A `say` va `testoFonetico`, e i file `out/*.txt` contengono **esattamente** quella stringa, senza
un a capo aggiunto — un test lo verifica byte per byte.

**`-fflags +bitexact` è in più rispetto al prompt, e senza non c'è rigenerabilità.** Misurato:

```
$ ffmpeg -i s.wav -c:a libopus -b:a 32k -ac 1 o1.opus      # due volte, stesso ingresso
$ shasum -a 256 o1.opus o2.opus
f2a88411…  o1.opus
9a107033…  o2.opus                                          ← file diversi

$ cmp -l o1.opus o2.opus | head -8
    15 …   16 …   17 …   18 …        ← numero di serie del flusso Ogg, estratto a sorte
    23 …   24 …   25 …   26 …        ← CRC della pagina, che dipende dal precedente

$ ffmpeg -i o1.opus -f s16le - | shasum -a 256               # e o2, e o3
9524a6c0…                                                    ← audio identico, in tutti e tre
```

Il muxer Ogg sorteggia il numero di serie del flusso e scrive `encoder=Lavc<versione> libopus`
nei tag. Due esecuzioni della stessa riga producono quindi due file diversi a parità di audio, e
`segments.js` diventerebbe un diff da 1,6 MB a ogni giro, per niente. Col flag il file è
byte-identico e smette di portarsi addosso il numero di versione di ffmpeg: il vendor diventa
`ffmpeg` e il tag `Lavc libopus`. Costa 16 byte in meno per segmento.

## 3. Le misure

Durata da `ffprobe` sul `.opus`; volume da `ffmpeg -af volumedetect`, sempre sul `.opus`, cioè
sul formato che si consegna e non sull'intermedio.

| # | passo | reale | stima | scarto | parole | p/min | byte | mean_volume | max_volume |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | `documento` | 25,04 s | 26 s | −0,96 | 70 | 167,7 | 100.085 | −15,4 dB | 0,0 dB |
| 2 | `chiavi` | 18,58 s | 20 s | −1,42 | 54 | 174,4 | 73.876 | −15,7 dB | 0,0 dB |
| 3 | `certificato` | 17,72 s | 17 s | +0,72 | 46 | 155,8 | 70.527 | −15,7 dB | −0,3 dB |
| 4 | `placeholder` | 22,50 s | 25 s | −2,50 | 66 | 176,0 | 89.681 | −15,5 dB | −0,1 dB |
| 5 | `impronta` | 30,34 s | 30 s | +0,34 | 79 | 156,2 | 120.133 | −15,8 dB | −0,2 dB |
| 6 | `cms` | 32,03 s | 34 s | −1,97 | 91 | 170,5 | 129.004 | −15,8 dB | −0,2 dB |
| 7 | `firma` | 23,04 s | 27 s | −3,96 | 71 | 184,9 | 93.397 | −15,4 dB | −0,3 dB |
| 8 | `verifica` | 29,46 s | 27 s | +2,46 | 72 | 146,6 | 117.647 | −16,0 dB | 0,0 dB |
| 9 | `attacco-cifra` | 30,00 s | 31 s | −1,00 | 82 | 164,0 | 121.213 | −15,6 dB | 0,0 dB |
| 10 | `attacco-lettere` | 31,56 s | 36 s | −4,44 | 97 | 184,4 | 126.566 | −15,2 dB | 0,0 dB |
| 11 | `attacco-coda` | 30,70 s | 33 s | −2,30 | 89 | 173,9 | 125.006 | −15,4 dB | 0,0 dB |
| 12 | `chiusura` | 26,50 s | 29 s | −2,50 | 76 | 172,1 | 106.294 | −15,6 dB | 0,0 dB |
| | **totale** | **317,47 s** | 335 s | −17,53 | 893 | 168,8 | **1.273.429** | | |

**Nessun segmento è muto, e non è un'assunzione.** L'escursione di `mean_volume` fra i dodici è
di **0,8 dB** (da −16,0 a −15,2) e nessun picco arriva a saturare. La stessa misura sui `.wav`
sta fra −15,9 e −15,1 dB: fra `.wav` e `.opus` il livello medio non si sposta di più di
**0,1 dB** su nessun segmento, quindi la compressione non introduce sorprese. **Il
`loudnorm` che il rapporto della sonda suggeriva per la fase 5b non serve**: una voce sola, letta
alla stessa velocità, esce già uniforme, e passarla per un normalizzatore aggiungerebbe un
processo e toglierebbe determinismo senza guadagno misurabile.

## 4. Il peso

```
opus              1.273.429 B   1,21 MB
base64            1.697.928 B   1,62 MB     ← ciò che entra nel bundle
segments.js       1.700.270 B   1,62 MB     (base64 + 2.342 B di intestazione e struttura)
kB al minuto      235,0                     (misurato dalla sonda: 239 → scarto 1,7%)
```

**Il piano regge**: prevedeva ≈1,2 MB grezzi e ≈1,6 MB in base64 per cinque minuti, e la misura
lo conferma entro il 2%. Le due varianti narrate dovrebbero quindi passare da ~2,16 MB a ~3,8 MB,
come dice `docs/prompt/02b`. Da verificare quando la 5c importerà davvero il modulo: oggi
`src/assets/narrazione/segments.js` **non è importato da nessuno** e `npm run build` non lo vede.

## 5. Rigenerabilità — le due proprietà richieste, provate

**Due esecuzioni di fila danno lo stesso risultato.** Due `--forza` consecutivi, cioè due
generazioni complete e indipendenti a partire dai soli testi:

```sh
node scripts/narration/make-narration.mjs --forza && shasum -a 256 …39 file… > a.txt
node scripts/narration/make-narration.mjs --forza && shasum -a 256 …39 file… > b.txt
diff a.txt b.txt        # nessuna differenza: 12 .txt, 12 .wav, 12 .opus, manifesto,
                        # segments.js, ascolta.html — tutti byte-identici
```

Un terzo giro **senza** `--forza` non cambia un byte e costa 3,0 s invece di 16,4 s: rilegge i
`.opus` e riscrive solo modulo e pagina.

**Un segmento solo si rigenera senza rifare tutto.** La cache non guarda la data dei file ma
l'impronta della *ricetta*: testo fonetico, voce, formato, bitrate, canali, `bitexact`, versione
di ffmpeg, versione di macOS. Se l'impronta registrata in `out/manifesto.json` non torna, o se il
`.opus` sul disco non è più quello registrato, quel segmento si rifà — e solo quello.

```sh
node scripts/narration/make-narration.mjs --segmento impronta
#   rifatti   impronta
#   riusati   documento chiavi certificato placeholder cms firma verifica …
```

Gli altri undici restano byte-identici. `--forza --segmento <id>` rifà quel segmento anche se è
in pari. Aggiornare ffmpeg li rigenera tutti, ed è voluto: audio cotto da un encoder diverso non
deve sopravvivere in silenzio dentro il modulo.

## 6. Il controllo anti-muto, visto fallire

Un file che dura giusto ed è muto è un fallimento silenzioso, quindi il controllo che lo scopre
va visto fallire almeno una volta. Sostituito `chiavi.opus` con un silenzio della stessa durata
(`anullsrc`), e allineato il manifesto perché il file passasse per «in pari»:

```
chiavi   18,59 s   54 parole   4.354 byte   −91,0 dB   ← MUTO
MUTI      chiavi
Il modulo NON e stato scritto: servono tutti e dodici i segmenti, e non muti.
$ echo $?
1
```

`segments.js` è rimasto quello buono: il generatore non pubblica un modulo a metà, e non
sovrascrive quello valido con uno guasto. Ripristinato con `--forza --segmento chiavi`, gli
sha256 sono tornati quelli di prima.

Questo controllo ha già ripagato una volta, prima ancora della prova: `ffmpeg` stampa **due**
riepiloghi `volumedetect` per file — un primo blocco con `n_samples: 0` e nient'altro, dall'istanza
del filtro creata prima che il decodificatore sappia i parametri dell'audio, e poi quello vero.
La prima stesura leggeva il primo e dichiarava muti tutti e dodici i segmenti buoni. Il test
`volumedetect: ffmpeg stampa piu di un riepilogo, e vale l ultimo` congela l'uscita vera.

Altri tre guasti provati a mano, con lo stato ripristinato e verificato per sha256 dopo ognuno:

| Guasto | Comportamento |
|---|---|
| `manifesto.json` illeggibile | riparte da zero e rigenera tutto, esce 0 — un manifesto rotto non deve bloccare nessuno |
| un `.opus` cancellato e non richiesto | `MANCANTI cms`, esce 1, e **non** riscrive il modulo con undici segmenti |
| `--json` durante un fallimento | resta JSON valido, con `mancanti: ["cms"]` — chi lo consuma non deve indovinare |

## 7. La stima a 160 parole al minuto sbaglia, e si sa di quanto

Il prompt chiede di dirlo, perché la stima serve a chi progetta la sincronia.

**Sul totale la stima è lunga del 5,2%**: 335 s previsti contro 317,47 s reali. Il ritmo vero di
Alice su questo copione è **168,8 parole al minuto**, non 160.

**Sul singolo segmento lo scarto è più grande e non ha un segno solo**: da −4,44 s
(`attacco-lettere`, −12,3%) a +2,46 s (`verifica`, +9,1%), con uno scarto relativo medio del
7,2%. Ritarare la costante a 168,8 sistemerebbe il totale (residuo +1,5 s su cinque minuti) ma
**non** il singolo segmento, dove resterebbe fino a 3,5 s di errore.

Il motivo è che un conteggio di parole non vede le pause. La correlazione fra densità di
punteggiatura e ritmo misurato è **−0,625**: i due segmenti più lenti (`verifica` 146,6 p/min,
`certificato` 155,8) sono quelli a elenco, pieni di due punti; i due più veloci (`firma` 184,9,
`attacco-lettere` 184,4) sono quelli a periodo lungo e poche virgole.

**Conseguenza pratica: nessuna, per la sincronia.** `script.it.js` lo dice già in cima —
`durataStimata` «è una stima del parlato, non un contratto di sincronia: il driver avanza su
`audio.onended`, non sul cronometro» — e la 5c deve continuare a fare così. `SEGMENTS[id].durata`
porta la durata **misurata**, che è il numero giusto per i sottotitoli e per i conti; la stima
resta buona per progettare, non per allineare.

Nessuna riga di `src/ui/script.it.js` è stata toccata: quel file non è di questa fase.

## 8. La pagina di ascolto

`ascolta.html` — doppio click, percorsi relativi verso `out/`. Dodici riquadri in ordine, ognuno
con il numero del passo, il titolo del pannello preso da `copy.it.js`, un `<audio>`, il testo
sotto, e una riga di misure: durata reale, stima, scarto, parole al minuto, peso, volume medio.

Il testo mostrato è **`testo`**, quello ortografico che si legge a schermo, non `testoFonetico`.
Le due sole parole che alla voce arrivano scritte diversamente sono marcate con la pronuncia
accanto — `PAdES` *detto «pades»*, `ByteRange` *detto «bait reinge»* — perché una pagina che
mostrasse solo l'ortografia direbbe una bugia comoda su cosa si sente.

Controlli fatti sul file vero: nessun `http://`, nessun `<script>`, nessun `<link>`, nessun
`@import`, nessun `url()`. Aperta in Chrome headless con `scripts/anteprima/anteprima.mjs`:
0 errori di console, 0 eccezioni, **0 richieste fuori da `file:`/`data:`/`blob:`**, e i dodici
lettori mostrano le durate giuste, quindi i percorsi relativi funzionano. Palette chiara con
variante scura automatica, come la pagina della sonda.

La pagina è **generata**: le durate e i testi verrebbero altrimenti ricopiati a mano da due
sorgenti che cambiano.

## 9. I data URI suonano davvero? — quel che si è potuto verificare

I dodici `dataUri` sono stati caricati in Chrome headless da `file://`, con la rete su una porta
morta: **12 su 12 decodificati**, `readyState ≥ 1`, e la durata riportata dal browser coincide con
quella di `ffprobe` entro 60 ms. Il modulo è quindi ben formato e il browser lo digerisce.

**Questo non dimostra che si senta.** In headless non c'è un dispositivo audio. Che la voce sia
gradevole, che il ritmo regga in aula e che «pades» e «bait reinge» suonino come devono, lo può
dire solo l'orecchio di chi ascolta: `open scripts/narration/ascolta.html`.

## 10. I comandi

```sh
node scripts/narration/make-narration.mjs                       # tutto, saltando ciò che è in pari
node scripts/narration/make-narration.mjs --forza                # rigenera tutto da capo   (16,4 s)
node scripts/narration/make-narration.mjs --segmento impronta    # un passo solo             (~4 s)
node scripts/narration/make-narration.mjs --forza --segmento cms # un passo, anche se è in pari
node scripts/narration/make-narration.mjs --json                 # il rapporto in JSON
node scripts/narration/make-narration.mjs --aiuto
open scripts/narration/ascolta.html                              # riascoltare il copione intero
```

Esce 1 se un segmento è muto o manca, 2 se un argomento è sbagliato. Serve macOS con la voce
Alice e ffmpeg con libopus; su un'altra macchina lo script si ferma dicendo cosa manca, invece di
produrre silenzio.

## 11. Cosa manca, e a chi tocca

- **La fase 5c**: `src/ui/narrator.js` non esiste, quindi la voce non suona nella demo. Il modulo
  è pronto e ha la forma che il suo prompt dichiara.
- **`.gitignore`** non è di questa fase e non è stato toccato. Due righe da valutare a chi lo
  possiede: `scripts/narration/out/` è rigenerabile con un comando e pesa 15,3 MB, quindi rientra
  nella regola del file; `src/assets/narrazione/segments.js` **non va ignorato**, perché sarà un
  import statico del bundle narrato — è lo stesso caso di `src/assets/sample-offsets.json`, già
  elencato là in fondo fra i generati da versionare comunque.
- **`docs/stato.md`** andrà aggiornato da chi lo possiede: la narrazione ora esiste, `npm test` è
  a 303, e la frase «non esistono `scripts/narration/`, `src/assets/narrazione/`» non è più vera.
- **Un `npm run narrazione`** sarebbe comodo, ma `package.json` non è scrivibile da questa fase.
- **La critica indipendente non è stata fatta.** Era stata lanciata — sei lenti in parallelo su
  correttezza, rigenerabilità, contratto con la 5c, tenuta dei test, pagina di ascolto e onestà
  dei numeri — e tutte e sei sono morte a metà sul limite di sessione, dopo circa 200 comandi.
  Quello che c'è qui sopra è **verifica di chi ha scritto il codice**, non critica di terzi: vale
  meno, e chi chiude la fase 6 farebbe bene a rifarla.
