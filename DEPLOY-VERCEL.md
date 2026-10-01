# 🚀 Deploy su Vercel + Supabase

Guida passo-passo. Il repo contiene già `vercel.json` con build, function e rewrites:
**non devi scrivere codice, solo impostazioni**.

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
> Vercel trova **due app**: `apps/web` (Vite) e `apps/api` (Express), e ti propone di
> importarle separatamente o di raggrupparle in Services.
>
> **Non fare nessuna delle due.** Importa **il root del repo come UN SOLO PROJECT**:
>
> - non attivare **Services**
> - non selezionare `apps/api` né `apps/web` come root directory
>
> Motivo: `api/index.js` (root) è già la function pronta e testata che serve su `/api`;
> se lasci che Vercel buildda `apps/api` come app Express ottieni un percorso diverso da
> quello verificato e un conflitto sul path `/api`.

## Passo 2 — Impostazioni (Settings → Build & Development)

| Campo | Valore |
|---|---|
| Root Directory | `.` (lascia vuoto) |
| Framework Preset | **Other** (⚠️ NON Vite, NON Express) |
| Install Command | `npm install` |
| Build Command | `npm run build --workspace=@calendario/web && node scripts/build-api.mjs` |
| Output Directory | `apps/web/dist` |
| Node.js Version | 20.x o 22.x |

Questi valori sono **già nel `vercel.json`** (di solito Vercel li mostra come
"configurato in vercel.json"). Se la dashboard mostra altro, sovrascrivi con la tabella.

## Passo 3 — Environment Variables (Project Settings → Environment Variables)

| Nome | Esempio / note |
|---|---|
| `SUPABASE_URL` | `https://<ref>.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | chiave `service_role` |
| `GEMINI_API_KEY` | opzionale |
| `OPENROUTER_API_KEY` | opzionale |
| `ALLOWED_ORIGIN` | `https://<tuo-progetto>.vercel.app` |

`VITE_API_URL` **non serve**: il frontend chiama `/api` relativo (stesso progetto).
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
| `{"error":"Not found"}` su `/api/health` | ❌ Framework Preset non è "Other" → correggi e **Redeploy** |
| `/` non carica l'app o è una pagina vuota | ❌ Output Directory errata → imposta `apps/web/dist` e Redeploy |

Se hai creato il progetto con le impostazioni sbagliate: **non serve ricrearlo** —
Settings → Build & Development → correggi → Deployments → ⋯ → *Redeploy*.

## ⚠️ Limiti del serverless (attesi e gestiti nel codice)

- **Niente Ollama / modelli su `localhost`**: il cloud non raggiunge il tuo PC. Usa
  Gemini, OpenRouter o il provider *Demo*. (Su NAS/Ollama funziona normalmente.)
- **Sync PoliTO automatico disattivato** (niente timer sul serverless): sync manuale
  con `POST /api/polito/sync` oppure con un [Vercel Cron](https://vercel.com/docs/cron-jobs).
- **Chat SSE entro 60s** (`maxDuration` in `vercel.json`).
- **Filesystem read-only**: per questo, senza `SUPABASE_*`, l'API rifiuta con un errore
  esplicito invece di perdere i dati in silenzio.

## 🛠️ Comandi utili (in locale)

```bash
npm run build               # build frontend + bundle API
npm run test:serverless     # simula la function Vercel e verifica le rotte (8 check)
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