-- Sito-calendario — schema Supabase/Postgres (single-user, JSONB documents).
-- Esegui questo file nel SQL Editor di Supabase (o `psql`).
-- Idempotente: puoi rieseguirlo senza perdere dati.

create table if not exists calendar_items (
  id text primary key,
  data jsonb not null,
  created_at timestamptz default now()
);
create table if not exists conversations (
  id text primary key,
  data jsonb not null,
  created_at timestamptz default now()
);
create table if not exists pending_actions (
  id text primary key,
  data jsonb not null,
  created_at timestamptz default now()
);
-- Settings single-user: una sola riga id='global'.
create table if not exists app_settings (
  id text primary key check (id = 'global'),
  data jsonb not null,
  updated_at timestamptz default now()
);

-- Indici utili (query per data/tipo dentro il JSON).
create index if not exists idx_items_data_date on calendar_items ((data->>'date'));
create index if not exists idx_items_data_type on calendar_items ((data->>'type'));

-- RLS: il backend usa la SERVICE_ROLE key (bypassa RLS).
-- Il frontend NON parla mai con Supabase direttamente, quindi nessuna policy pubblica.
-- Abilitiamo RLS senza policy = solo service_role puo' leggere/scrivere.
alter table calendar_items enable row level security;
alter table conversations enable row level security;
alter table pending_actions enable row level security;
alter table app_settings enable row level security;
