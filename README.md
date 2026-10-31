# Family — Spazi condivisi

Applicazione web React + Vite con calendari, file condivisi, riproduzione sincronizzata e Watch-decider. Usa Supabase Auth, Postgres, Storage e Realtime; il frontend è distribuibile su Vercel.

## Avvio locale

1. Installa Node.js 20.19+ o 22.12+.
2. Esegui `npm install`.
3. Le variabili locali sono in `.env.local` (non viene versionato); per un altro ambiente copia `.env.example` in `.env.local` e configura URL e anon key del progetto Supabase.
4. Nel pannello Supabase esegui [`supabase/schema.sql`](./supabase/schema.sql) in **SQL Editor**. Ripeti l'operazione quando aggiorni a questa versione, prima di distribuire il frontend aggiornato; lo schema è applicato in una transazione. Fai prima un backup del database.
5. In **Authentication → Providers → Email**, abilita email/password. Se le email di conferma sono attive, conferma l’indirizzo ricevuto prima di accedere.
6. Esegui `npm run dev`.
7. Esegui `npm test` per i test locali dello schema e `npm run build` per verificare la compilazione.

## Uso

- Crea un account, poi crea un calendario o unisciti inserendo il codice ricevuto.
- Nella barra laterale puoi passare tra i tuoi calendari oppure crearne o aggiungerne altri.
- Copia il codice invito nella barra laterale per condividere lo stesso calendario con altre persone.
- I nuovi invitati hanno accesso in sola lettura. Il proprietario può abilitarli alla modifica o rimuoverli; la rimozione rigenera il codice invito.
- Per ogni elemento scegli se renderlo visibile a tutti i membri o solo a persone specifiche. Il creatore lo vede sempre.
- Crea e modifica eventi, task e lezioni; le modifiche sono salvate su Supabase e sincronizzate via Realtime.
- Passa tra vista settimana e mese. Le task possono essere completate con la casella accanto al titolo.
- In **File e riproduzione**, gli editor possono caricare ed eliminare file fino a 50 MB ciascuno, selezionare un file audio o video, riprodurlo, metterlo in pausa e spostare la posizione per tutti. Ogni partecipante deve aprire la sezione e attivare la riproduzione sul proprio dispositivo.
- In **Watch-decider**, un editor crea una sessione e aggiunge titoli, tipo e tag. I membri si uniscono e votano con swipe o pulsanti; per i sì possono scegliere un voto da 1 a 5. Le scelte approvate da tutti i partecipanti compaiono tra quelle in comune quando partecipano almeno due persone. Si possono filtrare e rivedere i voti; uscendo si cancellano i propri voti.

Gli utenti già presenti mantengono i permessi di modifica durante l'aggiornamento; quelli invitati dopo l'aggiornamento entrano in sola lettura. Il codice invito è visibile al proprietario: chi lo possiede può entrare nel calendario, quindi va condiviso con attenzione.

File, sessioni e voti sono visibili a tutti i membri dello spazio, anche se non partecipano alla sessione Watch-decider. Gli editor possono gestire i file e i titoli; tutti i membri possono partecipare e votare. Gli URL firmati per la riproduzione restano validi fino a un'ora: revocare l'accesso a un membro non annulla immediatamente gli URL già emessi.

La riproduzione sincronizza la posizione di file presenti nello storage: non trasmette in diretta lo schermo o l'audio di un dispositivo, non aggira DRM e non garantisce sincronizzazione al campione. Formati, avvio automatico e ricerca dipendono dal browser; ogni dispositivo potrebbe dover premere **Attiva riproduzione**. Carica solo contenuti che sei autorizzato a condividere. Lo storage e il traffico consumano la quota del progetto Supabase.

**Stato della migrazione:** i test locali verificano policy e vincoli con PostgreSQL incorporato e servizi Auth/Storage simulati, non il servizio Supabase effettivo. Prima dell'uso in produzione, verifica lo schema e i flussi con più account in un progetto separato, inclusi Storage e Realtime, e disponi di un backup. Il frontend aggiornato richiede lo schema aggiornato.

## Pubblicazione su Vercel

Importa il progetto in Vercel e imposta `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` nelle variabili d’ambiente per Production e Preview. Il comando di build è `npm run build` e la directory di output è `dist`. Aggiungi anche il dominio Vercel a **Authentication → URL Configuration → Redirect URLs** nel progetto Supabase.

La anon key è pensata per il client web: l’accesso ai dati è vincolato a utenti autenticati e alle policy RLS. Non inserire mai una service-role key nel frontend.
