# Prompt per creare una nuova applicazione Calendario AI

Agisci come un software architect e senior full-stack engineer. Devi creare da zero una nuova applicazione web per organizzare calendario, task e attività tramite un assistente AI agentico.

Non copiare la struttura, il layout, i nomi dei componenti o il codice di applicazioni esistenti. Progetta un prodotto originale con un'interfaccia diversa: usa un workspace dashboard con agenda principale, inbox dei task, feed delle attività e assistente AI laterale o contestuale.

## Obiettivo prodotto

L'applicazione deve permettere a una persona di:

- visualizzare e gestire eventi e impegni;
- creare e completare task;
- gestire eventi ricorrenti;
- cercare rapidamente informazioni nella propria agenda;
- trovare intervalli liberi;
- chiedere all'assistente AI di leggere o modificare il calendario;
- approvare manualmente ogni modifica proposta dall'AI;
- usare un provider cloud oppure un modello locale tramite Ollama;
- esportare e importare i propri dati;
- configurare notifiche e integrazioni future senza simulare connessioni reali.

## Stack richiesto

Usa una struttura monorepo semplice e leggibile:

```text
apps/
  web/                  # interfaccia React
  api/                  # backend HTTP
packages/
  domain/               # regole di dominio e tipi
  agent/                # runtime agentico e provider AI
  storage/              # repository file/PostgreSQL
  integrations/         # adapter notifiche
```

Tecnologie consigliate:

- React + TypeScript + Vite per il frontend;
- Node.js + TypeScript per il backend;
- API HTTP JSON;
- Server-Sent Events per lo streaming dell'assistente;
- storage file JSON come default;
- PostgreSQL come adapter opzionale;
- CSS modulare o un design system leggero;
- test automatici per dominio, API e runtime agentico;
- Docker e `.env.example`.

Non aggiungere dipendenze inutili. Mantieni i moduli sostituibili.

## Interfaccia utente

Crea un'interfaccia originale, non basata su cinque tab uguali a un calendario tradizionale.

Struttura suggerita:

- sidebar con navigazione e riepilogo giornata;
- area principale con agenda giornaliera o settimanale;
- inbox task con filtri aperti, completati e in ritardo;
- pannello laterale dell'assistente AI;
- feed delle attività recenti;
- pannello impostazioni accessibile dalla sidebar;
- layout responsive per desktop e mobile.

Linee guida visuali:

- usa una gerarchia tipografica riconoscibile;
- evita il layout composto solo da card annidate;
- scegli una palette originale e accessibile;
- usa stati visivi chiari per eventi, task, errori e approvazioni;
- non nascondere le funzioni principali dietro testi descrittivi lunghi;
- mantieni dimensioni stabili per calendari, toolbar e liste;
- prevedi loading, empty state, error state e offline state.

## Modello dati

Definisci almeno queste entità:

```ts
type CalendarItem = {
  id: string;
  type: 'event' | 'task';
  title: string;
  description?: string;
  date: string;              // YYYY-MM-DD
  startTime?: string;        // HH:mm
  endTime?: string;          // HH:mm
  allDay: boolean;
  category: string;
  visibility: 'default' | 'private' | 'public' | 'confidential';
  recurrence: 'none' | 'daily' | 'weekly' | 'monthly';
  recurrenceUntil?: string;
  completed?: boolean;
  reminderMinutes: number;
  location?: string;
  createdAt: string;
  updatedAt?: string;
  source: 'local' | 'agent' | 'imported';
};
```

Aggiungi:

- `Conversation`;
- `ChatMessage`;
- `AgentStep`;
- `PendingAction`;
- impostazioni utente;
- utilizzo e quota dei provider;
- log delle notifiche;
- memoria dell'agente.

Mantieni i contratti condivisi tra frontend, backend e agent runtime in un package di dominio comune.

## Funzionalita calendario

Implementa:

- viste mese, settimana, giorno e lista;
- creazione, modifica ed eliminazione degli eventi;
- trascinamento per spostare un evento;
- modifica della durata;
- eventi a giornata intera;
- categorie e colori configurabili;
- visibilita dell'evento;
- posizione e descrizione;
- ricorrenze giornaliere, settimanali e mensili;
- data finale della ricorrenza;
- promemoria;
- ricerca testuale;
- filtri per categoria, tipo e stato;
- calcolo degli slot liberi.

Le regole di ricorrenza e gli slot liberi devono vivere nel package `domain`, non nei componenti React.

## Funzionalita task

Implementa:

- creazione task;
- completamento e riapertura;
- filtro tutti, aperti, completati e in ritardo;
- ordinamento per scadenza e priorita;
- ricerca;
- collegamento opzionale a una categoria o evento;
- conferma visiva dopo ogni modifica.

## Assistente AI agentico

Implementa un assistente con:

- conversazioni persistenti;
- storico dei messaggi;
- streaming tramite SSE;
- messaggi di stato del provider;
- visualizzazione dei passi dell'agente;
- gestione degli errori;
- interruzione per domande all'utente;
- approvazione umana delle azioni modificative;
- fallback tra provider;
- limite massimo di iterazioni;
- timeout per singolo provider e per richiesta;
- protezione da richieste duplicate o risultati di tool condivisi tra conversazioni.

### Tool read-only

Implementa almeno:

- `calendar_query_range`;
- `calendar_search`;
- `calendar_find_free_slots`;
- `tasks_list`;
- `memory_get`;
- `ask_user`.

Questi tool possono essere eseguiti direttamente, ma devono produrre un risultato strutturato e visibile nella timeline dell'agente.

### Tool modificativi

Implementa almeno:

- `calendar_create_item`;
- `calendar_update_item`;
- `calendar_delete_item`;
- `tasks_create`;
- `tasks_complete`;
- `memory_set`.

Questi tool non devono modificare immediatamente i dati. Devono:

1. creare una `PendingAction`;
2. mostrarla all'utente;
3. attendere approvazione o rifiuto;
4. eseguire l'azione solo dopo l'approvazione;
5. restituire il risultato al modello;
6. registrare esito, errore e timestamp.

L'approvazione deve essere associata alla conversazione e alla singola esecuzione dell'agente. Non usare mappe globali che possano confondere richieste concorrenti.

## Provider AI

Crea un'interfaccia comune:

```ts
interface AiProvider {
  id: string;
  label: string;
  local: boolean;
  isConfigured(): Promise<boolean>;
  resolveModel(preferred?: string): Promise<string>;
  startSession(options: ProviderSessionOptions): Promise<ProviderSession>;
}
```

Supporta questi adapter:

- provider demo deterministico per i test;
- Gemini;
- provider OpenAI-compatible, configurabile per Groq, DeepSeek e OpenRouter;
- Ollama locale.

Implementa una catena configurabile:

```text
provider principale -> fallback cloud -> Ollama locale opzionale
```

La catena deve saltare provider non configurati, provider in cooldown o provider senza quota disponibile.

Non esporre mai chiavi API nel frontend.

## Ollama e basso consumo VRAM

Progetta Ollama per una macchina con circa 5,7 GB di VRAM:

- modello configurabile con `OLLAMA_MODEL`;
- default prudente nell'ordine di 3B-4B quantizzato;
- nessun modello 8B come default;
- discovery dei modelli tramite `/api/tags`;
- stato online solo se Ollama risponde e il modello richiesto e realmente installato;
- endpoint per stato, modello, latenza e modelli disponibili;
- contesto e cronologia configurabili;
- `maxToolSteps` iniziale tra 3 e 4 in profilo locale;
- output token limitato;
- timeout separati per connessione, generazione e richiesta completa;
- fallback cloud opzionale quando il modello locale e offline o va in timeout;
- messaggi espliciti in UI in caso di modello assente o memoria insufficiente.

Non dichiarare una GPU online usando dati simulati.

## API backend

Implementa almeno:

```text
GET    /api/health
GET    /api/items
POST   /api/items
PATCH  /api/items/:id
DELETE /api/items/:id

GET    /api/settings
PUT    /api/settings

GET    /api/ai/providers
GET    /api/ai/local-status
GET    /api/ai/conversations
GET    /api/ai/conversations/:id/messages
GET    /api/ai/pending
POST   /api/ai/chat
POST   /api/ai/chat/:id/reply
POST   /api/ai/actions/:id/confirm
```

Parse il body HTTP una sola volta nel bootstrap e passalo alle route tramite il contesto della richiesta.

Valida tutti gli input lato server. Restituisci errori JSON coerenti. Non considerare riuscita una richiesta solo perché il provider ha risposto HTTP 200: verifica il contenuto e la validita del risultato.

## Persistenza

Implementa un'interfaccia repository:

```ts
interface Repository {
  listItems(): Promise<CalendarItem[]>;
  createItem(item: CalendarItem): Promise<CalendarItem>;
  updateItem(id: string, patch: Partial<CalendarItem>): Promise<CalendarItem | null>;
  deleteItem(id: string): Promise<boolean>;
}
```

Crea:

- adapter JSON su file come default;
- adapter PostgreSQL opzionale;
- scrittura atomica del file;
- versionamento dello schema;
- migrazione o rifiuto chiaro per dati incompatibili;
- export JSON;
- import JSON con validazione;
- backup prima del ripristino.

## Integrazioni

Prepara interfacce per:

- Telegram;
- WhatsApp tramite Twilio;
- email tramite SMTP.

Per ogni integrazione:

- crea un adapter reale solo se configurato;
- crea uno stato `not_configured` quando mancano le credenziali;
- non restituire successi fittizi;
- registra tentativi, errori e timestamp;
- lascia il provider mock disponibile solo nei test.

## Sicurezza e affidabilita

Implementa:

- validazione schema degli input;
- limite dimensione body;
- autenticazione configurabile;
- protezione delle route amministrative;
- nessuna chiave nel bundle frontend;
- timeout e cancellazione delle richieste;
- rate limit sulle chiamate AI;
- log senza segreti;
- approvazione obbligatoria per operazioni distruttive;
- isolamento dello stato tra richieste concorrenti;
- sanitizzazione dei dati mostrati nella UI.

## Test obbligatori

Scrivi test automatici per:

- ricorrenze;
- calcolo slot liberi;
- CRUD eventi;
- task completati e in ritardo;
- import/export;
- provider demo;
- tool read-only;
- mutazione con approvazione;
- rifiuto e scadenza di una PendingAction;
- `ask_user`;
- fallback provider;
- provider non configurato;
- modello Ollama assente;
- timeout provider;
- due richieste AI concorrenti;
- persistenza dopo riavvio.

## Ordine di implementazione

Procedi in questo ordine:

1. crea la struttura monorepo;
2. definisci i tipi e le regole del dominio;
3. implementa storage file e test CRUD;
4. implementa API calendario/task/settings;
5. crea la dashboard alternativa;
6. implementa il provider demo e il runtime agentico;
7. aggiungi SSE e approvazioni;
8. aggiungi provider cloud e Ollama;
9. aggiungi backup e integrazioni come adapter;
10. aggiungi Docker, `.env.example` e documentazione;
11. esegui build, lint e test;
12. correggi tutti gli errori prima di dichiarare il progetto completato.

## Criteri di completamento

Il lavoro e completato solo quando:

- l'app si avvia con i comandi documentati;
- calendario e task sono utilizzabili senza AI;
- il provider demo consente di testare l'intero flusso agentico;
- ogni mutazione AI richiede conferma;
- lo streaming SSE funziona;
- la conversazione viene salvata e ricaricata;
- Ollama offline produce uno stato chiaro;
- non ci sono valori simulati presentati come reali;
- i test principali passano;
- il progetto generato e indipendente dalla struttura dell'app originale.

Prima di scrivere codice, mostra una breve struttura dei file che intendi creare. Poi implementa per incrementi piccoli, eseguendo una verifica dopo ogni fase. Non fermarti a una descrizione teorica: genera il progetto funzionante.
