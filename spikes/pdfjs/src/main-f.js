// VARIANTE F — come B, ma i font base-14 NON dipendono dal sistema:
// useSystemFonts:false + un BinaryDataFactory che serve i byte gia inlineati.
import './sentinel.js';
import { WorkerMessageHandler } from 'pdfjs-dist/build/pdf.worker.mjs';
import * as pdfjs from 'pdfjs-dist/build/pdf.mjs';
import { STANDARD_FONTS } from './standard-fonts.js';
import { runSpike } from './harness.js';

globalThis.pdfjsWorker = { WorkerMessageHandler };

function base64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// pdf.js chiede gli asset binari (font base-14, CMap, wasm) al BinaryDataFactory
// quando useWorkerFetch e false. Qui non c'e nessun fetch: solo byte gia in pagina.
class InlineBinaryDataFactory {
  constructor() {
    this.mancanti = [];
  }

  async fetch({ kind, filename }) {
    if (kind === 'standardFontDataUrl' && STANDARD_FONTS[filename]) {
      return base64ToBytes(STANDARD_FONTS[filename]);
    }
    this.mancanti.push(`${kind}/${filename}`);
    throw new Error(`asset non inlineato: ${kind}/${filename}`);
  }
}

runSpike({
  strada: 'F · fake worker + font base-14 inlineati (useSystemFonts:false)',
  nota: 'BinaryDataFactory personalizzato, zero fetch',
  pdfjs,
  opzioniExtra: {
    useSystemFonts: false,
    BinaryDataFactory: InlineBinaryDataFactory,
  },
});
