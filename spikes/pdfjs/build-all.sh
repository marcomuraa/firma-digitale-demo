#!/bin/zsh
# Costruisce tutte le varianti dello spike in spikes/pdfjs/dist e ne stampa il peso.
set -e
HERE="${0:A:h}"
ROOT="${HERE:h:h}"
cd "$ROOT"
rm -rf "$HERE/dist"
mkdir -p "$HERE/dist"

node "$HERE/make-sample-pdf.mjs"

build() {  # $1 = variante, $2 = formato worker, $3 = nome finale
  SPIKE_VARIANT="$1" SPIKE_WORKER_FORMAT="$2" \
    npx vite build --config "$HERE/vite.config.mjs" >/dev/null
  if [[ -n "$3" ]]; then mv "$HERE/dist/spike-$1.html" "$HERE/dist/$3"; fi
}

build a es   spike-a-es.html
build a iife spike-a-iife.html
build b es   ''
build c es   ''
build d es   ''
build e es   ''
build f es   ''
build g es   ''
build h es   ''   # sonda di sola misura: non renderizza
build i es   ''   # sonda: comportamento di pdf.js sui byte manomessi
build final es ''

echo
echo "peso dei file prodotti (byte):"
for f in "$HERE"/dist/*.html; do
  printf '  %-24s %10d\n' "${f:t}" "$(wc -c < "$f")"
done
