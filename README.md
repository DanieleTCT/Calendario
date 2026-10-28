# Family — Calendario condiviso

Prima implementazione di un calendario familiare web: React + Vite, Supabase Auth/Postgres/Realtime e deploy statico su Vercel.

## Avvio locale

1. Installa Node.js 20.19+ o 22.12+.
2. Esegui `npm install`.
3. Le variabili locali sono in `.env.local` (non viene versionato); per un altro ambiente copia `.env.example` in `.env.local` e configura URL e anon key del progetto Supabase.
4. Nel pannello Supabase esegui una volta [`supabase/schema.sql`](./supabase/schema.sql) in **SQL Editor**.
5. In **Authentication → Providers → Email**, abilita email/password. Se le email di conferma sono attive, conferma l’indirizzo ricevuto prima di accedere.
6. Esegui `npm run dev`.

## Uso

- Crea un account, poi crea un calendario o unisciti inserendo il codice ricevuto.
- Copia il codice invito nella barra laterale per condividere lo stesso calendario con altre persone.
- Crea e modifica eventi, task e lezioni; le modifiche sono salvate su Supabase e sincronizzate via Realtime.
- Passa tra vista settimana e mese. Le task possono essere completate con la casella accanto al titolo.

## Pubblicazione su Vercel

Importa il progetto in Vercel e imposta `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` nelle variabili d’ambiente per Production e Preview. Il comando di build è `npm run build` e la directory di output è `dist`. Aggiungi anche il dominio Vercel a **Authentication → URL Configuration → Redirect URLs** nel progetto Supabase.

La anon key è pensata per il client web: l’accesso ai dati è vincolato a utenti autenticati e alle policy RLS. Non inserire mai una service-role key nel frontend.
