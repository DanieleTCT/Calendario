# Family — Spazi condivisi

Applicazione web React + Vite con calendari, file condivisi, riproduzione sincronizzata e Watch-decider. Usa Supabase Auth, Postgres, Storage e Realtime; il frontend è distribuibile su Vercel.

## Avvio locale

1. Installa Node.js 20.19+ o 22.12+.
2. Esegui `npm install`.
3. Le variabili locali sono in `.env.local` (non viene versionato); per un altro ambiente copia `.env.example` in `.env.local` e configura URL e anon key del progetto Supabase. Per cercare film e serie, aggiungi anche `TMDB_READ_ACCESS_TOKEN` con il token di lettura API di TMDb. Il token è usato esclusivamente dal server: non usare il prefisso `VITE_`.
4. Nel pannello Supabase esegui [`supabase/schema.sql`](./supabase/schema.sql) in **SQL Editor**. Ripeti l'operazione quando aggiorni a questa versione, prima di distribuire il frontend aggiornato; lo schema è applicato in una transazione. Fai prima un backup del database.
5. In **Authentication → Providers → Email**, abilita email/password. Se le email di conferma sono attive, conferma l’indirizzo ricevuto prima di accedere.
6. Esegui `npm run dev`.
7. Esegui `npm test` per i test locali dello schema e `npm run build` per verificare la compilazione.

## Uso

- Crea un account, poi crea un calendario o unisciti inserendo il codice ricevuto.
- Nella barra laterale puoi passare tra i tuoi calendari oppure crearne o aggiungerne altri.
- Nella voce **Profilo** imposti nome e colore per il calendario selezionato, una breve descrizione e il tuo Mii: un volto personalizzabile con forma, pelle, capelli, occhi, sopracciglia, naso, bocca, barba, occhiali, guance, maglia e sfondo. Il Mii sostituisce le iniziali nella barra superiore, nella barra laterale e nell'elenco delle persone. La stessa sezione mostra tutte le persone presenti nei tuoi calendari, con i calendari in cui partecipano e il loro ruolo.
- L'amministratore del calendario può condividere un codice per la sola lettura oppure uno per la modifica. Può cambiare i permessi di un membro, rimuoverlo o revocare entrambi i codici senza rimuovere i membri esistenti. Rimuovere un membro rigenera entrambi i codici.
- Per ogni elemento scegli se renderlo visibile a tutti i membri o solo a persone specifiche. Il creatore lo vede sempre.
- Crea e modifica eventi, task e lezioni; le modifiche sono salvate su Supabase e sincronizzate via Realtime.
- Passa tra vista settimana e mese. Le task possono essere completate con la casella accanto al titolo.
- La griglia settimanale copre tutta la giornata, da `00:00` a `24:00`. Fai doppio clic su uno spazio vuoto per creare una bozza da un'ora: trascinala per spostarla, trascina i bordi per regolare in intervalli di 15 minuti oppure fai clic sui bordi per estendere l'inizio o la fine. Seleziona la bozza per inserire titolo e descrizione e salvarla.
- In **File e riproduzione**, gli editor possono caricare ed eliminare file fino a 50 MB ciascuno, selezionare un file audio o video, riprodurlo, metterlo in pausa e spostare la posizione per tutti. Ogni partecipante deve aprire la sezione e attivare la riproduzione sul proprio dispositivo.
- In **Watch-decider**, un editor crea una sessione e trova subito raccolte scorrevoli di titoli in tendenza, novità/prossime uscite e catalogo da esplorare. **Carica altri** apre ulteriori pagine del catalogo. Categoria, anno e genere restringono le raccolte; un filtro testuale Tag o genere cerca tra i titoli già caricati. Per i titoli che conosci già, la ricerca per nome è in un pannello separato e comprimibile. Risultati e raccolte mostrano copertina, anno e generi. È possibile aggiungere manualmente film, serie, giochi e altri titoli con tag.
- Almeno due membri partecipano prima che un editor avvii la partita. I partecipanti votano gli stessi titoli in ordine casuale e al proprio ritmo: swipe a sinistra per passare, swipe a destra per 4 stelle, oppure un voto da 1 a 5. La lista e i partecipanti sono bloccati dopo l'avvio.
- Quando tutti hanno votato tutti i titoli, appare un report con i voti individuali e una classifica; per la media, un “passo” vale zero. Per iniziare una nuova scelta crea una nuova sessione.

Le sessioni precedenti con voti vengono conservate e considerate già in corso; quelle senza voti restano in preparazione. Se una vecchia sessione in corso non ha almeno due partecipanti, crea una nuova sessione per usare il nuovo flusso.

Gli utenti già presenti mantengono i permessi di modifica durante l'aggiornamento. I codici sono visibili solo al proprietario, ma chi possiede un codice valido può condividerlo a sua volta: trattali come credenziali e revocali se necessario. Il codice di modifica concede il permesso ai nuovi membri; per cambiare il permesso di una persona già iscritta interviene l'amministratore.

File, sessioni e titoli sono visibili a tutti i membri dello spazio, anche se non partecipano alla sessione Watch-decider. Durante la partita ogni utente vede solo i propri voti; il report conclusivo è visibile a tutti i membri dello spazio. Gli editor possono gestire i file e i titoli; tutti i membri possono partecipare e votare. Gli URL firmati per la riproduzione restano validi fino a un'ora: revocare l'accesso a un membro non annulla immediatamente gli URL già emessi.

La scoperta carica tendenze settimanali, novità in una finestra di uscita recente/prossima e pagine ordinate per popolarità. La ricerca per nome interroga TMDb solo quando viene inviata esplicitamente; anno e genere possono anche esplorare il catalogo senza un titolo. Il filtro “Tag o genere” restringe i risultati già caricati usando titolo, categoria e generi TMDb. Il token si ottiene dalle impostazioni API di un account TMDb; l'uso gratuito è soggetto alle loro condizioni per progetti non commerciali e all'attribuzione mostrata nell'app. I progetti commerciali devono verificare la licenza con TMDb.

La riproduzione sincronizza la posizione di file presenti nello storage: non trasmette in diretta lo schermo o l'audio di un dispositivo, non aggira DRM e non garantisce sincronizzazione al campione. Formati, avvio automatico e ricerca dipendono dal browser; ogni dispositivo potrebbe dover premere **Attiva riproduzione**. Carica solo contenuti che sei autorizzato a condividere. Lo storage e il traffico consumano la quota del progetto Supabase.

**Stato della migrazione:** i test locali verificano policy e vincoli con PostgreSQL incorporato e servizi Auth/Storage simulati, non il servizio Supabase effettivo. Prima dell'uso in produzione, verifica lo schema e i flussi con più account in un progetto separato, inclusi Storage e Realtime, e disponi di un backup. Il frontend aggiornato richiede lo schema aggiornato.

## Pubblicazione su Vercel

Importa il progetto in Vercel e imposta `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` e `TMDB_READ_ACCESS_TOKEN` nelle variabili d’ambiente per Production e Preview. Il comando di build è `npm run build` e la directory di output è `dist`. Vercel distribuisce anche la funzione server `api/catalog.js`, necessaria per la ricerca: un hosting esclusivamente statico deve prevedere un endpoint equivalente. Aggiungi anche il dominio Vercel a **Authentication → URL Configuration → Redirect URLs** nel progetto Supabase.

La anon key è pensata per il client web: l’accesso ai dati è vincolato a utenti autenticati e alle policy RLS. Non inserire mai una service-role key nel frontend.
