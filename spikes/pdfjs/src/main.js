// RICETTA DEFINITIVA — e' questo il codice che la fase 5 deve copiare.
// Strada B (fake worker sul thread principale) + font base-14 inlineati.
// Vedi spikes/pdfjs/RECIPE.md per il perche' di ogni riga.
import './sentinel.js';

// 1. Il modulo worker entra nel bundle PRINCIPALE, non in un Worker separato.
import { WorkerMessageHandler } from 'pdfjs-dist/build/pdf.worker.mjs';
import * as pdfjs from 'pdfjs-dist/build/pdf.mjs';
import { STANDARD_FONTS } from './standard-fonts.js';
import { runSpike } from './harness.js';

// 2. Registrandolo qui, PDFWorker usa il "fake worker" e non tenta NESSUN
//    caricamento esterno: niente workerSrc, niente new Worker(), niente import().
globalThis.pdfjsWorker = { WorkerMessageHandler };

function base64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// 3. Gli asset binari (font base-14) arrivano dalla pagina, non dalla rete.
class InlineBinaryDataFactory {
  async fetch({ kind, filename }) {
    if (kind === 'standardFontDataUrl' && STANDARD_FONTS[filename]) {
      return base64ToBytes(STANDARD_FONTS[filename]);
    }
    throw new Error(`asset non inlineato: ${kind}/${filename}`);
  }
}

runSpike({
  strada: 'DEFINITIVA · fake worker + font base-14 inlineati',
  nota: 'strada B della ricetta, con BinaryDataFactory inline',
  pdfjs,
  opzioniExtra: {
    useSystemFonts: false,
    BinaryDataFactory: InlineBinaryDataFactory,
  },
});
