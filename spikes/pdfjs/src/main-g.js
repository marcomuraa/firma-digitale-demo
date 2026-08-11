// VARIANTE G — controprova: useSystemFonts:false SENZA inlineare i font base-14.
// Serve a documentare cosa succede se ci si dimentica del BinaryDataFactory.
import './sentinel.js';
import { WorkerMessageHandler } from 'pdfjs-dist/build/pdf.worker.mjs';
import * as pdfjs from 'pdfjs-dist/build/pdf.mjs';
import { runSpike } from './harness.js';

globalThis.pdfjsWorker = { WorkerMessageHandler };

runSpike({
  strada: 'G · controprova: useSystemFonts:false senza font inlineati',
  nota: 'nessun BinaryDataFactory, standardFontDataUrl null',
  pdfjs,
  opzioniExtra: { useSystemFonts: false },
});
