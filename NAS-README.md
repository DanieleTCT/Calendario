# ============================================================
#  Sito-calendario — deploy doppio: Vercel+Supabase (cloud) OPPURE NAS (locale)
# ============================================================
#
# --- OPZIONE A: Vercel + Supabase (consigliata per accesso da ovunque) ---
# 1) Supabase (https://supabase.com): New Project > SQL Editor >
#    incolla ed esegui `supabase/schema.sql` (crea 4 tabelle JSONB).
#    Project Settings > API: copia URL + SERVICE_ROLE key (solo server!).
# 2) Vercel: importa questo repo (Root Directory = repo root).
#    Build Command:  npm run build --workspace=@calendario/web && node scripts/build-api.mjs
#    Output Directory: apps/web/dist
#    Env vars (Project Settings > Environment Variables):
#      SUPABASE_URL=https://<ref>.supabase.co
#      SUPABASE_SERVICE_ROLE_KEY=<service-role>   (MAI nel frontend!)
#      GEMINI_API_KEY=<...>  OPENROUTER_API_KEY=<...>  (opzionali)
#      ALLOWED_ORIGIN=https://<tuo-frontend>.vercel.app
#      VITE_API_URL=/api   (stesso progetto) oppure URL API se progetti separati
#    Deploy > verifica https://<xxx>.vercel.app/api/health => {"status":"ok","storage":"supabase"}
#    NOTA: su Vercel niente Ollama/localhost (il cloud non vede il tuo PC),
#    niente sync PoliTO automatico (solo manuale via POST /api/polito/sync),
#    SSE/chat < 60s (maxDuration). Cron PoliTO: Vercel Cron -> POST /api/polito/sync.
#
# --- OPZIONE B: NAS (Synology/QNAP/qualsiasi Docker, SOLO LAN+VPN) ---
# 1) Sul NAS: installa Tailscale e accendilo (stesso account su PC/telefono).
# 2) Copia questa cartella sul NAS, crea .env da .env.example
#    (GEMINI_API_KEY, ALLOWED_ORIGIN con IP LAN + Tailnet).
#    Niente SUPABASE_* => storage JSON locale automatico nel volume.
# 3) docker compose up -d --build
#    Test LAN:  http://<ip-lan-nas>:8080/api/health   => {"storage":"json"}
#    Test VPN:  http://<ip-tailscale-nas>:8080/api/health
# 4) Aggiornamento: docker compose up -d --build
# 5) Backup: volume 'calendario-data' (data.json + backup automatici).
# ------------------------------------------------------------
# Ollama opzionale (solo NAS/PC, MAI su Vercel):
#   LAN: OLLAMA_BASE_URL=http://host.docker.internal:11434
#   VPN: OLLAMA_HOST=0.0.0.0:11434 sul PC, poi http://<ip-tailscale-PC>:11434
#   Modelli con tool nativi: ollama pull qwen2.5:3b-instruct
# ============================================================
