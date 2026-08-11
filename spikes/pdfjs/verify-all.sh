#!/bin/zsh
# Esegue ogni variante dello spike in Chrome headless (tempo reale, via CDP),
# ripetuta N volte, e stampa una tabella riassuntiva.
# Uso: ./verify-all.sh [ripetizioni]
HERE="${0:A:h}"
RIP="${1:-2}"
# spike-h e escluso: e una sonda di sola misura, non renderizza nulla.
VARIANTI=(spike-a-es spike-a-iife spike-b spike-c spike-d spike-e spike-f spike-g spike spike-i)

printf '%-18s %-8s %-6s %-9s %-9s %s\n' VARIANTE ESITO BYTE PXTESTO PXVETT NOTE
for v in $VARIANTI; do
  byte=$(wc -c < "$HERE/dist/$v.html" | tr -d ' ')
  for i in $(seq 1 $RIP); do
    out=$(node "$HERE/cdp-run.mjs" "dist/$v.html" --attesa 25000 2>/dev/null)
    stato=$(print -r -- "$out" | sed -n 's/^data-esito: //p')
    pxt=$(print -r -- "$out" | sed -n 's/.*"pixelBandaTesto": \([0-9]*\).*/\1/p' | head -1)
    pxv=$(print -r -- "$out" | sed -n 's/.*"pixelBandaVettoriale": \([0-9]*\).*/\1/p' | head -1)
    err=$(print -r -- "$out" | sed -n 's/.*"errore": "\([^"]*\)".*/\1/p' | head -1)
    ref=$(print -r -- "$out" | grep -c 'Refused to cross-origin')
    note="${err:-}"
    [[ "$ref" != "0" ]] && note="worker rifiutato dal browser"
    printf '%-18s %-8s %-6s %-9s %-9s %s\n' "$v#$i" "${stato:-?}" "$byte" "${pxt:-0}" "${pxv:-0}" "$note"
  done
done
