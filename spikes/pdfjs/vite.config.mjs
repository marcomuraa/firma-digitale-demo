// Config dello spike pdf.js. Una variante per build.
// Uso: SPIKE_VARIANT=a npx vite build --config spikes/pdfjs/vite.config.mjs
//      SPIKE_VARIANT=a SPIKE_WORKER_FORMAT=iife npx vite build --config spikes/pdfjs/vite.config.mjs
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

const variante = process.env.SPIKE_VARIANT || 'b';
const formatoWorker = process.env.SPIKE_WORKER_FORMAT || 'es';
const pagine = {
  a: 'spike-a.html',
  b: 'spike-b.html',
  c: 'spike-c.html',
  d: 'spike-d.html',
  e: 'spike-e.html',
  f: 'spike-f.html',
  g: 'spike-g.html',
  h: 'spike-h.html',
  i: 'spike-i.html',
  final: 'spike.html',
};

export default defineConfig({
  root: new URL('.', import.meta.url).pathname,
  base: './',
  define: { __SPIKE_WORKER_FORMAT__: JSON.stringify(formatoWorker) },
  // SPIKE_NO_SINGLEFILE=1 lascia il JS come chunk separato: serve a misurare
  // il bundle grezzo prima dell'inlining.
  plugins: process.env.SPIKE_NO_SINGLEFILE
    ? []
    : [viteSingleFile({ removeViteModuleLoader: true })],
  worker: { format: formatoWorker },
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    assetsInlineLimit: 100 * 1024 * 1024,
    cssCodeSplit: false,
    reportCompressedSize: false,
    chunkSizeWarningLimit: 100000,
    rollupOptions: { input: pagine[variante] },
  },
});
