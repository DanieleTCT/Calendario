#!/bin/bash
# AVVIA-BOT.sh - accende il ponte Telegram <-> Sito-calendario (Git Bash / Linux / NAS)
# Uso:  ./AVVIA-BOT.sh   (oppure: bash AVVIA-BOT.sh)
cd "$(dirname "$0")"
if [ -f .env ]; then set -a; source .env 2>/dev/null; set +a; fi
export API_BASE_URL="${API_BASE_URL:-http://localhost:3000/api}"
if [ -z "$TELEGRAM_BOT_TOKEN" ]; then
  echo "[ERRORE] TELEGRAM_BOT_TOKEN mancante."
  echo "  1) Aggiungi nel file .env la riga:"
  echo "     TELEGRAM_BOT_TOKEN=il_tuo_token"
  echo "  2) Oppure lancialo al volo:"
  echo '     TELEGRAM_BOT_TOKEN=xxx API_BASE_URL=http://localhost:3000/api node scripts/telegram-bot.mjs'
  exit 1
fi
echo "[OK] API=$API_BASE_URL"
echo "[INFO] Ponte Telegram attivo. Non chiudere questa finestra. CTRL+C per spegnere."
node scripts/telegram-bot.mjs
