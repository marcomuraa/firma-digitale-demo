/**
 * Il copione parlato della demo: un segmento per ognuno dei dodici passi, in ordine.
 *
 * Non e un doppione di `copy.it.js`. Quello scrive per l'occhio, questo per l'orecchio, e i
 * due canali fanno lavori diversi: **la voce spiega, lo schermo mostra**. La voce non rilegge
 * mai un'etichetta gia visibile. Dove lo schermo scrive il nome tecnico della funzione di
 * hash, la voce dice che il programma calcola un'impronta e cosa succede se cambia una lettera.
 *
 * Regole di scrittura che questo file rispetta, e che `script.it.test.mjs` rende eseguibili:
 *
 * - frasi corte, una idea per frase, niente subordinate incastrate: chi ascolta non rilegge;
 * - nessuna stringa esadecimale, nessun valore di hash, nessun numero letto cifra per cifra,
 *   nessuna sigla sillabata. Un valore si nomina per la sua funzione, mai per il contenuto.
 *   Di fatto qui non compare **nessuna cifra**: i numeri sono scritti in lettere, che e anche
 *   il modo in cui una voce sintetica sbaglia di meno;
 * - i due nomi inglesi si pronunciano, ma **una volta sola, quando si introducono**: `PAdES`
 *   nel primo passo, `ByteRange` nel quarto. Dopo, a schermo compaiono; la voce li lascia stare;
 * - ogni segmento chiude guardando avanti, perche al termine la pagina avanza da sola;
 * - il ritorno allo stato firmato integro fra un attacco e l'altro non e un passo: si racconta
 *   nella prima frase dell'attacco successivo.
 *
 * Il testo e italiano ortografico pieno, **accenti compresi**: il vincolo ASCII riguarda il PDF
 * campione, non la voce. Ad Alice gli accenti servono davvero — senza, «perche» e «puo» escono
 * storti, ed «e» diventa una congiunzione dove serviva il verbo.
 *
 * `testoFonetico` e cio che si da in pasto a `say -v Alice`. Differisce da `testo` **solo** per
 * le due sostituzioni di `MAPPA_FONETICA`, decise in `docs/decisioni.md`: e scritto a mano qui,
 * non generato, cosi il test puo verificarlo invece di darlo per buono.
 *
 * `durataStimata` e in secondi, dal conteggio parole a 160 parole al minuto — il ritmo
 * predefinito di Alice, misurato dalla sonda. E una stima del parlato, non un contratto di
 * sincronia: il driver avanza su `audio.onended`, non sul cronometro.
 */

/** Ritmo predefinito di `say -v Alice`, misurato dalla sonda: nessun `-r` da passare. */
export const PAROLE_AL_MINUTO = 160

/**
 * Le uniche due sostituzioni fra testo a schermo e testo pronunciato.
 * Tutto il resto e italiano ortografico puro, che e il caso in cui una voce italiana nativa
 * da il meglio. Nessuna trascrizione creativa: se un termine avesse bisogno di una terza riga
 * qui, la scelta giusta e riscrivere la frase, non allungare la mappa.
 */
export const MAPPA_FONETICA = [
  ['PAdES', 'pades'],
  ['ByteRange', 'bait reinge'],
]

/**
 * Gli stepId dei dodici passi, nell'ordine della demo: riesportati da `steps.js`, che ne e
 * l'unica sorgente insieme a `copy.it.js`. Ridichiararli qui vorrebbe dire che un riordino
 * fatto in un file solo manderebbe la voce sul pannello sbagliato.
 */
export { STEP_IDS } from './steps.js'

/** Conta le parole come le conterebbe chi legge ad alta voce: i segni di punteggiatura no. */
export function contaParole(testo) {
  return testo
    .trim()
    .split(/\s+/)
    .filter((parola) => /[\p{L}\p{N}]/u.test(parola)).length
}

/** Applica la mappa fonetica. E l'unica differenza ammessa fra `testo` e `testoFonetico`. */
export function applicaMappaFonetica(testo) {
  let fuori = testo
  for (const [aSchermo, pronunciato] of MAPPA_FONETICA) {
    fuori = fuori.split(aSchermo).join(pronunciato)
  }
  return fuori
}

/** Secondi di parlato stimati dal conteggio parole, arrotondati al secondo. */
export function stimaDurataSecondi(testo) {
  return Math.round((contaParole(testo) / PAROLE_AL_MINUTO) * 60)
}

export const SCRIPT = {
  documento: {
    testo:
      "Questo è il documento che firmeremo. È una promessa di pagamento: qualcuno si impegna a versare mille euro entro la fine di settembre. Non ha alcun valore legale: esiste solo per questa dimostrazione. Noi leggiamo delle parole. Il computer vede soltanto byte: numeri in fila, uno dietro l’altro. Le parole sono lì dentro, in chiaro. Adesso su questo file costruiamo una firma vera, quella dello standard che si chiama PAdES.",
    testoFonetico:
      "Questo è il documento che firmeremo. È una promessa di pagamento: qualcuno si impegna a versare mille euro entro la fine di settembre. Non ha alcun valore legale: esiste solo per questa dimostrazione. Noi leggiamo delle parole. Il computer vede soltanto byte: numeri in fila, uno dietro l’altro. Le parole sono lì dentro, in chiaro. Adesso su questo file costruiamo una firma vera, quella dello standard che si chiama pades.",
    durataStimata: 26,
  },

  chiavi: {
    testo:
      "Una firma digitale nasce da una coppia di numeri, generati insieme, adesso. Uno dei due resta privato: non lascia mai questa macchina, ed è quello che firma. L’altro è pubblico, e si può dare a chiunque: serve a controllare. Dal pubblico non si risale al privato. È questa asimmetria che regge tutto il resto.",
    testoFonetico:
      "Una firma digitale nasce da una coppia di numeri, generati insieme, adesso. Uno dei due resta privato: non lascia mai questa macchina, ed è quello che firma. L’altro è pubblico, e si può dare a chiunque: serve a controllare. Dal pubblico non si risale al privato. È questa asimmetria che regge tutto il resto.",
    durataStimata: 20,
  },

  certificato: {
    testo:
      "La chiave pubblica, da sola, è un numero anonimo. Il certificato le attacca un nome, e una scadenza. Nel mondo reale a garantirlo è un’autorità riconosciuta. Qui garantisce se stesso, perché tutto succede dentro questa pagina: la matematica regge lo stesso, la fiducia è un’altra faccenda.",
    testoFonetico:
      "La chiave pubblica, da sola, è un numero anonimo. Il certificato le attacca un nome, e una scadenza. Nel mondo reale a garantirlo è un’autorità riconosciuta. Qui garantisce se stesso, perché tutto succede dentro questa pagina: la matematica regge lo stesso, la fiducia è un’altra faccenda.",
    durataStimata: 17,
  },

  placeholder: {
    testo:
      "Adesso viene la parte curiosa. La firma deve stare dentro il documento, ma non può firmare se stessa. Allora prima si scava un buco vuoto, della misura giusta, e lo si riempirà alla fine. Il documento dichiara anche quali sue parti sono coperte: quella prima del buco, e quella dopo. Questa dichiarazione ha un nome: ByteRange. Il buco è l’unica zona che la firma non protegge.",
    testoFonetico:
      "Adesso viene la parte curiosa. La firma deve stare dentro il documento, ma non può firmare se stessa. Allora prima si scava un buco vuoto, della misura giusta, e lo si riempirà alla fine. Il documento dichiara anche quali sue parti sono coperte: quella prima del buco, e quella dopo. Questa dichiarazione ha un nome: bait reinge. Il buco è l’unica zona che la firma non protegge.",
    durataStimata: 25,
  },

  impronta: {
    testo:
      "Adesso il programma calcola un’impronta del documento: un numero corto, sempre della stessa lunghezza, ricavato da tutti i byte coperti. Ha due proprietà che la rendono preziosa. La prima: se cambia anche una sola lettera, l’impronta cambia completamente, non un pochino. La seconda: dall’impronta non si torna indietro al documento. Notate che il calcolo salta il buco: prende i byte prima e quelli dopo, e li tratta come se fossero attaccati. L’impronta, da adesso, prende il posto del documento.",
    testoFonetico:
      "Adesso il programma calcola un’impronta del documento: un numero corto, sempre della stessa lunghezza, ricavato da tutti i byte coperti. Ha due proprietà che la rendono preziosa. La prima: se cambia anche una sola lettera, l’impronta cambia completamente, non un pochino. La seconda: dall’impronta non si torna indietro al documento. Notate che il calcolo salta il buco: prende i byte prima e quelli dopo, e li tratta come se fossero attaccati. L’impronta, da adesso, prende il posto del documento.",
    durataStimata: 30,
  },

  cms: {
    testo:
      "Quello che si firma non è direttamente l’impronta, ma un piccolo pacchetto di dichiarazioni che la contiene. Dentro ci sono quattro cose: che tipo di contenuto è stato firmato, l’impronta appena calcolata, il momento della firma, e a quale certificato questa firma si lega. Il pacchetto è scritto in un formato standard, lo stesso che si usa per firmare la posta elettronica. Perché questo giro in più? Perché così la firma copre anche le dichiarazioni. Chi cambiasse l’ora dichiarata romperebbe la firma, esattamente come se avesse cambiato il testo del documento.",
    testoFonetico:
      "Quello che si firma non è direttamente l’impronta, ma un piccolo pacchetto di dichiarazioni che la contiene. Dentro ci sono quattro cose: che tipo di contenuto è stato firmato, l’impronta appena calcolata, il momento della firma, e a quale certificato questa firma si lega. Il pacchetto è scritto in un formato standard, lo stesso che si usa per firmare la posta elettronica. Perché questo giro in più? Perché così la firma copre anche le dichiarazioni. Chi cambiasse l’ora dichiarata romperebbe la firma, esattamente come se avesse cambiato il testo del documento.",
    durataStimata: 34,
  },

  firma: {
    testo:
      "Adesso entra in gioco la chiave privata. Prende il pacchetto e lo trasforma in un blocco di byte che soltanto lei poteva produrre: quella è la firma. Il blocco va scritto dentro il buco lasciato aperto prima, dimensionato apposta per contenerlo. Il documento non cambia di una virgola: si riempie solo la parte che era vuota. Da questo momento il file è firmato, e chiunque lo riceva può controllarlo da solo.",
    testoFonetico:
      "Adesso entra in gioco la chiave privata. Prende il pacchetto e lo trasforma in un blocco di byte che soltanto lei poteva produrre: quella è la firma. Il blocco va scritto dentro il buco lasciato aperto prima, dimensionato apposta per contenerlo. Il documento non cambia di una virgola: si riempie solo la parte che era vuota. Da questo momento il file è firmato, e chiunque lo riceva può controllarlo da solo.",
    durataStimata: 27,
  },

  verifica: {
    testo:
      "Ora facciamo la strada al contrario, come farebbe chi riceve il documento. Primo controllo: quanta parte del file è coperta. Secondo controllo: si ricalcola l’impronta sui byte coperti, e si guarda se coincide con quella firmata. Terzo controllo: con la chiave pubblica del certificato si verifica che la firma venga davvero dalla chiave privata corrispondente. Qui passano tutti e tre. Copertura fino all’ultimo byte, documento intatto, autore coerente. Adesso proviamo a romperlo.",
    testoFonetico:
      "Ora facciamo la strada al contrario, come farebbe chi riceve il documento. Primo controllo: quanta parte del file è coperta. Secondo controllo: si ricalcola l’impronta sui byte coperti, e si guarda se coincide con quella firmata. Terzo controllo: con la chiave pubblica del certificato si verifica che la firma venga davvero dalla chiave privata corrispondente. Qui passano tutti e tre. Copertura fino all’ultimo byte, documento intatto, autore coerente. Adesso proviamo a romperlo.",
    durataStimata: 27,
  },

  'attacco-cifra': {
    testo:
      "Cambiamo un byte solo. La prima cifra dell’importo: da mille diventa novemila. Il file resta lungo esattamente come prima, e tutto il resto è al suo posto. Il documento si apre e si legge come sempre. Rifacciamo la verifica. L’impronta ricalcolata non coincide più con quella firmata, e il verdetto è negativo. Un byte è bastato. Le lettere fra parentesi però dicono ancora mille: è la difesa antica contro le falsificazioni, scrivere la somma due volte. Funziona, ma serve qualcuno che legga.",
    testoFonetico:
      "Cambiamo un byte solo. La prima cifra dell’importo: da mille diventa novemila. Il file resta lungo esattamente come prima, e tutto il resto è al suo posto. Il documento si apre e si legge come sempre. Rifacciamo la verifica. L’impronta ricalcolata non coincide più con quella firmata, e il verdetto è negativo. Un byte è bastato. Le lettere fra parentesi però dicono ancora mille: è la difesa antica contro le falsificazioni, scrivere la somma due volte. Funziona, ma serve qualcuno che legga.",
    durataStimata: 31,
  },

  'attacco-lettere': {
    testo:
      "Il documento è tornato allo stato firmato e integro. Adesso falsifichiamo anche le lettere, così cifre e parole concordano di nuovo. Ma la parola nuova è più lunga della vecchia, e il file cresce di tre byte. Il documento dichiara al suo interno quanto è lungo ogni pezzo, e tiene una tabella di indirizzi: ora quei numeri mentono, e gli indirizzi puntano tre byte troppo indietro. Eppure si apre lo stesso. Chi disegna la pagina è indulgente: ricostruisce da solo quello che non torna, e ve la mostra. La firma no. Vedere un documento non è verificarlo.",
    testoFonetico:
      "Il documento è tornato allo stato firmato e integro. Adesso falsifichiamo anche le lettere, così cifre e parole concordano di nuovo. Ma la parola nuova è più lunga della vecchia, e il file cresce di tre byte. Il documento dichiara al suo interno quanto è lungo ogni pezzo, e tiene una tabella di indirizzi: ora quei numeri mentono, e gli indirizzi puntano tre byte troppo indietro. Eppure si apre lo stesso. Chi disegna la pagina è indulgente: ricostruisce da solo quello che non torna, e ve la mostra. La firma no. Vedere un documento non è verificarlo.",
    durataStimata: 36,
  },

  'attacco-coda': {
    testo:
      "Di nuovo, il documento è tornato integro. Questo attacco è diverso, ed è il più insidioso. Non tocchiamo niente di quello che è già firmato: aggiungiamo in fondo. Chi apre il file vede sempre l’ultima versione, quindi vedrà l’importo nuovo. E la firma? La firma è ancora valida, perché i byte che copriva non sono cambiati. Il verdetto allora non può essere pieno: è un avvertimento. La firma tiene, ma copre soltanto una parte del file. Non basta chiedersi se la firma è valida. Bisogna chiedersi fin dove arriva.",
    testoFonetico:
      "Di nuovo, il documento è tornato integro. Questo attacco è diverso, ed è il più insidioso. Non tocchiamo niente di quello che è già firmato: aggiungiamo in fondo. Chi apre il file vede sempre l’ultima versione, quindi vedrà l’importo nuovo. E la firma? La firma è ancora valida, perché i byte che copriva non sono cambiati. Il verdetto allora non può essere pieno: è un avvertimento. La firma tiene, ma copre soltanto una parte del file. Non basta chiedersi se la firma è valida. Bisogna chiedersi fin dove arriva.",
    durataStimata: 33,
  },

  chiusura: {
    testo:
      "Facciamo il punto. Abbiamo visto che la firma si accorge di qualunque modifica, anche di un byte solo, e che dice fin dove arriva la sua protezione. Non abbiamo dimostrato chi sia davvero il firmatario: quello lo garantisce il certificato, e il nostro certificato garantiva se stesso. La matematica qui è vera. La fiducia, nel mondo reale, la costruiscono le autorità e la legge. La firma digitale è un vincolo tecnico; il resto è organizzazione umana.",
    testoFonetico:
      "Facciamo il punto. Abbiamo visto che la firma si accorge di qualunque modifica, anche di un byte solo, e che dice fin dove arriva la sua protezione. Non abbiamo dimostrato chi sia davvero il firmatario: quello lo garantisce il certificato, e il nostro certificato garantiva se stesso. La matematica qui è vera. La fiducia, nel mondo reale, la costruiscono le autorità e la legge. La firma digitale è un vincolo tecnico; il resto è organizzazione umana.",
    durataStimata: 29,
  },
}
