#!/bin/zsh
# Misura il costo in byte di ogni variante: bundle JS grezzo (prima dell'inlining),
# file singolo, e gzip. Ricostruisce tutto da zero.
# Uso: ./misura-byte.sh
HERE="${0:A:h}"
ROOT="${HERE:h:h}"
cd "$ROOT"

printf '%-16s %14s %14s %14s\n' VARIANTE 'BUNDLE JS' 'FILE SINGOLO' GZIP
for v in h b f final; do
  tmp="$HERE/dist-raw-$v"
  SPIKE_NO_SINGLEFILE=1 SPIKE_VARIANT=$v npx vite build --config "$HERE/vite.config.mjs" \
    --outDir "$tmp" >/dev/null 2>&1
  SPIKE_VARIANT=$v npx vite build --config "$HERE/vite.config.mjs" >/dev/null 2>&1
  raw=$(cat "$tmp"/assets/*.js | wc -c | tr -d ' ')
  pagina="$HERE/dist/spike-$v.html"
  [[ $v == final ]] && pagina="$HERE/dist/spike.html"
  printf '%-16s %14d %14d %14d\n' "$v" "$raw" "$(wc -c <"$pagina")" "$(gzip -c "$pagina" | wc -c)"
  rm -rf "$tmp"
done
echo
echo 'h = solo API pdf.js (non renderizza)   b = ricetta senza font inlineati'
echo 'f = b + font base-14 inlineati        final = ricetta definitiva'
