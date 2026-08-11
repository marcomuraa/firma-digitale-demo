// Banco di prova condiviso dalle varianti dello spike.
// Renderizza pagina 1 del PDF campione su canvas e scrive nel DOM un esito verificabile.
import { netLog, workerLog, consoleLog } from './sentinel.js';
import { SAMPLE_PDF_B64, SAMPLE_PDF_LENGTH } from './sample-pdf.js';

const SCALE = 1.5;
// Banda verticale (frazione dell'altezza) che contiene SOLO testo Times-Roman,
// nessuna grafica vettoriale: i pixel accesi qui provano che i glifi sono stati rasterizzati.
const TEXT_BAND = [0.05, 0.17];
// Banda che contiene SOLO la polilinea vettoriale.
const VECTOR_BAND = [0.78, 0.88];

function base64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function countNonWhite(ctx, width, height, band) {
  const y0 = Math.floor(height * band[0]);
  const y1 = Math.ceil(height * band[1]);
  const { data } = ctx.getImageData(0, y0, width, y1 - y0);
  let n = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i] < 250 || data[i + 1] < 250 || data[i + 2] < 250) n++;
  }
  return n;
}

// Cerca url() esterni nei fogli di stile iniettati da pdf.js per i @font-face.
function externalFontUrls() {
  const found = [];
  for (const sheet of Array.from(document.styleSheets)) {
    let rules;
    try {
      rules = sheet.cssRules;
    } catch {
      continue;
    }
    for (const rule of Array.from(rules || [])) {
      const text = rule.cssText || '';
      for (const m of text.matchAll(/url\(([^)]*)\)/g)) {
        const u = m[1].replace(/['"]/g, '');
        if (!u.startsWith('data:')) found.push(u.slice(0, 120));
      }
    }
  }
  return found;
}

// Un worker rifiutato dal browser non lancia: la promise di pdf.js resta appesa.
// Senza questo timeout lo spike si limiterebbe a non finire, che non e un esito.
const TIMEOUT_MS = 8000;
function withTimeout(promise, etichetta) {
  return Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(
      () => rej(new Error(`timeout ${TIMEOUT_MS} ms in "${etichetta}" — nessuna risposta dal worker`)),
      TIMEOUT_MS,
    )),
  ]);
}

export async function runSpike({ strada, nota, pdfjs, opzioniExtra = {} }) {
  const esito = {
    strada,
    nota,
    versionePdfJs: pdfjs.version,
    pdfByte: SAMPLE_PDF_LENGTH,
  };
  const t0 = performance.now();
  try {
    const task = pdfjs.getDocument({
      data: base64ToBytes(SAMPLE_PDF_B64),
      // Nessuna URL esterna: se pdf.js provasse a scaricare qualcosa, fallirebbe rumorosamente.
      // Nota: devono restare null, non stringhe: getFactoryUrlProp() pretende lo slash finale.
      cMapUrl: null,
      standardFontDataUrl: null,
      wasmUrl: null,
      iccUrl: null,
      useWorkerFetch: false,
      useSystemFonts: true,
      disableFontFace: false,
      stopAtErrors: false,
      verbosity: 1,
      ...opzioniExtra,
    });
    const doc = await withTimeout(task.promise, 'getDocument');
    esito.pagine = doc.numPages;

    const page = await withTimeout(doc.getPage(1), 'getPage');
    const viewport = page.getViewport({ scale: SCALE });
    const canvas = document.getElementById('tela');
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    await withTimeout(page.render({ canvasContext: ctx, viewport }).promise, 'render');

    esito.canvas = `${canvas.width}x${canvas.height}`;
    esito.pixelNonBianchi = countNonWhite(ctx, canvas.width, canvas.height, [0, 1]);
    esito.pixelBandaTesto = countNonWhite(ctx, canvas.width, canvas.height, TEXT_BAND);
    esito.pixelBandaVettoriale = countNonWhite(ctx, canvas.width, canvas.height, VECTOR_BAND);

    const tc = await page.getTextContent();
    esito.testoEstratto = tc.items.map((i) => i.str).join('').trim();

    // Il font Times-Roman non e incorporato: verifichiamo come pdf.js lo ha risolto.
    esito.fontUsatiDalDocumento = Array.from(
      new Set(Array.from(document.fonts).map((f) => f.family)),
    ).join(' | ') || '(nessun FontFace registrato)';
    esito.urlFontEsterni = externalFontUrls();

    esito.msTotali = Math.round(performance.now() - t0);
    esito.errore = null;
    esito.ok = esito.pixelNonBianchi > 0
      && esito.pixelBandaTesto > 0
      && esito.pixelBandaVettoriale > 0
      && esito.urlFontEsterni.length === 0
      && netLog.length === 0;
  } catch (err) {
    esito.ok = false;
    esito.errore = `${err?.name || 'Error'}: ${err?.message || String(err)}`;
    esito.stack = String(err?.stack || '').split('\n').slice(0, 4).join(' / ');
    esito.msTotali = Math.round(performance.now() - t0);
  }

  esito.richiesteDiRete = netLog.slice();
  esito.workerCostruiti = workerLog.slice();
  esito.messaggiConsole = consoleLog.slice();

  const box = document.getElementById('esito');
  box.dataset.esito = esito.ok ? 'ok' : 'errore';
  box.textContent = JSON.stringify(esito, null, 2);
  document.title = `${strada} — ${esito.ok ? 'OK' : 'ERRORE'}`;
  document.body.dataset.pronto = '1';
  return esito;
}
