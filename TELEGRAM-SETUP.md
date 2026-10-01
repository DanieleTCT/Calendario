# Telegram per Sito-calendario (locale, polling)

## Sul telefono (2 minuti, mentre il PC si prepara)
1. Apri Telegram e cerca **@BotFather**.
2. Inviagli `/newbot`, rispondi:
   - nome visualizzato: es. `Mio Calendario`
   - username: es. `mio_calendario_xyz_bot` (deve finire con `bot`).
3. BotFather ti restituisce il **TOKEN** (tipo `123456:ABC...`).
   - Copialo su un appunto, ti servira sul PC.
   - Comandi utili in BotFather: `/setdescription`, `/setabouttext`, `/setcommands`.
4. Nel tuo bot appena creato premi **AVVIA**, poi inviagli `/start`.
5. Resta li: tra poco gli manderai i primi messaggi di prova.

## Sul PC (ambiente pronto, codice gia creato)
File creati:
- `scripts/telegram-bot.mjs` (bot polling, zero dipendenze)
- `apps/api/src/ai-chat-types.ts` (tipo condiviso)

## Avvio rapido (PowerShell, cartella progetto)
```powershell
$env:TELEGRAM_BOT_TOKEN="INSERISCI_TOKEN_QUI"
$env:API_BASE_URL="http://localhost:3000/api"
node scripts/telegram-bot.mjs
```
Il bot resta in ascolto (long-polling: funziona dietro NAT, nessun port-forward).

## Sicurezza (consigliato)
Solo i tuoi ID Telegram possono usarlo:
```powershell
$env:TELEGRAM_ALLOWED_IDS="123456789"
```
Per scoprire il tuo ID: manda un messaggio al bot, poi apri
`https://api.telegram.org/bot<TOKEN>/getUpdates` e leggi `from.id`.

## Comandi del bot
/oggi /settimana /cerca <parola> /libero <AAAA-MM-GG> /azioni /approva /rifiuta /aiuto
+ testo libero in italiano (stesso AI del sito, stessi 12 tool).
Le modifiche arrivano con bottoni Approva/Rifiuta; se il pulsante non arriva,
basta scrivere `approva` o `rifiuta` (o usare `/approva` / `/rifiuta`).
`/azioni` mostra le richieste in attesa e re-invia i bottoni.
