// Sentinella di rete: va importata PER PRIMA, prima di pdf.js.
// Intercetta ogni possibile richiesta esterna e la registra invece di lasciarla passare.
export const netLog = [];      // richieste di rete vere (fetch/XHR)
export const workerLog = [];   // costruzioni di Worker: non sono rete, ma vanno viste
export const consoleLog = [];

const record = (kind, detail) => {
  const riga = `${kind}: ${String(detail).slice(0, 200)}`;
  (kind === 'worker' ? workerLog : netLog).push(riga);
};

const origFetch = globalThis.fetch;
globalThis.fetch = function (input, init) {
  record('fetch', typeof input === 'string' ? input : input?.url);
  return origFetch.call(this, input, init);
};

const OrigXHR = globalThis.XMLHttpRequest;
if (OrigXHR) {
  const origOpen = OrigXHR.prototype.open;
  OrigXHR.prototype.open = function (method, url, ...rest) {
    record('xhr', `${method} ${url}`);
    return origOpen.call(this, method, url, ...rest);
  };
}

const OrigWorker = globalThis.Worker;
if (OrigWorker) {
  globalThis.Worker = new Proxy(OrigWorker, {
    construct(target, args) {
      record('worker', args[0]);
      return Reflect.construct(target, args);
    },
  });
}

const origWarn = console.warn;
console.warn = function (...args) {
  consoleLog.push(`warn: ${args.map(String).join(' ')}`);
  return origWarn.apply(this, args);
};
const origError = console.error;
console.error = function (...args) {
  consoleLog.push(`error: ${args.map(String).join(' ')}`);
  return origError.apply(this, args);
};

globalThis.addEventListener?.('error', (e) => {
  consoleLog.push(`window.onerror: ${e.message || e.type} @ ${e.filename || '?'}`);
});
globalThis.addEventListener?.('unhandledrejection', (e) => {
  consoleLog.push(`unhandledrejection: ${e.reason?.message || String(e.reason)}`);
});

// Aggancia i gestori di errore su un Worker: senza questi, un worker rifiutato
// dal browser fa restare la pagina in attesa per sempre, senza diagnostica.
export function watchWorker(worker) {
  worker.addEventListener('error', (e) => {
    consoleLog.push(`worker.onerror: ${e.message || '(evento senza messaggio)'} @ ${e.filename || '?'}:${e.lineno ?? '?'}`);
  });
  worker.addEventListener('messageerror', () => {
    consoleLog.push('worker.onmessageerror');
  });
  return worker;
}
