# Sonda vocale — rapporto tecnico

Fase 1b del piano. Obiettivo: mettere all'ascolto tre campioni dello stesso testo, e misurare
il costo in byte della narrazione così come verrà consegnata.

**Esito: tutto quello che era previsto ha funzionato al primo tentativo.** Nessun ripiego è stato
necessario, nessuna dipendenza nuova serve. Il giudizio sulla voce resta a chi ascolta: si apre
`ascolta.html` con un doppio click.

---

## 1. Cosa c'è nella cartella

| File | Byte | Cos'è |
|---|---:|---|
| `ascolta.html` | 9.290 | pagina di ascolto, doppio click, percorsi relativi, zero risorse esterne |
| `out/kokoro-if_sara.wav` | 1.418.284 | voce A, femminile |
| `out/kokoro-im_nicola.wav` | 1.566.764 | voce B, maschile |
| `out/say-alice.wav` | 1.678.654 | ripiego, voce di sistema macOS |
| `out/kokoro-if_sara.opus` | 119.982 | voce A nel formato di consegna |
| `out/kokoro-im_nicola.opus` | 133.244 | voce B nel formato di consegna |

I modelli, 350 MB in due file, stanno in `~/.cache/kokoro-onnx/` e **non** nella cartella di progetto.

## 2. Versioni

| Componente | Versione |
|---|---|
| kokoro-onnx | 0.5.0 |
| onnxruntime | 1.28.0 |
| phonemizer-fork | 3.3.2 |
| espeakng-loader | 0.2.4 |
| soundfile / numpy | 0.14.0 / 2.5.2 |
| Python (effimero, via uv) | 3.12 |
| uv | 0.11.26 |
| espeak-ng (homebrew) | 1.52.0 |
| ffmpeg | 8.1.2 |
| macOS `say`, voce Alice | it_IT |

## 3. Comandi eseguiti, in ordine

**Modelli** — scaricati una volta sola, saltabili alla prossima esecuzione:

```sh
mkdir -p ~/.cache/kokoro-onnx && cd ~/.cache/kokoro-onnx
curl -sL -o kokoro-v1.0.onnx https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx
curl -sL -o voices-v1.0.bin  https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin
```

| File | Byte | Atteso | SHA-256 |
|---|---:|---|---|
| `kokoro-v1.0.onnx` | 325.532.387 (310,4 MiB) | ~310 MB ✅ | `7d5df8ecf7d4b1878015a32686053fd0eebe2bc377234608764cc0ef3636a6c5` |
| `voices-v1.0.bin` | 28.214.398 (26,9 MiB) | ~27 MB ✅ | `bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d` |

Controllati anche col comando `file`: l'ONNX è dati binari, il `.bin` è un archivio zip di array numpy —
nessuno dei due è una pagina d'errore HTML travestita da modello.

**Sintesi Kokoro** — script in scratchpad, ambiente effimero, niente installato stabilmente:

```sh
ESPEAK_DATA_PATH=/opt/homebrew/share/espeak-ng-data \
PHONEMIZER_ESPEAK_LIBRARY=/opt/homebrew/lib/libespeak-ng.dylib \
uv run --with kokoro-onnx --with soundfile --python 3.12 python kokoro_probe.py \
    narration-probe/probe.fonetico.txt  <cartella-uscita>
```

Il cuore dello script è la chiamata prevista dal piano, senza scostamenti:

```python
k = Kokoro(model_path, voices_path)
samples, sample_rate = k.create(text, voice="if_sara", speed=1.0, lang="it")
```

**Ripiego di sistema** — al `say` va il testo **ortografico**, con gli accenti:

```sh
say -v Alice -f narration-probe/probe.it.txt -o say-alice.aiff
ffmpeg -y -i say-alice.aiff -ar 24000 -ac 1 -c:a pcm_s16le out/say-alice.wav
```

**Formato di consegna:**

```sh
ffmpeg -y -i out/kokoro-<voce>.wav -c:a libopus -b:a 32k -ac 1 out/kokoro-<voce>.opus
```

## 4. Cosa ha funzionato, e cosa non è servito

**Ha funzionato la strada principale, al primo colpo.** Nessun tentativo fallito da raccontare: la
libreria `kokoro-onnx` ha accettato sia i nomi di voce sia il codice di lingua così come erano scritti
nel piano. Di conseguenza **non** è stato necessario provare la CLI `nazdridoy/kokoro-tts`, e il ripiego
`say -v Alice` esiste come termine di paragone, non come rimedio.

**Le due voci italiane esistono e si chiamano esattamente `if_sara` e `im_nicola`.** Non ho dovuto
indovinare: `Kokoro.get_voices()` restituisce 54 voci, e le uniche due col prefisso `i` (italiano) sono
quelle due. Nessuna terza voce italiana disponibile, quindi la scelta è davvero fra due.

**Le variabili d'ambiente per espeak-ng si sono rivelate superflue.** Le ho esportate lo stesso, come da
istruzioni, ma `kokoro-onnx` 0.5.0 tira dentro `espeakng-loader`, che si porta appresso la propria copia
dei dati espeak. Chi rieseguirà questo passo non ha bisogno di homebrew.

**Una funzione promessa non c'è:** `get_languages()` non esiste in questa versione, quindi non ho potuto
elencare le lingue come chiedeva la consegna. Ho verificato per un'altra via, sotto.

### La lingua italiana è davvero attiva — verificato, non supposto

`lang` non viene validato da `kokoro-onnx`: finisce dritto dentro `phonemizer`. Un valore ignorato in
silenzio avrebbe prodotto un campione inglese spacciato per italiano, quindi ho confrontato i fonemi
prodotti dalla libreria con quelli dell'espeak-ng di sistema, sulla stessa frase:

```
libreria, lang="it"     lo stˈandard sɪ kjˈama pˈades, e la dzˈɔna kopˈɛrta sɪ kjˈama bˈaɪt rˈɛiŋɡ.
espeak-ng -v it --ipa   lo stˈandard sɪ kjˈama pˈades, e la dzˈɔna kopˈɛrta sɪ kjˈama bˈaɪt rˈɛiŋɡ
libreria, lang="en-us"  lˈoʊ stˈændɚd sˈiː tʃˈaɪəmə pˈeɪdz, ˈiː lˌæ zˈoʊnə kˈoʊpɚɾə sˈiː tʃˈaɪəmə bˈeɪt ɹˈɛɪŋ.
```

Identici carattere per carattere alla riga italiana di sistema, e lontanissimi dalla riga inglese. La
sonda è italiana.

## 5. Le misure

Ogni file è stato misurato con `ffprobe` per la durata e con `ffmpeg -af volumedetect` per il livello.
Il controllo richiesto era doppio: durata fra 20 e 45 secondi **e** file non silenzioso.

| File | Durata | Esito 20–45 s | mean_volume | max_volume | Silenzioso? |
|---|---:|---|---:|---:|---|
| `kokoro-if_sara.wav` | 29,55 s | ✅ | −15,1 dB | 0,0 dB | no |
| `kokoro-im_nicola.wav` | 32,64 s | ✅ | −19,6 dB | −3,4 dB | no |
| `say-alice.wav` | 34,97 s | ✅ | −15,4 dB | −0,0 dB | no |
| `kokoro-if_sara.opus` | 29,55 s | — | −15,2 dB | 0,0 dB | no |
| `kokoro-im_nicola.opus` | 32,65 s | — | −19,7 dB | −3,2 dB | no |

Tutti e tre i wav passano entrambi i controlli. La codifica in Opus non sposta il livello di più di
0,1 dB, quindi il formato di consegna non introduce sorprese.

**Una differenza da tenere presente: la voce B esce 4,5 dB più bassa della voce A.** Non è un difetto
del file, è il timbro della voce, ma in un confronto a orecchio conta: chi ascolta a volume fisso
tende a preferire il campione più forte. La pagina di ascolto lo dice a chiare lettere, così il
confronto resta onesto. In fase 5b conviene passare tutti i segmenti da un `loudnorm` di ffmpeg, che
è comunque una buona idea per una narrazione da proiettare.

## 6. Il dato che serve al piano: quanto pesa la narrazione

Misurato sui file veri, non stimato.

| Campione | Byte | Durata | Bitrate reale | kB al minuto |
|---|---:|---:|---:|---:|
| `kokoro-if_sara.opus` | 119.982 | 29,55 s | 32,48 kbps | 243,6 |
| `kokoro-im_nicola.opus` | 133.244 | 32,65 s | 32,65 kbps | 244,9 |
| `say-alice.opus` | 138.995 | 34,98 s | 31,79 kbps | 238,4 |
| **media** | | | **32,31 kbps** | **242,3** |

I tre valori stanno in tre punti percentuali l'uno dall'altro: la stima è solida qualunque voce vinca.

> ### **242 kB per minuto di parlato**, Opus mono 32 kbps.
> **Cinque minuti pesano 1,21 MB grezzi, che diventano 1,62 MB una volta in base64** (+33,3%).

**Il piano diceva ≈1,2 MB e ≈1,6 MB: la misura lo conferma**, entro l'1%. Le due versioni narrate
restano quindi intorno ai 4 MB previsti in tabella.

**Costo dello spezzettamento in segmenti: trascurabile.** Ogni file Opus si porta dietro le proprie
intestazioni Ogg, quindi trenta segmenti costano più di un file unico. Ho misurato la differenza
tagliando la voce A in tronconi da dieci secondi: 120.256 byte contro 119.982, cioè **91 byte per
segmento in più**. Trenta segmenti aggiungono meno di 3 kB al totale. Non è un argomento per fare
segmenti lunghi.

## 7. Tre cose emerse dal codice che valgono per la fase 5b

**a) `byte` fa commutare il fonemizzatore all'inglese, e lascia spazzatura nel flusso.** Nell'output
italiano la parola compare così:

```
… o kˈambia ʊn sˈolo (en)bˈaɪt(it), nessˌʊno se ne akːˈɔrdʒe …
```

`(en)` e `(it)` sono i marcatori con cui espeak-ng segnala il cambio di lingua. Il problema è che
`kokoro-onnx` filtra i fonemi tenendo **tutto ciò che sta nel vocabolario del modello** — e le parentesi,
la `e`, la `n`, la `i` e la `t` ci stanno tutte. Quei marcatori non vengono scartati: **arrivano al
modello acustico come otto simboli in più da pronunciare**, in mezzo alla frase.
Conferma della nota del copione: scrivere `byte` come `bait` nella mappa fonetica non serve solo a
correggere l'accento, serve a togliere di mezzo otto token spuri. La stessa trappola scatta su qualunque
parola inglese lasciata in chiaro nel copione.

**b) Il testo della sonda supera il limite del modello, e viene spezzato in due.** Il tetto è di 510
fonemi; la sonda ne produce 629, quindi `create()` fa due passate e concatena. La cesura cade
**esattamente dopo `byte,`** — cioè sulla parola che chi ascolta deve giudicare. Se sente uno stacco
proprio lì, potrebbe essere la giuntura e non la pronuncia: la pagina di ascolto lo avverte.
Per la fase 5b: **tenere ogni segmento sotto i 510 fonemi**, che a occhio sono circa 450 caratteri di
italiano, cioè tre o quattro frasi. Un segmento per passo ci sta abbondantemente, quindi il problema
non si ripresenta — ma va saputo, perché il troncamento non alza eccezioni.

**c) Costanti utili, lette dal sorgente:** frequenza di campionamento fissa a 24 kHz; `trim=True` è il
comportamento predefinito e toglie il silenzio in testa e in coda a ogni troncone, il che è
esattamente ciò che si vuole per segmenti da concatenare a runtime.

## 8. La pagina di ascolto

`ascolta.html` — apre con un doppio click, si regge su percorsi relativi verso `out/`.

- Tre riquadri etichettati **Voce A / Voce B / Ripiego**, un elemento `<audio>` per ciascuno, con il
  testo letto stampato sotto.
- Il testo stampato sotto ogni riquadro è **quello davvero letto da quella voce**, verificato per
  confronto automatico con i file sorgente: fonetico per le due Kokoro, ortografico per Alice. È l'unica
  riga in cui i tre campioni differiscono, e si vede.
- In cima, la domanda a cui rispondere, e le due avvertenze del punto 5 e 7b.
- In fondo, le quattro risposte possibili riprese da `NOTE-ascolto.md`.

Controlli fatti: nessun `http://`, nessun `<script>`, nessun `<link>`, nessun `@import`, nessun `url()` —
la pagina non può fare una richiesta di rete nemmeno volendo. Font di sistema. Resa verificata in Chrome
headless: i tre lettori mostrano 0:29, 0:32 e 0:34, quindi i file si caricano dai percorsi relativi.
Palette chiara con variante scura automatica.

## 9. Cosa manca, e a chi tocca

**Tocca a chi presenta la demo**, e la fase 1b si ferma qui: aprire `ascolta.html`, ascoltare,
rispondere una riga. Nessun agente può dire se quella voce suona italiana.

Da fare dopo quella risposta, in fase 5b: portare i comandi di questo rapporto dentro
`scripts/make-narration.mjs`, aggiungere `byte` → `bait` alla mappa fonetica, tenere i segmenti sotto i
510 fonemi e passare un `loudnorm`.
