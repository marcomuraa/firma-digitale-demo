// Esegue una pagina dello spike in Chrome headless pilotato via DevTools Protocol.
// Perche' non basta --dump-dom: con --virtual-time-budget i Worker veri vengono
// affamati e un ritardo diventa indistinguibile da un blocco. Qui il tempo e' reale
// e in piu' si contano le richieste di rete viste dal browser, non dalla pagina.
//
// Uso: node spikes/pdfjs/cdp-run.mjs dist/spike.html [--attesa 30000]
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const argomenti = process.argv.slice(2);
const bersaglio = argomenti.find((a) => !a.startsWith('--'));
const attesaMs = Number(argomenti[argomenti.indexOf('--attesa') + 1]) || 30000;

let url = bersaglio;
if (!/^\w+:/.test(url)) {
  const p = resolve(new URL('.', import.meta.url).pathname, url);
  if (!existsSync(p)) {
    console.error(`file inesistente: ${p}`);
    process.exit(2);
  }
  url = `file://${p}`;
}

// --headful apre una finestra vera: serve a controllare che il comportamento
// da doppio click coincida con quello headless.
const headful = argomenti.includes('--headful');

const profilo = mkdtempSync(join(tmpdir(), 'spike-chrome-'));
const chrome = spawn(CHROME, [
  ...(headful ? ['--window-size=900,700'] : ['--headless=new', '--disable-gpu']),
  '--remote-debugging-port=0',
  `--user-data-dir=${profilo}`,
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-extensions',
  'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] });

const wsBrowser = await new Promise((res, rej) => {
  let buf = '';
  const t = setTimeout(() => rej(new Error('Chrome non ha aperto la porta di debug')), 20000);
  chrome.stderr.on('data', (d) => {
    buf += d;
    const m = buf.match(/DevTools listening on (ws:\S+)/);
    if (m) { clearTimeout(t); res(m[1]); }
  });
});

let idSeq = 0;
const attese = new Map();
const eventi = [];
const ws = new WebSocket(wsBrowser);
await new Promise((res) => ws.addEventListener('open', res, { once: true }));
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && attese.has(msg.id)) {
    const { res, rej } = attese.get(msg.id);
    attese.delete(msg.id);
    msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result);
  } else if (msg.method) {
    eventi.push(msg);
  }
});

function invia(method, params = {}, sessionId) {
  const id = ++idSeq;
  return new Promise((res, rej) => {
    attese.set(id, { res, rej });
    ws.send(JSON.stringify({ id, method, params, sessionId }));
  });
}

const { targetId } = await invia('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await invia('Target.attachToTarget', { targetId, flatten: true });

await invia('Network.enable', {}, sessionId);
await invia('Runtime.enable', {}, sessionId);
await invia('Log.enable', {}, sessionId);
await invia('Page.enable', {}, sessionId);
await invia('Page.navigate', { url }, sessionId);

const scadenza = Date.now() + attesaMs;
let stato = 'in-corso';
let esito = null;
while (Date.now() < scadenza) {
  await new Promise((r) => setTimeout(r, 200));
  try {
    const r = await invia('Runtime.evaluate', {
      expression: 'JSON.stringify({ stato: document.getElementById("esito")?.dataset.esito ?? "assente",'
        + ' testo: document.getElementById("esito")?.textContent ?? "" })',
      returnByValue: true,
    }, sessionId);
    const v = JSON.parse(r.result.value);
    stato = v.stato;
    esito = v.testo;
    if (stato === 'ok' || stato === 'errore') break;
  } catch { /* la pagina sta ancora navigando */ }
}

const richieste = eventi
  .filter((e) => e.method === 'Network.requestWillBeSent')
  .map((e) => `${e.params.type} ${e.params.request.url.slice(0, 110)}`);
const messaggi = eventi
  .filter((e) => e.method === 'Log.entryAdded')
  .map((e) => `[${e.params.entry.level}] ${e.params.entry.text}`.slice(0, 200));
const eccezioni = eventi
  .filter((e) => e.method === 'Runtime.exceptionThrown')
  .map((e) => (e.params.exceptionDetails.exception?.description
    || e.params.exceptionDetails.text).slice(0, 200));

console.log(`URL:        ${url}`);
console.log(`data-esito: ${stato}`);
console.log(esito || '(nessun blocco #esito)');
console.log(`\nrichieste di rete viste dal browser (${richieste.length}):`);
for (const r of richieste) console.log(`  - ${r}`);
console.log(`\nmessaggi del browser (${messaggi.length}):`);
for (const m of messaggi) console.log(`  - ${m}`);
if (eccezioni.length) {
  console.log(`\neccezioni non catturate (${eccezioni.length}):`);
  for (const e of eccezioni) console.log(`  - ${e}`);
}

ws.close();
chrome.kill();
try { rmSync(profilo, { recursive: true, force: true, maxRetries: 3 }); } catch { /* Chrome sta ancora chiudendo */ }
process.exit(stato === 'ok' ? 0 : 1);
