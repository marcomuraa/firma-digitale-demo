# 02 · Fase 5b — l'audio della narrazione

Lavori dalla radice del repository. **Leggi prima `docs/stato.md`**, poi
`docs/decisioni.md` (sezione «Voce della narrazione») e `docs/contratti-ui.md`.

Questo prompt copre **solo la generazione dell'audio**. Il driver che fa avanzare la demo
(`src/ui/narrator.js`) non si scrive qui: è la fase 5c, `docs/prompt/02b-fase5c-driver-narrazione.md`,
e va eseguita **subito dopo** questa. Finché non gira, i dodici `.opus` esistono e non li suona
nessuno.

Puoi lavorare in parallelo alle altre sessioni. **Scrivi solo in `scripts/narration/**` e
`src/assets/narrazione/**`.** Non toccare `src/ui/`, `src/design/`, `src/core/`, `src/entries/`,
`vite.config.js`, `scripts/collaudo/`.

---

## Cosa c'è già

`src/ui/script.it.js` esporta `SCRIPT = { [stepId]: { testo, testoFonetico, durataStimata } }`,
dodici segmenti, uno per passo, in ordine. È già scritto, testato (22 test) e non va riscritto.

Decisioni già prese, da rispettare senza rinegoziarle:

- voce **`say -v Alice`** di macOS, italiano nativo;
- **160 parole al minuto**, cioè il predefinito di Alice: nessun `-r` da passare;
- mappa fonetica: `PAdES` → `pades`, `ByteRange` → `bait reinge`. È già applicata dentro
  `testoFonetico`, che differisce da `testo` **solo** per queste due sostituzioni;
- `say` produce audio byte-identico con apostrofo tipografico e dritto: verificato, non è un
  problema da risolvere.

## Cosa devi costruire

**`scripts/narration/make-narration.mjs`** — genera un segmento audio per passo:

```sh
say -v Alice --file-format=WAVE --data-format=LEI16@22050 -f <segmento>.txt -o <segmento>.wav
ffmpeg -i <segmento>.wav -c:a libopus -b:a 32k -ac 1 <segmento>.opus
```

A `say` va dato `testoFonetico`, non `testo`. Poi ogni `.opus` va in base64 e finisce in un modulo
importabile dal bundle, perché i file HTML devono restare autoconsistenti e aprire offline:

```js
// src/assets/narrazione/segments.js  (generato, non scritto a mano)
export const SEGMENTS = { [stepId]: { dataUri, durata, byte } }
```

Il modulo generato deve dichiarare in testa che è generato e da quale comando, così nessuno lo
modifica a mano.

Requisiti misurabili, da verificare e riportare:

- ogni segmento non silenzioso: misura `mean_volume` con `ffmpeg -af volumedetect`. Un file che
  dura giusto ma è muto è un fallimento, ed è un fallimento silenzioso;
- durata reale di ogni segmento confrontata con `durataStimata` di `script.it.js`: se divergono
  molto, la stima a 160 parole al minuto è sbagliata e va detto — serve alla sincronia;
- durata totale: il piano prevede circa cinque minuti;
- peso totale in base64. Riferimento misurato sulla sonda: **Opus mono 32 kbps ≈ 239 kB al minuto**
  di parlato, quindi cinque minuti ≈ 1,2 MB, ≈ 1,6 MB una volta in base64. Se il numero vero si
  discosta molto, dillo: i pesi stimati dei due file narrati (~4 MB) dipendono da questo.

**Rigenerabilità.** Lo script deve poter girare due volte di fila producendo lo stesso risultato,
e deve poter rigenerare un solo segmento quando cambia una riga di copione, senza rifare tutto.

**Una pagina di ascolto** — `scripts/narration/ascolta.html`, apribile con doppio click, percorsi
relativi: i dodici segmenti in ordine con il testo sotto ciascuno, e la durata. Serve a chi
riascolta il copione intero senza costruire la demo. Sobria, nessuna risorsa esterna.

## Come si chiude

`npm test` verde (oggi 282), e nel rapporto: durate reali contro stimate, `mean_volume` di ogni
segmento, peso totale in base64, e i comandi esatti per rigenerare tutto e per rigenerare un
segmento solo.

Se qualcosa nel copione ti sembra sbagliato, **non correggerlo**: `src/ui/script.it.js` non è tuo.
Segnalalo nel rapporto.
