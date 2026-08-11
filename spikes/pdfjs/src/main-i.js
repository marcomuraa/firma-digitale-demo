// PROBE I — de-risking degli attacchi: come si comporta pdf.js sui byte manomessi?
// ESITO MISURATO (vedi RECIPE.md): pdf.js renderizza TUTTI E TRE i casi.
// L'attacco 1b non rompe il rendering come previsto dal piano: pdf.js ricostruisce
// la tabella xref da solo e stampa "Warning: Indexing all PDF objects".
// Quell'avviso e' l'unico appiglio onesto per raccontare in pagina che il file e' incoerente.
import { consoleLog } from './sentinel.js';
import { WorkerMessageHandler } from 'pdfjs-dist/build/pdf.worker.mjs';
import * as pdfjs from 'pdfjs-dist/build/pdf.mjs';
import { STANDARD_FONTS } from './standard-fonts.js';
import { SAMPLE_PDF_B64 } from './sample-pdf.js';

globalThis.pdfjsWorker = { WorkerMessageHandler };

function base64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

class InlineBinaryDataFactory {
  async fetch({ kind, filename }) {
    if (kind === 'standardFontDataUrl' && STANDARD_FONTS[filename]) {
      return base64ToBytes(STANDARD_FONTS[filename]);
    }
    throw new Error(`asset non inlineato: ${kind}/${filename}`);
  }
}

const OPZIONI = {
  cMapUrl: null,
  standardFontDataUrl: null,
  wasmUrl: null,
  iccUrl: null,
  useWorkerFetch: false,
  useSystemFonts: false,
  BinaryDataFactory: InlineBinaryDataFactory,
  stopAtErrors: false,
  verbosity: 1,
};

const originale = base64ToBytes(SAMPLE_PDF_B64);
const testo = new TextDecoder('latin1').decode(originale);

// 1a — sostituzione a lunghezza invariata: la struttura del file resta valida.
const offset1a = testo.indexOf('1.000 euro');
const cifra = originale.slice();
cifra[offset1a] = '9'.charCodeAt(0);

// 1b — sostituzione che allunga il content stream: /Length e xref diventano falsi.
const lettere = new TextEncoder().encode(testo.replace('mille euro', 'novemila euro'));

async function prova(nome, bytes) {
  const esito = { nome, byte: bytes.length };
  const daQui = consoleLog.length;
  try {
    const doc = await pdfjs.getDocument({ data: bytes.slice(), ...OPZIONI }).promise;
    const page = await doc.getPage(1);
    const viewport = page.getViewport({ scale: 1 });
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let n = 0;
    for (let i = 0; i < data.length; i += 4) if (data[i] < 250) n++;
    esito.renderizzato = true;
    esito.pixelNonBianchi = n;
    esito.testo = (await page.getTextContent()).items.map((i) => i.str).join('').trim();
    esito.errore = null;
  } catch (err) {
    esito.renderizzato = false;
    esito.errore = `${err?.name}: ${err?.message}`;
  }
  // Anche quando pdf.js recupera, lo dice: sono questi i messaggi da mostrare in pagina.
  esito.avvisiDiPdfJs = consoleLog.slice(daQui);
  return esito;
}

const risultati = [
  await prova('originale', originale),
  await prova('attacco 1a — cifra falsificata, lunghezza invariata', cifra),
  await prova('attacco 1b — lettere falsificate, /Length e xref rotti', lettere),
];

// L'esito e' "ok" se pdf.js si comporta in modo governabile:
// 1a renderizza e mostra la cifra cambiata, 1b non fa esplodere la pagina
// (renderizzi o fallisca, purche' con un errore catturabile).
const ok = risultati[0].renderizzato
  && risultati[1].renderizzato
  && risultati[1].testo.includes('9.000')
  && (risultati[2].renderizzato || typeof risultati[2].errore === 'string');

const box = document.getElementById('esito');
box.dataset.esito = ok ? 'ok' : 'errore';
box.textContent = JSON.stringify({ offset1a, risultati, ok }, null, 2);
document.body.dataset.pronto = '1';
