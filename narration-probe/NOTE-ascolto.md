# Come ascoltare la sonda vocale

## La domanda a cui rispondere

> **Suona italiana, o suona come un inglese che legge l'italiano?**

Non serve un giudizio tecnico. Serve l'orecchio di chi ascolta. Se dopo trenta secondi viene da
pensare "questa persona non è madrelingua", la voce è bocciata: la demo va presentata dal vivo, e un
accento sbagliato sposta l'attenzione dal contenuto alla voce.

## Perché proprio questo testo

Le frasi di prova che si usano di solito ("ciao, questa è una prova") non dicono niente: sono
tutte facili. Il testo della sonda è invece costruito con due criteri insieme.

1. **È il vocabolario vero della demo** — promessa di pagamento, mille euro, chiave privata,
   certificato, impronta, verifica, falsificazione, byte. Se la voce inciampa, inciampa sulle
   parole che si sentiranno ripetute per cinque minuti, non su parole che non si useranno mai.
2. **È una trappola per i suoni che l'italiano di espeak-ng sbaglia.** Kokoro non legge le
   lettere: prima passa il testo a espeak-ng, che lo trasforma in suoni. C'è una segnalazione
   aperta sul progetto che dice che quei suoni, in italiano, escono anglicizzati. Ogni frase della
   sonda contiene almeno una parola che mette alla prova un suono a rischio.

## Le parole-spia, e il difetto da aspettarsi

| Ascolta | Nelle parole | Il difetto se è anglicizzata |
|---|---|---|
| **gl** | s**bagl**ia, me**gl**io | si sente "sbag-lia" con la g staccata, come in *inglese*, invece di un suono unico e morbido |
| **gn** | impe**gn**o, dise**gn**o, o**gn**i | "impeg-no" con la g dura, invece di un solo suono nasale |
| **sc dolce** | rico**nosc**e, la**sci**a | "riconoske" con la k, invece della sc di *scendere* |
| **c e g dolci** | **ci**fra, **c**ertificato, **gi**orno, di**gi**tale, ac**c**orge | "kifra", "ghiorno": la consonante torna dura |
| **z** | sen**z**a, **z**ona, dimostra**z**ione, differen**z**a | la z inglese di *zoo*, una s ronzante, al posto della z italiana di *pizza* |
| **doppie** | pro**mess**a, mi**ll**e, se**tt**embre, progra**mm**a, ne**ss**uno, le**gg**e | la doppia non dura: "mile" invece di "mille", "nesuno" invece di "nessuno". È il difetto più facile da sentire |
| **r fra due vocali** | e**ur**o, s**er**io, v**er**ifica | la r americana, arrotondata e senza vibrazione, invece del colpetto di lingua |
| **vocali** | per**ché**, **è**, doc**u**mento, ogn**i** | la e di *perché* che scivola in "perchei"; le vocali finali che si spengono in una vocale indistinta |
| **nomi propri** | pades, bait reing | devono suonare come si direbbero a voce, non come sigle compitate |
| **byte** | "un solo byte" | vedi la nota qui sotto: è il punto più a rischio di tutto il testo |

## Cosa si vede già prima di ascoltare

Il testo è stato passato al fonemizzatore, cioè allo stesso pezzo di catena che Kokoro usa per
decidere i suoni. Tre cose sono già emerse, e servono come lente mentre si ascolta.

- **La mappa fonetica è necessaria, non un vezzo.** Scritto per esteso, il nome dello standard
  viene compitato lettera per lettera ("pi, a, di, e, esse") e l'altro nome tecnico viene letto
  metà in inglese. Scritti come si pronunciano — *pades*, *bait reing* — tornano a posto. Per
  questo esistono due file: quello ortografico si legge, quello fonetico va al motore.
- **La parola `byte` fa passare il motore all'inglese** per una parola sola, poi torna
  all'italiano. Vale la pena concentrarsi su quel punto: se si sente uno scarto di accento in mezzo
  alla frase, va aggiunto anche `byte` alla mappa fonetica e scritto *bait*.
- **Le doppie sono trattate in modo incostante.** In alcune parole la consonante lunga c'è
  (*settembre*, *macchina*, *legge*), in altre sparisce (*mille*, *promessa*, *nessuno*). Se
  all'ascolto la differenza si sente, è un difetto sistematico e non un caso isolato.

## Come fare la prova

1. Ascoltare con le casse o le cuffie che si useranno davvero alla presentazione, non con
   l'altoparlante del portatile.
2. Prima passata a occhi aperti sul testo, per capire cosa dice. Seconda passata **a occhi
   chiusi**, senza leggere: è lì che l'accento straniero salta fuori.
3. Ascoltare anche il campione di confronto fatto con la voce di sistema del Mac. È il ripiego:
   italiano nativo, zero rischio di accento, ma più piatta. Serve come metro di paragone,
   non come vincitore automatico.

## Come rispondere

Una riga basta. La risposta è una fra:

- **voce A** (Sara) — si usa questa, suona italiana;
- **voce B** (Nicola) — si usa questa, suona italiana;
- **nessuna delle due** — si passa al ripiego con la voce di sistema;
- **A o B ma con riserva** — va indicata la parola su cui si è sentito il problema, e si prova a
  correggerla con la mappa fonetica prima di buttare via la voce.

Se possibile, vanno aggiunte le due o tre parole su cui è rimasto il dubbio. Una parola sbagliata si
aggiusta scrivendola diversamente; un accento sbagliato ovunque, no.
