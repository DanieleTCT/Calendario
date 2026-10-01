# 📅 Calendario AI Powered

Un'applicazione web completa per gestire il tuo calendario, task e attività con l'aiuto di un assistente AI intelligente.

## 🚀 Caratteristiche

✅ **Calendario e Task Management**
- Gestione eventi e task
- Ricorrenze giornaliere, settimanali, mensili
- Ricerca e filtri
- Calcolo slot liberi

✅ **Assistente AI Agentico**
- Conversazioni persistenti
- Streaming in tempo reale
- Approvazione manuale delle azioni
- Tool read-only e modificativi

✅ **Multi-Provider Support**
- 🟦 **Google Gemini** - Cloud AI potente
- 🔗 **OpenRouter** - Accesso a molteplici modelli
- 🏠 **Ollama** - AI locale (5-6GB VRAM)
- 🧪 **Demo Provider** - Perfetto per i test

✅ **Storage Flessibile (auto-switch)**
- **Supabase/Postgres** quando `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` sono impostate (cloud/Vercel)
- **JSON locale** altrimenti, nel volume `data/` (NAS / dev) — nessun dato perso al riavvio
- Export/Import dati, backup automatici (modalità JSON)

✅ **Deploy Flessibile**
- **Vercel + Supabase** (accesso da ovunque) oppure **NAS/Docker** (solo LAN + VPN)
- Stessa codebase: cambia solo dove vivono i dati (env var), non il codice

## 📋 Requisiti

- Node.js >= 18
- npm >= 9

Per Ollama locale:
- Ollama installato (https://ollama.ai)
- ~5-6GB di VRAM disponibili

## 🔧 Installazione

```bash
# Clona il progetto
cd Sito-calendario

# Installa dipendenze (monorepo)
npm install

# Crea file .env dalla configurazione di esempio
cp .env.example .env
```

## 🎯 Configurazione API

### Gemini (Google)
1. Vai su https://ai.google.dev
2. Ottieni una chiave API gratuita
3. Nella app, vai a ⚙️ Impostazioni
4. Incolla la chiave in "Gemini API Key"

### OpenRouter
1. Registrati su https://openrouter.ai
2. Vai al Dashboard > Keys
3. Copia la tua API Key
4. Nella app, vai a ⚙️ Impostazioni
5. Incolla la chiave in "OpenRouter API Key"

### Ollama (IA Locale)
```bash
# Installa Ollama
# Windows: https://ollama.ai/download/windows
# macOS: https://ollama.ai/download/macos
# Linux: https://ollama.ai/download/linux

# Scarica un modello leggero
ollama pull mistral    # ~4.1GB
# oppure
ollama pull neural-chat # ~4.1GB
# oppure
ollama pull phi         # ~2.7GB

# Avvia Ollama (default: http://localhost:11434)
ollama serve

# Nella app, vai a ⚙️ Impostazioni
# Inserisci:
# - URL Ollama: http://localhost:11434
# - Modello: mistral (o quello che hai scaricato)
```

## 🚀 Avvio

### Development

```bash
npm run dev          # Backend (3000) + Frontend (5173) insieme
# oppure separati:
npm run dev:api      # http://localhost:3000
npm run dev:web      # http://localhost:5173
```
Apri http://localhost:5173 nel browser.
In dev, storage JSON in `./data` (a meno che `SUPABASE_*` non sia impostata).

### Verifiche rapide (consigliate dopo una modifica)

```bash
npm run build            # build frontend + bundle API (apps/api/dist/server.js + api/index.js)
npm run test:serverless  # build + serve il bundle serverless e verifica /api/health (porta 4000)
npm run test:supabase-mock  # CRUD/parametri Supabase "offline" (nessuna credenziale/rete)
npm run test:supabase       # verifica reale su Supabase (richiede SUPABASE_* in .env)
```

### Production (NAS/Docker)

```bash
npm run build
cd apps/api && npm start     # serve API + frontend buildato (apps/web/dist)
```
Su NAS tutto-in-uno: `docker compose up -d --build` (vedi `NAS-README.md`).

## 📁 Struttura Progetto

```
Sito-calendario/
├── api/index.js          # Handler serverless per Vercel (GENERATO da scripts/build-api.mjs)
├── apps/
│   ├── api/              # Backend Node.js + Express (+ polito/, routes/)
│   └── web/              # Frontend React + Vite
├── packages/
│   ├── domain/           # Tipi e regole di dominio
│   ├── storage/          # Repository: JsonRepository + SupabaseRepository + createRepository()
│   └── agent/            # Runtime agentico e provider AI
├── supabase/schema.sql   # Schema DB Supabase (eseguire nel SQL Editor)
├── scripts/              # build-api, vercel-handler, test-serverless, test-supabase(-mock)
├── vercel.json           # Config deploy Vercel (build, rewrites, function)
├── .env.example          # Config NAS/dev (JSON locale)
├── .env.vercel.example   # Config Vercel/Supabase (da copiare in Environment Variables)
└── README.md
```

### Come sceglie il database

`packages/storage/src/index.ts` → `createRepository()`:

| Env var presenti | Storage usato | Dove |
|---|---|---|
| `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` | Supabase/Postgres | Vercel / cloud |
| nessuna delle due | JSON (`DATA_DIR` o `/app/data`) | NAS, Docker, dev |

Entrambi implementano la stessa interfaccia `Repository`: nessuna logica applicativa cambia.

## 🤖 Come Usare l'Assistente AI

### Esempi di comandi

```
"Crea un evento domani alle 10 AM"
"Trova tempo libero questa settimana"
"Quanti task ho in sospeso?"
"Segna il task 'Completare report' come fatto"
"Che appuntamenti ho lunedì?"
"Crea una riunione ricorrente ogni venerdì"
"Mostra i miei task in ritardo"
```

### Flusso di Approvazione

1. **Richiedi un'azione**: "Crea un evento..."
2. **L'AI propone**: Visualizza l'azione e chiede approvazione
3. **Tu approvi/rifiuti**: Clicca "Approva" o "Rifiuta"
4. **L'AI esegue**: Se approvato, applica il cambiamento

⚠️ **Le mutazioni (create/update/delete) richiedono sempre approvazione manuale**

## 📊 Dati e Storage

### Default: JSON File Storage
I dati sono salvati in `./data/data.json` in formato atomico.

### Backup Automatico
Prima di ogni importazione, viene creato un backup:
```
./data/data.json.backup-1703000000000
```

### Export Manuale
Scarica i tuoi dati dalle impostazioni in formato JSON.

### Import
Importa dati da backup o da un'altra installazione.

## 🧪 Test

```bash
# Esegui i test (all'interno di ogni package)
npm test --workspaces

# Test specifico
cd packages/domain
npm test
```

## 🐛 Troubleshooting

### "Cannot connect to API"
- Verifica che `apps/api` sia in esecuzione su `http://localhost:3000`
- Controlla il `.env` file

### "Ollama offline"
- Assicurati che `ollama serve` sia in esecuzione
- Verifica l'URL in Impostazioni (default: `http://localhost:11434`)
- Controlla se il modello è installato: `ollama list`

### "Provider non configurato"
- Vai a ⚙️ Impostazioni
- Aggiungi la API Key o configura Ollama
- Con **Auto** il sistema prova davvero i provider in ordine: Gemini → OpenRouter → Locale → Ollama → Demo, e usa il primo che risponde (quindi una chiave esaurita o un server locale spento non bloccano la risposta)

### L'assistente risponde "Errore provider ..." o "non ha restituito testo"
- Dal menu **Provider** puoi scegliere: `Auto`, `Gemini`, `OpenRouter`, `Locale (Bionic/LM Studio)`, `Ollama`, `Demo`.
- La scelta è **vincolante**: se selezioni un provider e questo non è disponibile, il messaggio di errore indica il motivo (es. `Gemini API error: 429 ... quota`, `Server locale non raggiungibile su http://localhost:1234/v1`). Non viene usato un altro provider a tua insaputa: scegli `Auto` per avere il fallback automatico.
- Errore `429` da Gemini = quota/chiave esaurita: usa `Auto` o `OpenRouter`, oppure verifica il piano su https://ai.dev/rate-limit
- Errore "Server locale non raggiungibile" = avvia LM Studio/Bionic sulla porta configurata (default `http://localhost:1234/v1`)
- Per diagnosticare cosa restituisce davvero l'API: `node scripts/debug-sse.mjs http://localhost:3000/api auto "ciao"`

### Dice "Ho preparato la richiesta" ma non arriva il pulsante Approva
- Il pulsante esiste **solo** se il modello ha davvero chiamato il tool di modifica (`calendar_create_item`, `tasks_create`, `calendar_update_item`, `calendar_delete_item`, `tasks_complete`). Se risponde solo con testo — tipicamente ripetendo la frase "Ho preparato la richiesta..." imitando la cronologia — non viene creata nessuna PendingAction e quindi nessun pulsante.
- Il server ora rileva questa "risposta fantasma": non la mostra, riprova forzando la chiamata al tool (max 2 volte) e, se fallisce, risponde onestamente che nessuna richiesta è stata creata.
- In Telegram puoi confermare anche senza pulsante scrivendo `approva` / `rifiuta` (o `/approva`, `/rifiuta`); con `/azioni` rivedi le richieste in attesa e reinvi i bottoni.
- Diagnosi: `node scripts/debug-sse.mjs http://localhost:3000/api auto "aggiungi evento: pizza domani alle 20"` deve stampare `[tool]` e `[pending]`.

### Dati non persistono
- Verifica che `./data/` sia scrivibile
- Controlla i log del server per errori di write

## 🔐 Sicurezza

✅ **Le chiavi API non sono mai salvate nel browser**
- Tutte le richieste passano attraverso il backend
- Le chiavi sono criptate nel server (in una versione prod)
- Mai esporre credenziali nel codice client

✅ **Validazione input**
- Server-side validation su tutti gli input
- Sanitizzazione dei dati

✅ **Rate limiting**
- Protezione da abusi AI (configurable)

## 📦 Deploy

### ☁️ Vercel + Supabase (accesso da ovunque)
1. Supabase: New Project → SQL Editor → esegui `supabase/schema.sql`
   (crea 4 tabelle JSONB; idempotente). Copia `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`
   (Project Settings → API; la service role resta SOLO sul server).
2. Vercel: importa il repo (Root Directory = repo root). `vercel.json` è già pronto:
   - Build: `npm run build --workspace=@calendario/web && node scripts/build-api.mjs`
   - Output: `apps/web/dist`, `framework: null` (routing solo da vercel.json)
   - Function `api/index.js` (memory 1024, maxDuration 60) + rewrite `/api/:path*` → `/api`
     e fallback SPA `/(.*)` → `/index.html`
   - Env vars: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `GEMINI_API_KEY`,
     `OPENROUTER_API_KEY`, `ALLOWED_ORIGIN=https://<tuo>.vercel.app`
     (`VITE_API_URL` può restare vuota: il frontend usa `/api` relativo)
3. Verifica: `https://<tuo>.vercel.app/api/health` → `{"storage":"supabase"}`.
4. Limiti del serverless (progettati e gestiti):
   - niente Ollama / modelli su `localhost` (il cloud non vede il tuo PC)
   - niente sync PoliTO automatico: resta manuale (`POST /api/polito/sync`) o via Vercel Cron
   - chat SSE entro `maxDuration` (60s in `vercel.json`)
   - il filesystem è read-only → se `SUPABASE_*` manca l'API risponde con un errore esplicito
     invece di perdere dati silenziosamente
   Dettagli in `NAS-README.md` (Opzione A) e `.env.vercel.example`.

### 🏠 NAS / Docker (solo LAN + VPN, storage JSON)
```bash
cp .env.example .env   # compila GEMINI_API_KEY, ALLOWED_ORIGIN
docker compose up -d --build
# http://<ip-lan-nas>:8080/api/health → {"storage":"json"}
```
Niente `SUPABASE_*` → JSON locale automatico nel volume `calendario-data`
(scheduler PoliTO attivo, frontend servito da Express, Ollama disponibile).
Dettagli in `NAS-README.md` (Opzione B).

> 💡 Passare da NAS a Vercel (o viceversa) = aggiungere/togliere le due env var
> `SUPABASE_*`. Per portarsi i dati:
> `curl -s http://<origine>/api/data/export?download=1 -o backup.json` poi
> `curl -X POST http://<destinazione>/api/data/import -H 'Content-Type: application/json' -d @backup.json`.
> L'export NON contiene chiavi API né password PoliTO: vanno reinserite nelle Impostazioni.

## 📚 Documentazione API

### GET /api/health
Health check. Include `storage`: `"supabase"` o `"json"` (indica dove sono i dati).

### Calendar Items
- `GET /api/items` - Lista items (filtri: `category`, `type`, `startDate`, `endDate`)
- `POST /api/items` - Crea item
- `GET /api/items/:id` - Dettaglio item
- `PATCH /api/items/:id` - Aggiorna item
- `DELETE /api/items/:id` - Cancella item

### Dati (migrazione tra ambienti)
- `GET /api/data/export` - Esporta `{items, conversations, settings, exportedAt}` senza segreti
  (`?download=1` per scaricare il file `.json`)
- `POST /api/data/import` - Importa `{items?, conversations?, settings?, merge?}` (merge default `true`;
  con `merge:false` items/conversazioni vengono sostituiti)

### Settings
- `GET /api/settings` - Carica impostazioni
- `PUT /api/settings` - Salva impostazioni

### AI
- `GET /api/ai/providers` - Status provider
- `GET /api/ai/local-status` - Status Ollama
- `POST /api/ai/chat` - Invia messaggio (SSE)
- `GET /api/ai/conversations` - Lista conversazioni
- `POST /api/ai/actions/:id/confirm` - Approva azione

## 🤝 Contribuire

1. Fork il repository
2. Crea un branch: `git checkout -b feature/mia-feature`
3. Commit: `git commit -m 'Aggiungi feature'`
4. Push: `git push origin feature/mia-feature`
5. Apri una Pull Request

## 📝 License

MIT - Vedi LICENSE file

## 🙋 Support

Domande o problemi? Apri un issue su GitHub.

---

**Buona organizzazione! 🚀**
