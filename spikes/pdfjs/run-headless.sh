#!/bin/zsh
# Esegue una pagina dello spike in Chrome headless da file:// e stampa l'esito nel DOM.
# Uso: ./run-headless.sh dist/spike-b.html
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
HERE="${0:A:h}"
TARGET="$1"
[[ "$TARGET" = /* ]] || TARGET="$HERE/$TARGET"
"$CHROME" --headless=new --disable-gpu --no-sandbox \
  --virtual-time-budget=20000 --dump-dom "file://$TARGET" 2>/dev/null \
  | python3 "$HERE/extract-esito.py"
