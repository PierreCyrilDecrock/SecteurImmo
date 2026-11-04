#!/usr/bin/env bash
# Lance SecteurImmo : sert le dossier sur http://localhost:8000 et ouvre le navigateur.
# (Un vrai serveur local est nécessaire : OpenStreetMap bloque les pages ouvertes en file://)
cd "$(dirname "$0")" || exit 1
PORT="${1:-8000}"
URL="http://localhost:$PORT"

if command -v python3 >/dev/null 2>&1; then PY=python3
elif command -v python >/dev/null 2>&1; then PY=python
else
  echo "Python est introuvable. Installez-le depuis https://www.python.org/downloads/ puis relancez."
  exit 1
fi

# Ouvre le navigateur après un court délai (macOS : open, Linux : xdg-open)
( sleep 1; (open "$URL" || xdg-open "$URL") >/dev/null 2>&1 ) &

echo "SecteurImmo disponible sur $URL  (Ctrl+C pour arrêter)"
exec "$PY" -m http.server "$PORT" --bind 127.0.0.1
