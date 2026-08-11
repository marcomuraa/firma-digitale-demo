/**
 * Il lessico della cornice — e SOLO della cornice.
 *
 * Il testo che racconta la demo sta in src/ui/copy.it.js e non si riscrive qui: quello è il
 * contenuto. Qui stanno le parole che una pagina deve avere comunque e che nessun pannello
 * fornisce: le etichette prestampate dei campi, i nomi dei comandi, le due parole della doppia
 * modalità, le tre parole del verdetto. Tenerle in un file solo rende evidente, a chi rilegge,
 * quale testo è contenuto e quale è modulistica.
 *
 * Registro: quello di un registro di protocollo. Etichette brevi, maiuscole, senza verbi; i
 * comandi invece dicono esattamente che cosa succede quando si premono («Registra l’atto…»,
 * «Ripristina il documento firmato»), e la parola resta la stessa dal bottone al risultato.
 *
 * Ortografia: italiano pieno, accenti e apostrofi tipografici compresi. Il vincolo ASCII vale
 * per il PDF campione (docs/pdf-campione.md), non per questa pagina, che è UTF-8: scrivere
 * «modalita» su una carta bollata sarebbe un refuso, non un vincolo.
 */

/** Intestazione del registro. */
export const TESTATA = {
  ente: 'Registro degli atti',
  titolo: 'Firma digitale PAdES su documento PDF',
}

/** I comandi. */
export const COMANDI = {
  registra: 'Registra l’atto',
  inCorso: 'Atto in corso',
  completo: 'Fascicolo completo',
  ripristina: 'Ripristina il documento firmato integro',
  ripristinaBreve: 'Ripristina',
  reset: 'Ricomincia il fascicolo da capo',
  resetBreve: 'Ricomincia',
  apriNota: 'Apri la nota',
  apriDump: 'Apri il dump esadecimale',
  apriAsn1: 'Apri la struttura ASN.1',
  indice: 'Indice dei dodici atti',
  salta: 'Salta al fascicolo',
}

/** La doppia modalità. */
export const MODALITA = {
  presentazione: 'Presentazione',
  studio: 'Studio',
  descrizione: {
    presentazione: 'Modalità presentazione: si legge da tre metri. Premi per passare a studio.',
    studio: 'Modalità studio: tutti i testi aperti. Premi per passare a presentazione.',
  },
}

/** Le marche a margine: che cosa è questo foglio, e a che punto sta. */
export const MARGINE = {
  atto: 'Atto',
  nota: 'Nota',
}

/** Il righello dei byte. */
export const RIGHELLO = {
  nome: 'Fascia di repertorio: il file intero, a scala reale',
  vuoto: 'Nessun documento: il fascicolo è ancora vuoto',
  coperti: 'Firmati',
  buco: 'Buco',
  coda: 'Coda',
  file: 'File',
  legenda: [
    { kind: 'object', coperto: true, testo: 'Oggetto firmato' },
    { kind: 'structure', coperto: true, testo: 'Struttura firmata' },
    { kind: 'object', coperto: false, testo: 'Non firmato' },
    { kind: 'hole', coperto: false, testo: 'Buco /Contents' },
    { kind: 'tail', coperto: false, testo: 'Coda non coperta' },
  ],
}

/**
 * Il verdetto: forma, parola e colore. Mai il colore da solo.
 *
 * `parola` è la dicitura per esteso del timbro; `breve` è la stessa cosa in una cella di
 * tabella, dove per esteso non ci sta. Servono tutte e due, e nessuna delle due è il valore
 * dell’enum: `valid` / `invalid` / `extended` sono nomi che il programma dà a se stesso, e in
 * una pagina italiana non si leggono a voce alta — men che meno nella riga di chiusura, che è
 * l’ultima cosa che si vede prima delle note.
 */
export const VERDETTO = {
  valid: { segno: '✓', parola: 'Valida e completa', breve: 'Valida' },
  extended: { segno: '▲', parola: 'Valida, documento esteso dopo la firma', breve: 'Estesa' },
  invalid: { segno: '✕', parola: 'Non valida', breve: 'Non valida' },
  assente: { segno: '·', parola: 'Non ancora verificata', breve: 'Non verificata' },
}

/** I tre controlli della verifica, con le due parole che li chiudono. */
export const CONTROLLI = {
  copertura: 'Copertura',
  integrita: 'Integrità',
  firma: 'Firma',
  torna: 'torna',
  nonTorna: 'non torna',
  completa: 'completa',
  incompleta: 'incompleta',
}

/** L’allegato: il documento come lo vede un lettore, adesso. */
export const ALLEGATO = {
  titolo: 'Allegato: il documento adesso',
  nessuno: 'Nessun documento',
  attesa: 'Il documento comparirà qui dopo il primo atto.',
  avvisi: 'Avvisi del lettore PDF',
  guasto: 'Il lettore non ha disegnato il documento',
  etichette: {
    originale: 'Originale, non firmato',
    'con-placeholder': 'Con il buco /Contents, non ancora firmato',
    firmato: 'Firmato',
    'manomesso-cifra': 'Manomesso nella cifra',
    'manomesso-lettere': 'Manomesso nelle lettere',
    'esteso-in-coda': 'Esteso dopo la firma',
  },
}

/** Il fascicolo vuoto: un invito, non un lamento. */
export const VUOTO = 'Il fascicolo è vuoto. Registra il primo atto per cominciare.'

/** Le etichette prestampate dei campi. Nessuna frase: solo nomi di campo. */
export const CAMPI = {
  lunghezza: 'Byte del file',
  crescita: 'Byte aggiunti',
  lunghezzaPrima: 'Byte prima',
  sha256: 'SHA-256 del file',
  tenore: 'Tenore del documento',
  algoritmo: 'Algoritmo',
  hash: 'Impronta',
  modulusBits: 'Lunghezza della chiave',
  modulo: 'Modulo RSA',
  esponente: 'Esponente pubblico',
  soggetto: 'Soggetto',
  emittente: 'Emittente',
  autofirmato: 'Autofirmato',
  serial: 'Numero di serie',
  validoDa: 'Valido dal',
  validoA: 'Valido al',
  improntaCert: 'Impronta del certificato',
  byteRange: '/ByteRange dichiarato',
  contentsStart: 'Inizio del buco',
  contentsEnd: 'Fine del buco',
  padding: 'Spazio riservato',
  signingTime: 'Ora dichiarata di firma',
  improntaDoc: 'Impronta del documento',
  intervalli: 'Intervalli coperti',
  byteCoperti: 'Byte coperti',
  byteNonCoperti: 'Byte non coperti',
  cmsLunghezza: 'Byte del CMS',
  firmaRsa: 'Firma RSA',
  signedAttrs: 'Attributi firmati',
  byteCms: 'Byte occupati dalla firma',
  capacitaBuco: 'Capacità del buco',
  zeri: 'Riempimento a zero',
  offsetAttacco: 'Offset colpito',
  daA: 'Da / a',
  delta: 'Variazione di lunghezza',
  testoDopo: 'Il documento adesso dice',
  lengthDichiarato: '/Length dichiara',
  lengthReale: 'Byte reali nello stream',
  xrefRotta: 'Disallineamenti xref',
  rendererApre: 'Il lettore lo apre lo stesso',
  bucoCoincide: 'Il buco dichiarato coincide con quello vero',
  appendedFrom: 'La coda comincia a',
  byteAppesi: 'Byte appesi',
  attesa: 'Attesa dalla firma',
  riscontro: 'Riscontrata adesso',
  identita: 'Identità riletta dal file',
  fingerprint: 'Impronta del certificato riletto',
  firmeTrovate: 'Firme trovate nel file',
  ragione: 'Ragione',
  bersaglio: 'il bersaglio dei prossimi attacchi',
  si: 'sì',
  no: 'no',
}

/** Riepilogo di chiusura: le intestazioni della tabella dei quattro verdetti. */
export const RIEPILOGO = {
  passo: 'Atto',
  lunghezza: 'Byte',
  verdetto: 'Verdetto',
  impronta: 'Impronta',
  firma: 'Firma',
  coda: 'Coda',
  copertura: 'Copertura',
}
