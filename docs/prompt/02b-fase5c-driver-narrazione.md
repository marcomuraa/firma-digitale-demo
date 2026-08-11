# 02b · Fase 5c — il driver della narrazione

**Dipende da 01 (fatto) e da 02.** Non partire se `src/assets/narrazione/segments.js` non esiste:
è il modulo che genera la fase 5b, e senza quello il build della variante narrata non compila.

Lavori dalla radice del repository. **Leggi prima `docs/stato.md`**, poi
`docs/contratti-ui.md`, `docs/contratti-dom.md`, `docs/decisioni.md` (sezione «Voce della
narrazione») e il commento in cima a `src/ui/machine.js`, che è il contratto dello stato.

## Perché questo prompt esiste

La fase 5b copre **solo la generazione dell'audio** e vieta esplicitamente di scrivere
`src/ui/narrator.js`. Quel divieto aveva una ragione precisa — quando la 5b fu scritta, la macchina
a stati non esisteva — e la ragione è caduta: la macchina c'è, è provata in node, ed espone tutto
ciò che serve per far avanzare la demo da fuori. Restava un pezzo senza padrone, e questo prompt
gliene dà uno.

Chi esegue la 5b e si ferma lì ottiene dodici file `.opus` e **niente che li suoni**: è esattamente
lo stato in cui il progetto si trova oggi, e il sintomo con cui è stato scoperto è che
`dist/protocollo-narrato.html` è indistinguibile da `dist/protocollo.html`.

## Che cosa possiedi

**Scrivi solo in**: `src/ui/narrator.js`, `src/ui/narrator.test.mjs`,
`src/entries/narration-placeholder.js` (che va sostituito dal driver vero),
`src/design/protocollo/**`, `src/design/doppia/**`, e i due file di
`src/entries/{protocollo,doppia-esposizione}.js` limitatamente al ramo `if (__NARRATED__)`.

**Non toccare**: `src/core/**`, `src/views/**`, `src/ui/machine.js`, `src/ui/copy.it.js`,
`src/ui/script.it.js`, `src/ui/steps.js`, `src/ui/pdf-render.js`, `src/assets/**`,
`vite.config.js`, `scripts/build/**`, `scripts/collaudo/**`, `scripts/narration/**`.

Sei l'unica sessione che entra in **tutte e due** le direzioni visive. Sono già state costruite,
criticate due volte e riparate con misure alla mano: **non hai il mandato di ridisegnarle.** Aggiungi
la narrazione dentro il linguaggio di ciascuna, e alla fine i numeri che i critici hanno certificato
devono ancora reggere (sotto, «Come si chiude»).

---

## Cosa devi costruire

### 1. `src/ui/narrator.js` — il driver, senza DOM per quanto possibile

Firma dal piano, da rispettare:

```js
createNarrator(segments, machine) -> { play, pause, seek, onSegmentEnd }
```

`segments` è `SEGMENTS` di `src/assets/narrazione/segments.js`:
`{ [stepId]: { dataUri, durata, byte } }`. `machine` è l'istanza di `createDemo()` — la **stessa**
che pilota la pagina, quella esposta come `window.__demo`, non una seconda.

Cosa deve fare, e sono requisiti del piano, non idee:

- **`play()` una volta e la demo si svolge da sola** fino al verdetto finale, circa cinque minuti:
  per ogni passo in ordine, riproduce il suo segmento e chiama `machine.run(stepId)`. Decidi tu se
  il passo si esegue prima o dopo la voce — ma decidilo esplicitamente, e sappi che il copione è
  scritto perché **la voce spieghi e lo schermo mostri**, quindi il passo che si vede mentre la
  frase lo racconta è il punto.
- **`pause()` a metà e il controllo torna al mouse senza rompere lo stato.** Dopo una pausa la
  pagina resta navigabile a mano, e una `play()` successiva riprende senza rieseguire passi già
  fatti né saltarne.
- **Il ripristino fra un attacco e l'altro è muto.** `docs/contratti-ui.md` lo dice a chiare
  lettere: «Fra un attacco e l'altro il documento torna allo stato firmato integro. È un'azione,
  non un passo: non ha un segmento di voce, e il ritorno si racconta nella prima frase dell'attacco
  successivo.» Quindi il driver chiama `machine.restoreSigned()` da sé, in silenzio, prima di
  `attacco-lettere` e prima di `attacco-coda`. Se non lo facesse, `canRun` rifiuterebbe comunque il
  passo e la narrazione parlerebbe sopra un errore.
- **Rispetta l'ordine dei passi.** La macchina lo impone (`canRun`) e un passo fuori sequenza non
  esplode: mette in stato d'errore una frase in italiano. Il driver non deve mai finire lì. Se ci
  finisce, si ferma e lo dice a schermo invece di continuare a parlare.
- **`seek(stepId)`** porta la narrazione a un passo preciso. Che cosa succede ai passi saltati è una
  decisione tua: eseguirli in silenzio per arrivare a uno stato coerente è la strada ovvia, ma
  dichiarala.
- **`onSegmentEnd`** notifica chi disegna, per i sottotitoli e per l'evidenziazione del passo in
  corso.

Tieni **fuori dal DOM tutto ciò che può starne fuori** — la sequenza, lo stato di riproduzione, la
decisione di che cosa viene dopo — e mettilo in funzioni pure che `src/ui/narrator.test.mjs` prova
in node. L'elemento `<audio>` (o l'`AudioContext`) è l'unico pezzo che il DOM lo tocca davvero: se
lo isoli dietro una piccola interfaccia, i test possono passargli un finto lettore e provare la
macchina della narrazione senza browser. La direzione C ha già fatto questa mossa per un difetto
suo (`src/design/doppia/giro.js` più `giro.test.mjs`): guardala, è il precedente.

### 2. La trappola che decide se questo lavoro funziona: l'autoplay

**Un browser non riproduce audio senza un gesto dell'utente.** `play()` chiamata al caricamento
viene rifiutata con `NotAllowedError`, e su Chrome da `file://` vale come altrove. Conseguenze non
negoziabili:

- la riproduzione parte **da un comando in pagina** che l'utente preme, mai da sola;
- la promise di `HTMLMediaElement.play()` va **awaited e gestita**: se viene rifiutata, la pagina
  lo dice in italiano invece di restare muta e immobile, che è il modo peggiore di rompersi davanti
  a un'aula;
- se usi un `AudioContext`, nasce `suspended` e va ripreso dentro il gestore del gesto.

Provalo davvero, e riporta come: in Chrome headless non c'è un dispositivo audio, quindi un
`play()` che si risolve lì **non dimostra che si senta** sulla macchina di sviluppo. Distingui nel
rapporto ciò che hai verificato da ciò che va verificato a orecchio.

### 3. I comandi e i sottotitoli, nelle due direzioni

I testi dei sottotitoli sono `SCRIPT[stepId].testo` di `src/ui/script.it.js` — **`testo`, non
`testoFonetico`**: il secondo è quello che si dà in pasto a `say` e dice «pades» e «bait reinge».
Non riscriverli e non incorporarne di nuovi nel markup.

Servono almeno: avvia, pausa, e un modo per saltare a un passo. Aggiungili al contratto del DOM
(`docs/contratti-dom.md`, che **puoi estendere** — è l'unico documento che questo prompt può
toccare) con gli attributi che scegli, per esempio `[data-azione="narrazione-play"]`, così l'anteprima
e la fase 6 li trovano senza sapere quale pagina hanno davanti.

Ogni direzione ha il suo registro e va rispettato: «Protocollo» è un registro di atti notarili,
spigoli vivi, nessuna ombra morbida, nessun gradiente, serif libraria e monospace; «Doppia
esposizione» è la pagina spaccata, e la voce che racconta la macchina ha una sede naturale. Prima di
scrivere CSS, invoca la skill `frontend-design:frontend-design`.

Accessibilità, che qui non è un di più: i sottotitoli sono il canale per chi non sente, quindi
devono esserci sempre e non solo in modalità studio; i comandi sono `<button>` veri raggiungibili
con Tab; e `prefers-reduced-motion` resta rispettato — se fai scorrere la pagina da sola dietro la
voce, quello è movimento.

### 4. La sentinella del build, che non è un dettaglio

`scripts/build/check-selfcontained.mjs` pretende che i due file narrati contengano
`SEGNAPOSTO_NARRAZIONE_FASE_5B` e che i due muti **non** lo contengano: è così che dimostra che il
ramo `if (__NARRATED__)` viene eliminato dal tree-shaking e che driver e audio non pesano sui file
muti. Sostituendo il segnaposto hai due strade: tenere quella costante, oppure cambiarla e
**aggiornare `SENTINELLA_NARRAZIONE` nel controllo**. Non puoi scrivere in `scripts/build/`, quindi
se scegli la seconda segnalala nel rapporto e lascia il lavoro a chi chiude.

Attenzione a un fatto già verificato: il segnaposto di oggi cerca `document.getElementById('scaffold')`,
che dalla fase 5 **non esiste più**. Non copiare quella logica.

---

## Come si chiude

1. `npm test` verde e **non sceso sotto 282**, con i tuoi test della narrazione in più.
2. `npm run build` verde: quattro file autoconsistenti, controllo superato. Attesa dichiarata dal
   piano: i due file narrati passano da ~2,16 MB a **~3,8 MB**; i due muti **non devono crescere**.
   Se crescono, il tree-shaking non sta più funzionando ed è un rilievo bloccante.
3. Percorri le due pagine narrate con lo strumento del progetto, che costruisce una entry sola in
   una cartella propria, la apre da `file://`, la pilota e scatta:

   ```sh
   node scripts/anteprima/anteprima.mjs --aiuto
   node scripts/anteprima/anteprima.mjs --entry protocollo --narrato --scatti <cartella>
   ```

   Le azioni di un copione eseguono JS nella pagina e restituiscono un valore: è così che si misura.
   **Guarda i PNG con lo strumento Read**: una schermata non guardata non è una verifica.
4. Le riparazioni della fase 5 devono reggere ancora. I numeri certificati dai critici, che non
   devono peggiorare: nessuno scorrimento orizzontale del `<body>` a 1920 / 1280 / 800 / 390 in
   entrambe le modalità; zero errori di console e zero richieste di rete (i due soli avvisi ammessi
   sono `Setting up fake worker` e `Indexing all PDF objects`); il verdetto distinguibile in scala
   di grigi; l'ordine di tabulazione uguale all'ordine visivo. Per la direzione C esiste già una
   rete: `node scripts/anteprima/anteprima.mjs --entry doppia-esposizione --copione
   scripts/anteprima/copioni/regressioni-doppia.json --scatti <cartella>` — **rilanciala**, costa
   20 secondi e fallisce da sola. Per «Protocollo» quella rete non c'è: se la aggiungi, è un
   guadagno per tutti.
5. La prova che il piano chiede davvero: **play una volta, cinque minuti di demo che si svolge da
   sola fino al verdetto finale; pausa a metà, il controllo torna al mouse senza rompere lo stato.**

Riferisci: le decisioni che un altro avrebbe potuto prendere diverse (passo prima o dopo la voce,
che cosa fa `seek` con i passi saltati, dove vivono i sottotitoli), come si comporta la pagina se
l'audio viene rifiutato, e che cosa hai potuto verificare solo in headless e va riascoltato a
orecchio.
