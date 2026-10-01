# 🚀 Deploy su Vercel + Supabase

Guida passo-passo. Il repo contiene già `vercel.json` in modalità **Services** (2 servizi,
build, rewrites e function): **non devi scrivere codice, solo impostazioni**.

## Architettura Services (come è configurato il deploy)

| Servizio | `root` | Framework | Ruolo | Percorso pubblico |
|---|---|---|---|---|
| `web` | `apps/web` | Vite | Frontend statico (SPA) | **`/`** (catch-all) |
| `api` | `.` (root del repo) | Express | Backend (`api/index.js`) | **`/api`** |

```json
"rewrites": [
  { "source": "/api",        "destination": { "service": "api" } },
  { "source": "/api/(.*)",   "destination": { "service": "api" } },
  { "source": "/(.*)",       "destination": { "service": "web" } }
]
```

Punti importanti:

- **Nessun service resta interno**: entrambi sono esposti (il frontend deve chiamare `/api`,
  quindi l'API *deve* essere pubblica sotto `/api`).
- **Nessuna binding aggiunta**: le binding servono solo per chiamate server→server tra
  servizi. Qui l'unico "collegamento" è il browser che chiama `/api` sullo stesso dominio
  (stesso host, quindi anche senza CORS), già gestito dalla rewrite pubblica.
- **Path invariato**: Vercel passa al servizio il path originale (`/api/items` arriva
  all'Express come `/api/items`), per cui le rotte `app.use('/api/items', …)` e il
  `baseURL: '/api'` del frontend già coincidono — nessuna modifica al codice.
- **`root: "."` per l'API** (non `apps/api`): così `npm install` parte dalla root e risolve i
  pacchetti workspace `@calendario/*` (che non esistono su npm), e il `buildCommand`
  rigenera `api/index.js` con esbuild.
- `installCommand` **non** è specificato: lascia a Vercel l'install default (rileva i
  workspace npm e installa dalla root del monorepo).

## Prerequisiti

1. **Supabase**: https://supabase.com → *New Project* → *SQL Editor* → incolla ed esegui
   [`supabase/schema.sql`](supabase/schema.sql) (crea 4 tabelle JSONB, è idempotente).
   Poi *Project Settings → API* → copia:
   - `Project URL` → sarà `SUPABASE_URL`
   - `service_role` key → sarà `SUPABASE_SERVICE_ROLE_KEY` (**solo il server**, mai nel browser)
2. **Chiavi AI**: Gemini (<https://ai.google.dev>) e/o OpenRouter (<https://openrouter.ai>).

## Passo 1 — Import del progetto

Vercel → *Add New… → Project* → seleziona `DanieleTCT/Calendario`.

> ### ⚠️ "Multiple applications detected in this directory"
> Vercel trova **due app**: `apps/web` (Vite) e `apps/api` (Express).
>
> **Accetta il raggruppamento in Services** (un solo progetto): è esattamente ciò che
> descrive il `vercel.json` già committato. Se la UI propone di *generare* una configurazione
> Services, tieni **quella del repo** (sono già definiti `services` + `rewrites` + build
> per ciascun servizio).
>
> Non creare progetti separati e non impostare `apps/web` o `apps/api` come Root Directory:
> il build dell'API va fatto dalla **root** (`root: "."`) perché `@calendario/*` sono
> workspace npm locali.

## Passo 2 — Impostazioni (Settings → Build & Development)

In modalità Services le build settings stanno **dentro ogni servizio** (in `vercel.json`),
non a livello di progetto. In dashboard deve restare solo:

| Campo | Valore |
|---|---|
| Root Directory | `.` (lascia vuoto) |
| Install Command | *(vuoto → default Vercel, rileva i workspace npm)* |
| Node.js Version | 20.x o 22.x |

Build Command / Output Directory / Framework **non devi compilarli**: vivono in
`services.web.*` e `services.api.*` del `vercel.json`. Se la dashboard mostra dei campi
editabili per il progetto intero, ignorali: fa fede `vercel.json`.

## Passo 3 — Environment Variables (Project Settings → Environment Variables)

| Nome | Esempio / note |
|---|---|
| `SUPABASE_URL` | `https://<ref>.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | chiave `service_role` |
| `GEMINI_API_KEY` | opzionale |
| `OPENROUTER_API_KEY` | opzionale |
| `ALLOWED_ORIGIN` | `https://<tuo-progetto>.vercel.app` |

`VITE_API_URL` **non serve e non va impostato**: il frontend chiama `/api` relativo,
quindi stesso dominio e stessa origine (nessun CORS da configurare). Se lo imposti con un
URL assoluto aggiri la rewrite e salta il servizio `api`.
Imposta le variabili su **Production e Preview**. Poi *Deploy*.

## Passo 4 — Verifica

```
https://<tuo-progetto>.vercel.app/api/health
```

| Risposta | Significato |
|---|---|
| `{"status":"ok","storage":"supabase"}` | ✅ Tutto ok |
| `{"error":"Su Vercel serve Supabase: imposta SUPABASE_URL e ..."}` | ❌ Mancano le due env `SUPABASE_*` |
| `{"error":"Supabase: schema mancante o non raggiungibile ... Esegui supabase/schema.sql"}` | ❌ Schema non eseguito o URL/key sbagliati |
| `{"error":"Not found"}` su `/api/health` | ❌ La rewrite `/api/*` → servizio `api` non è attiva → controlla `vercel.json` e **Redeploy** |
| `/` non carica l'app o è una pagina vuota | ❌ Servizio `web` assente o `outputDirectory` errata (deve essere `dist` in `services.web`) |

Se hai creato il progetto con le impostazioni sbagliate: **non serve ricrearlo** —
Settings → Build & Development → correggi → Deployments → ⋯ → *Redeploy*.

## ⚠️ Limiti del serverless (attesi e gestiti nel codice)

- **Niente Ollama / modelli su `localhost`**: il cloud non raggiunge il tuo PC. Usa
  Gemini, OpenRouter o il provider *Demo*. (Su NAS/Ollama funziona normalmente.)
- **Sync PoliTO automatico disattivato** (niente timer sul serverless): sync manuale
  con `POST /api/polito/sync` oppure con un [Vercel Cron](https://vercel.com/docs/cron-jobs).
- **Chat SSE entro 60s** (`maxDuration` in `services.api.functions` del `vercel.json`).
- **Filesystem read-only**: per questo, senza `SUPABASE_*`, l'API rifiuta con un errore
  esplicito invece di perdere i dati in silenzio.

## 🛠️ Comandi utili (in locale)

```bash
npm run build               # build frontend + bundle API
npm run test:serverless     # simula la function Vercel e verifica le rotte (8 check)
npx vercel dev              # Services in locale: avvia web + api insieme (binding iniettate)
npm run test:supabase-mock  # logica CRUD Supabase offline (27 check)
npm run test:supabase       # CRUD reale sul TUO Supabase (serve .env con SUPABASE_*)
```

## 🔁 Tornare al NAS / Docker

Togli `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` (oppure non compilarle su NAS):
l'app usa automaticamente il file JSON nel volume `calendario-data`. Per spostare i dati:

```bash
curl -s https://<ambiente-origine>/api/data/export?download=1 -o backup.json
curl -X POST https://<ambiente-destinazione>/api/data/import \
  -H 'Content-Type: application/json' -d @backup.json
```

L'export **non** contiene chiavi API né password PoliTO (vanno reinserite nelle Impostazioni).