import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import { PGlite } from '@electric-sql/pglite'
import schemaSql from '../../supabase/schema.sql?raw'

type LocalUser = { id: string; email?: string | null }
type LocalDb = InstanceType<typeof PGlite>
type Row = Record<string, unknown>
type OutboxRow = {
  table_name: string
  row_key: string
  operation: string
  payload: Row
  changed_at: string | Date
}
type SyncProgress = (message: string) => void
type SyncResult = { discardedLockedChanges: number }

const sharedStorageBucket = 'family-shared'

const syncTables = [
  'calendars',
  'calendar_members',
  'calendar_items',
  'calendar_view_preferences',
  'shared_audio_playlists',
  'shared_audio_playlist_items',
  'shared_audio_favorites',
  'shared_audio_player_settings',
  'watch_sessions',
  'watch_participants',
  'watch_items',
  'watch_votes',
  'user_profiles',
] as const

type SyncTable = typeof syncTables[number]

const primaryKeys: Record<SyncTable, string[]> = {
  calendars: ['id'],
  calendar_members: ['calendar_id', 'user_id'],
  calendar_items: ['id'],
  calendar_view_preferences: ['calendar_id', 'user_id'],
  shared_audio_playlists: ['id'],
  shared_audio_playlist_items: ['playlist_id', 'object_path'],
  shared_audio_favorites: ['calendar_id', 'user_id', 'object_path'],
  shared_audio_player_settings: ['calendar_id'],
  watch_sessions: ['id'],
  watch_participants: ['session_id', 'user_id'],
  watch_items: ['id'],
  watch_votes: ['session_id', 'item_id', 'user_id'],
  user_profiles: ['user_id'],
}

const selectableColumns: Record<SyncTable, string[]> = {
  calendars: ['id', 'name', 'created_by', 'created_at', 'sync_updated_at'],
  calendar_members: ['calendar_id', 'user_id', 'role', 'display_name', 'color', 'created_at', 'can_edit', 'style_border', 'allow_style_editors', 'sync_updated_at'],
  calendar_items: ['id', 'calendar_id', 'title', 'description', 'item_type', 'starts_at', 'ends_at', 'all_day', 'completed', 'assignee_id', 'created_by', 'created_at', 'updated_at', 'visibility', 'visible_to', 'editable_by', 'tags', 'sync_updated_at'],
  calendar_view_preferences: ['calendar_id', 'user_id', 'hidden_item_ids', 'hidden_member_ids', 'category_styles', 'updated_at', 'sync_updated_at'],
  shared_audio_playlists: ['id', 'calendar_id', 'name', 'is_queue', 'created_by', 'created_at', 'updated_at', 'sync_updated_at'],
  shared_audio_playlist_items: ['playlist_id', 'calendar_id', 'object_path', 'position', 'added_by', 'added_at', 'sync_updated_at'],
  shared_audio_favorites: ['calendar_id', 'user_id', 'object_path', 'created_at', 'sync_updated_at'],
  shared_audio_player_settings: ['calendar_id', 'active_playlist_id', 'shuffle', 'repeat_mode', 'updated_at', 'sync_updated_at'],
  watch_sessions: ['id', 'calendar_id', 'name', 'created_by', 'created_at', 'status', 'sync_updated_at'],
  watch_participants: ['session_id', 'calendar_id', 'user_id', 'joined_at', 'sync_updated_at'],
  watch_items: ['id', 'session_id', 'calendar_id', 'title', 'category', 'tags', 'created_by', 'created_at', 'tmdb_id', 'poster_path', 'release_date', 'sync_updated_at'],
  watch_votes: ['session_id', 'item_id', 'user_id', 'liked', 'rating', 'sync_updated_at'],
  user_profiles: ['user_id', 'bio', 'avatar', 'updated_at', 'sync_updated_at'],
}

const insertColumns: Record<SyncTable, string[]> = {
  calendars: ['id', 'name', 'created_by'],
  calendar_members: [],
  calendar_items: ['id', 'calendar_id', 'title', 'description', 'item_type', 'starts_at', 'ends_at', 'all_day', 'completed', 'assignee_id', 'created_by', 'visibility', 'visible_to', 'editable_by', 'tags'],
  calendar_view_preferences: ['calendar_id', 'user_id', 'hidden_item_ids', 'hidden_member_ids', 'category_styles'],
  shared_audio_playlists: ['calendar_id', 'name', 'is_queue', 'created_by'],
  shared_audio_playlist_items: ['playlist_id', 'calendar_id', 'object_path', 'position', 'added_by'],
  shared_audio_favorites: ['calendar_id', 'user_id', 'object_path'],
  shared_audio_player_settings: ['calendar_id', 'active_playlist_id', 'shuffle', 'repeat_mode'],
  watch_sessions: ['id', 'calendar_id', 'name', 'created_by'],
  watch_participants: ['session_id', 'calendar_id', 'user_id'],
  watch_items: ['id', 'session_id', 'calendar_id', 'title', 'category', 'tags', 'created_by', 'tmdb_id', 'poster_path', 'release_date'],
  watch_votes: ['session_id', 'item_id', 'user_id', 'liked', 'rating'],
  user_profiles: ['user_id', 'bio', 'avatar'],
}

const updateColumns: Record<SyncTable, string[]> = {
  calendars: ['name'],
  calendar_members: ['display_name', 'color', 'style_border', 'allow_style_editors'],
  calendar_items: ['title', 'description', 'item_type', 'starts_at', 'ends_at', 'all_day', 'completed', 'assignee_id', 'visibility', 'visible_to', 'editable_by', 'tags'],
  calendar_view_preferences: ['hidden_item_ids', 'hidden_member_ids', 'category_styles'],
  shared_audio_playlists: ['name'],
  shared_audio_playlist_items: ['position'],
  shared_audio_favorites: [],
  shared_audio_player_settings: ['active_playlist_id', 'shuffle', 'repeat_mode'],
  watch_sessions: [],
  watch_participants: [],
  watch_items: ['title', 'category', 'tags', 'tmdb_id', 'poster_path', 'release_date'],
  watch_votes: ['liked', 'rating'],
  user_profiles: ['bio', 'avatar'],
}

const rpcSql: Record<string, { params: string[]; sql: string; result: 'rows' | 'scalar' | 'void' }> = {
  get_calendar_invite_code: { params: ['p_calendar_id'], sql: 'select public.get_calendar_invite_code($1) as value', result: 'scalar' },
  get_calendar_edit_invite_code: { params: ['p_calendar_id'], sql: 'select public.get_calendar_edit_invite_code($1) as value', result: 'scalar' },
  join_calendar_with_code: { params: ['p_invite_code'], sql: 'select public.join_calendar_with_code($1) as value', result: 'scalar' },
  manage_calendar_member: { params: ['p_calendar_id', 'p_user_id', 'p_can_edit', 'p_remove'], sql: 'select public.manage_calendar_member($1, $2, $3, $4)', result: 'void' },
  rotate_calendar_invites: { params: ['p_calendar_id'], sql: 'select public.rotate_calendar_invites($1)', result: 'void' },
  get_shared_playback: { params: ['p_calendar_id'], sql: 'select * from public.get_shared_playback($1)', result: 'rows' },
  set_shared_playback: { params: ['p_calendar_id', 'p_object_path', 'p_position', 'p_playing'], sql: 'select public.set_shared_playback($1, $2, $3, $4)', result: 'void' },
  clear_shared_playback: { params: ['p_calendar_id', 'p_object_path'], sql: 'select public.clear_shared_playback($1, $2)', result: 'void' },
  start_watch_round: { params: ['p_session_id'], sql: 'select public.start_watch_round($1)', result: 'void' },
  finish_watch_round_if_complete: { params: ['p_session_id'], sql: 'select public.finish_watch_round_if_complete($1) as value', result: 'scalar' },
  add_shared_audio_playlist_item: { params: ['p_calendar_id', 'p_playlist_id', 'p_object_path'], sql: 'select public.add_shared_audio_playlist_item($1, $2, $3)', result: 'void' },
  move_shared_audio_playlist_item: { params: ['p_calendar_id', 'p_playlist_id', 'p_object_path', 'p_new_position'], sql: 'select public.move_shared_audio_playlist_item($1, $2, $3, $4)', result: 'void' },
  remove_shared_audio_playlist_item: { params: ['p_calendar_id', 'p_playlist_id', 'p_object_path'], sql: 'select public.remove_shared_audio_playlist_item($1, $2, $3)', result: 'void' },
  remove_shared_audio_path: { params: ['p_calendar_id', 'p_object_path'], sql: 'select public.remove_shared_audio_path($1, $2)', result: 'void' },
  advance_shared_playback: { params: ['p_calendar_id', 'p_current_path', 'p_direction'], sql: 'select public.advance_shared_playback($1, $2, $3)', result: 'void' },
}

let databasePromise: Promise<LocalDb> | null = null
let databaseQueue: Promise<void> = Promise.resolve()
const columnCache = new Map<string, Set<string>>()

function serializeDatabaseTask<T>(task: () => Promise<T>) {
  const previous = databaseQueue
  let release!: () => void
  databaseQueue = new Promise<void>((resolve) => { release = resolve })
  return previous.then(task).finally(release)
}

function stableKey(value: Row) {
  return JSON.stringify(Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right))))
}

function rowKey(table: SyncTable, row: Row) {
  return Object.fromEntries(primaryKeys[table].map((column) => [column, row[column]]))
}

function makeResponse(status: number, body: unknown, headers: HeadersInit = {}) {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...Object.fromEntries(new Headers(headers).entries()) },
  })
}

function errorResponse(error: unknown, status = 400) {
  const message = error instanceof Error ? error.message : 'Errore nel database locale.'
  return makeResponse(status, { code: 'LOCAL_DATABASE_ERROR', details: message, hint: null, message })
}

async function openDatabase(): Promise<LocalDb> {
  if (!databasePromise) {
    let openingDatabase: LocalDb | null = null
    const opening = (async () => {
      if (!import.meta.env.DEV) throw new Error('Il database locale è disponibile solo durante npm run dev.')
      if (typeof indexedDB === 'undefined') throw new Error('IndexedDB non è disponibile: il database locale non può essere persistito in questo browser.')

      const database = openingDatabase = new PGlite('idb://family-calendar', { extensions: { pgcrypto } })
      await database.waitReady
      await database.exec('rollback')
      await database.exec(`
        do $$ begin create role anon; exception when duplicate_object then null; end $$;
        do $$ begin create role authenticated; exception when duplicate_object then null; end $$;
        create schema if not exists auth;
        create table if not exists auth.users (id uuid primary key, email text);
        create or replace function auth.uid() returns uuid language sql stable as $$
          select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
        $$;
        grant usage on schema auth to authenticated;
        grant execute on function auth.uid() to authenticated;
        create schema if not exists storage;
        create table if not exists storage.buckets (
          id text primary key, name text, public boolean, file_size_limit bigint
        );
        create table if not exists storage.objects (
          id uuid default gen_random_uuid(), bucket_id text, name text, metadata jsonb
        );
        alter table storage.objects add column if not exists metadata jsonb;
        alter table storage.objects enable row level security;
        grant usage on schema storage to authenticated;
        grant select, insert, delete on storage.objects to authenticated;
        create schema if not exists realtime;
        create table if not exists realtime.messages (extension text);
        alter table realtime.messages enable row level security;
        grant usage on schema realtime to authenticated;
        grant select, insert on realtime.messages to authenticated;
        create or replace function realtime.topic() returns text language sql stable as $$
          select current_setting('request.jwt.claim.topic', true)
        $$;
        grant execute on function realtime.topic() to authenticated;
        do $$ begin create publication supabase_realtime; exception when duplicate_object then null; end $$;
      `)
      await database.exec(schemaSql)
      await setWatchSyncTriggers(database, true)
      await database.exec(`
        create schema if not exists local_sync;
        create table if not exists local_sync.outbox (
          table_name text not null,
          row_key text not null,
          operation text not null check (operation in ('insert', 'update', 'delete', 'rpc')),
          payload jsonb not null default '{}'::jsonb,
          changed_at timestamptz not null default clock_timestamp(),
          primary key (table_name, row_key)
        );
      `)
      return database
    })()
    databasePromise = opening.catch(async (error: unknown) => {
      if (openingDatabase) await openingDatabase.close()
      databasePromise = null
      throw error
    })
  }
  return databasePromise
}

async function setWatchSyncTriggers(database: LocalDb, enabled: boolean) {
  const action = enabled ? 'enable' : 'disable'
  await database.exec(`
    alter table public.watch_items ${action} trigger guard_watch_items;
    alter table public.watch_participants ${action} trigger guard_watch_participants;
    alter table public.watch_votes ${action} trigger guard_watch_votes;
  `)
}

async function ensureLocalUser(database: LocalDb, user: LocalUser) {
  const existing = await database.query('select 1 from auth.users where id = $1', [user.id])
  if (!existing.rows.length) {
    await database.query('insert into auth.users (id, email) values ($1, $2)', [user.id, user.email ?? null])
  }
}

async function columnsFor(database: LocalDb, table: string) {
  const cached = columnCache.get(table)
  if (cached) return cached
  const result = await database.query<{ column_name: string }>(
    'select column_name from information_schema.columns where table_schema = $1 and table_name = $2',
    ['public', table],
  )
  const columns = new Set(result.rows.map((row) => row.column_name))
  if (!columns.size) throw new Error(`Tabella locale non supportata: ${table}.`)
  columnCache.set(table, columns)
  return columns
}

function quoteColumn(column: string, columns: Set<string>) {
  if (!/^[a-z_][a-z0-9_]*$/i.test(column) || !columns.has(column)) {
    throw new Error(`Colonna non valida nella richiesta locale: ${column}.`)
  }
  return `"${column}"`
}

function splitList(value: string) {
  return value.match(/"(?:[^"]|"")*"|[^,]+/g)?.map((part) => {
    const trimmed = part.trim()
    return trimmed.startsWith('"') && trimmed.endsWith('"')
      ? trimmed.slice(1, -1).replace(/""/g, '"')
      : trimmed
  }) ?? []
}

type SqlBuilder = { clauses: string[]; values: unknown[] }

function appendFilter(builder: SqlBuilder, column: string, rawValue: string, columns: Set<string>) {
  const columnSql = quoteColumn(column, columns)
  const separator = rawValue.indexOf('.')
  if (separator < 0) throw new Error(`Filtro PostgREST non valido: ${column}.`)
  const operator = rawValue.slice(0, separator)
  const operand = rawValue.slice(separator + 1)
  const allowed = new Set(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike', 'is', 'in'])
  if (!allowed.has(operator)) throw new Error(`Operatore PostgREST non supportato: ${operator}.`)
  if (operator === 'in') {
    const match = operand.match(/^\((.*)\)$/)
    if (!match) throw new Error(`Filtro IN non valido per ${column}.`)
    const values = splitList(match[1])
    if (!values.length) {
      builder.clauses.push('false')
      return
    }
    const placeholders = values.map((value) => {
      builder.values.push(value)
      return `$${builder.values.length}`
    })
    builder.clauses.push(`${columnSql} in (${placeholders.join(', ')})`)
    return
  }
  if (operator === 'is' && operand === 'null') {
    builder.clauses.push(`${columnSql} is null`)
    return
  }
  if (operator === 'eq' && operand === 'null') {
    builder.clauses.push(`${columnSql} is null`)
    return
  }
  if (operator === 'neq' && operand === 'null') {
    builder.clauses.push(`${columnSql} is not null`)
    return
  }
  const sqlOperator: Record<string, string> = {
    eq: '=', neq: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=', like: 'like', ilike: 'ilike', is: 'is',
  }
  builder.values.push(operand)
  builder.clauses.push(`${columnSql} ${sqlOperator[operator]} $${builder.values.length}`)
}

function buildWhere(url: URL, columns: Set<string>) {
  const builder: SqlBuilder = { clauses: [], values: [] }
  const reserved = new Set(['select', 'order', 'limit', 'offset', 'on_conflict', 'columns'])
  for (const [key, value] of url.searchParams.entries()) {
    if (!reserved.has(key)) appendFilter(builder, key, value, columns)
  }
  return {
    sql: builder.clauses.length ? ` where ${builder.clauses.join(' and ')}` : '',
    values: builder.values,
  }
}

async function selectedColumns(_database: LocalDb, table: SyncTable, url: URL, columns: Set<string>) {
  const selection = url.searchParams.get('select')?.trim() || '*'
  if (selection === '*') {
    return selectableColumns[table].map((column) => quoteColumn(column, columns)).join(', ')
  }
  return selection.split(',').map((column) => quoteColumn(column.trim(), columns)).join(', ')
}

function orderBy(url: URL, columns: Set<string>) {
  const value = url.searchParams.get('order')
  if (!value) return ''
  const parts = value.split(',').map((part) => {
    const [column, direction = 'asc'] = part.trim().split('.')
    if (direction !== 'asc' && direction !== 'desc') throw new Error(`Ordinamento non valido: ${part}.`)
    return `${quoteColumn(column, columns)} ${direction}`
  })
  return ` order by ${parts.join(', ')}`
}

async function withUserContext<T>(database: LocalDb, user: LocalUser, work: () => Promise<T>) {
  await database.exec('reset role')
  await database.exec('begin')
  try {
    await database.query("select set_config('request.jwt.claim.sub', $1, true)", [user.id])
    const identity = await database.query<{ user_id: string | null }>('select auth.uid() as user_id')
    if (identity.rows[0]?.user_id !== user.id) throw new Error('La sessione locale non corrisponde all’utente autenticato.')
    const result = await work()
    await database.exec('commit')
    return result
  } catch (error) {
    await database.exec('rollback')
    throw error
  }
}

function policySql(table: SyncTable, operation: 'select' | 'update' | 'delete') {
  if (operation === 'select') {
    switch (table) {
      case 'calendars':
        return 'public.is_current_user_calendar_member(id)'
      case 'calendar_members':
      case 'watch_sessions':
      case 'watch_participants':
      case 'watch_items':
        return 'public.is_current_user_calendar_member(calendar_id)'
      case 'calendar_view_preferences':
        return 'user_id = auth.uid() and public.is_current_user_calendar_member(calendar_id)'
      case 'shared_audio_playlists':
      case 'shared_audio_playlist_items':
      case 'shared_audio_player_settings':
        return 'public.is_current_user_calendar_member(calendar_id)'
      case 'shared_audio_favorites':
        return 'user_id = auth.uid() and public.is_current_user_calendar_member(calendar_id)'
      case 'calendar_items':
        return 'public.can_view_calendar_item(calendar_id, created_by, visibility, visible_to)'
      case 'watch_votes':
        return `exists (
          select 1 from public.watch_participants p
          join public.watch_sessions s on s.id = p.session_id
          where p.session_id = watch_votes.session_id and p.user_id = watch_votes.user_id
            and public.is_current_user_calendar_member(s.calendar_id)
            and (watch_votes.user_id = auth.uid() or s.status = 'finished')
        )`
      case 'user_profiles':
        return `user_id = auth.uid() or exists (
          select 1 from public.calendar_members me
          join public.calendar_members other on other.calendar_id = me.calendar_id
          where me.user_id = auth.uid() and other.user_id = user_profiles.user_id
        )`
    }
  }
  if (operation === 'update') {
    switch (table) {
      case 'calendar_members':
        return '(user_id = auth.uid() and public.is_current_user_calendar_member(calendar_id)) or public.can_edit_member_style(calendar_id, user_id, allow_style_editors)'
      case 'calendar_items':
        return 'public.can_edit_calendar_item(calendar_id, created_by, editable_by)'
      case 'calendar_view_preferences':
        return 'user_id = auth.uid() and public.is_current_user_calendar_member(calendar_id)'
      case 'shared_audio_playlists':
      case 'shared_audio_playlist_items':
      case 'shared_audio_player_settings':
        return 'public.is_current_user_calendar_member(calendar_id)'
      case 'watch_votes':
        return `user_id = auth.uid() and exists (
          select 1 from public.watch_participants p
          join public.watch_sessions s on s.id = p.session_id
          where p.session_id = watch_votes.session_id and p.user_id = auth.uid()
            and s.status = 'voting' and public.is_current_user_calendar_member(s.calendar_id)
        )`
      case 'user_profiles':
        return 'user_id = auth.uid()'
      default:
        return 'false'
    }
  }
  switch (table) {
    case 'calendar_items':
      return 'public.can_edit_calendar_item(calendar_id, created_by, editable_by)'
    case 'calendar_view_preferences':
      return 'user_id = auth.uid() and public.is_current_user_calendar_member(calendar_id)'
    case 'shared_audio_playlists':
      return 'not is_queue and public.is_current_user_calendar_member(calendar_id)'
    case 'shared_audio_playlist_items':
      return 'public.is_current_user_calendar_member(calendar_id)'
    case 'shared_audio_favorites':
      return 'user_id = auth.uid() and public.is_current_user_calendar_member(calendar_id)'
    case 'watch_sessions':
    case 'watch_items':
      return 'public.can_edit_calendar(calendar_id)'
    case 'watch_participants':
      return 'user_id = auth.uid() and public.is_current_user_calendar_member(calendar_id)'
    default:
      return 'false'
  }
}

async function assertInsertAllowed(database: LocalDb, user: LocalUser, table: SyncTable, row: Row) {
  let condition: string
  let values: unknown[]
  switch (table) {
    case 'calendars':
      condition = '$1::uuid = auth.uid()'
      values = [row.created_by]
      break
    case 'watch_sessions':
    case 'watch_items':
      condition = '$1::uuid = auth.uid() and public.can_edit_calendar($2::uuid)'
      values = [row.created_by, row.calendar_id]
      break
    case 'calendar_items':
      condition = '$1::uuid = auth.uid() and public.is_current_user_calendar_member($2::uuid)'
      values = [row.created_by, row.calendar_id]
      break
    case 'watch_participants':
      condition = '$1::uuid = auth.uid() and public.is_current_user_calendar_member($2::uuid)'
      values = [row.user_id, row.calendar_id]
      break
    case 'watch_votes':
      condition = `$1::uuid = auth.uid() and exists (
        select 1 from public.watch_participants p
        join public.watch_sessions s on s.id = p.session_id
        where p.session_id = $2::uuid and p.user_id = auth.uid()
          and s.status = 'voting' and public.is_current_user_calendar_member(s.calendar_id)
      )`
      values = [row.user_id, row.session_id]
      break
    case 'user_profiles':
      condition = '$1::uuid = auth.uid()'
      values = [row.user_id]
      break
    case 'calendar_view_preferences':
      condition = '$1::uuid = auth.uid() and public.is_current_user_calendar_member($2::uuid)'
      values = [row.user_id, row.calendar_id]
      break
    case 'shared_audio_playlists':
      condition = '$1::uuid = auth.uid() and not $2::boolean and public.is_current_user_calendar_member($3::uuid)'
      values = [row.created_by, row.is_queue, row.calendar_id]
      break
    case 'shared_audio_playlist_items':
      condition = '$1::uuid = auth.uid() and public.is_current_user_calendar_member($2::uuid)'
      values = [row.added_by, row.calendar_id]
      break
    case 'shared_audio_favorites':
      condition = '$1::uuid = auth.uid() and public.is_current_user_calendar_member($2::uuid)'
      values = [row.user_id, row.calendar_id]
      break
    case 'shared_audio_player_settings':
      condition = 'public.is_current_user_calendar_member($1::uuid)'
      values = [row.calendar_id]
      break
    default:
      condition = 'false'
      values = []
  }
  if (table === 'watch_votes' && row.user_id !== user.id) condition = 'false'
  const result = await database.query<{ allowed: boolean }>(`select (${condition}) as allowed`, values)
  if (result.rows[0]?.allowed !== true) throw new Error(`Permesso negato per creare una riga in ${table}.`)
}

async function recordOutbox(database: LocalDb, table: string, key: Row, operation: OutboxRow['operation'], payload: Row, changedAt?: unknown) {
  const timestamp = changedAt ?? (await database.query<{ changed_at: Date }>('select clock_timestamp() as changed_at')).rows[0].changed_at
  await database.query(
    `insert into local_sync.outbox (table_name, row_key, operation, payload, changed_at)
     values ($1, $2, $3, $4::jsonb, $5)
     on conflict (table_name, row_key) do update set
       operation = excluded.operation, payload = excluded.payload, changed_at = excluded.changed_at`,
    [table, stableKey(key), operation, JSON.stringify(payload), timestamp],
  )
}

async function fullLocalRow(database: LocalDb, table: SyncTable, key: Row) {
  const columns = await columnsFor(database, table)
  const predicates = primaryKeys[table].map((column) => `${quoteColumn(column, columns)} = $${primaryKeys[table].indexOf(column) + 1}`)
  const values = primaryKeys[table].map((column) => key[column])
  const result = await database.query<Row>(
    `select * from public."${table}" where ${predicates.join(' and ')}`,
    values,
  )
  return result.rows[0] ?? null
}

function localMutationQuery(method: string, table: SyncTable, columns: Set<string>, url: URL, body: unknown, accessPolicy: string) {
  const filters = buildWhere(url, columns)
  const keys = primaryKeys[table].map((column) => quoteColumn(column, columns))
  if (method === 'POST') {
    const rows = Array.isArray(body) ? body as Row[] : [body as Row]
    if (!rows.length || rows.some((row) => !row || typeof row !== 'object')) throw new Error('Il corpo della richiesta INSERT non è valido.')
    const providedColumns = [...new Set(rows.flatMap((row) => Object.keys(row)))]
    if (!providedColumns.length) throw new Error('La richiesta INSERT non contiene colonne.')
    if (providedColumns.some((column) => !insertColumns[table].includes(column))) {
      throw new Error(`La richiesta INSERT contiene colonne non consentite per ${table}.`)
    }
    const columnSql = providedColumns.map((column) => quoteColumn(column, columns)).join(', ')
    const values: unknown[] = []
    const valueSql = rows.map((row) => `(${providedColumns.map((column) => {
      values.push(row[column] ?? null)
      return `$${values.length}`
    }).join(', ')})`)
    const conflict = url.searchParams.get('on_conflict')
    const clause = conflict
      ? ` on conflict (${conflict.split(',').map((column) => quoteColumn(column, columns)).join(', ')}) do nothing`
      : ''
    return { sql: `insert into public."${table}" (${columnSql}) values ${valueSql.join(', ')}${clause} returning ${keys.join(', ')}`, values, filters, sourceRows: rows }
  }
  if (!filters.sql) throw new Error(`${method} locale richiede almeno un filtro.`)
  if (method === 'PATCH') {
    const patch = body as Row
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('Il corpo della richiesta UPDATE non è valido.')
    if (Object.keys(patch).some((column) => !updateColumns[table].includes(column))) {
      throw new Error(`La richiesta UPDATE contiene colonne non consentite per ${table}.`)
    }
    const values = [...Object.entries(patch).map(([, value]) => value ?? null), ...filters.values]
    const assignments = Object.keys(patch).map((column, index) => `${quoteColumn(column, columns)} = $${index + 1}`)
    const securedFilters = `${filters.sql} and (${accessPolicy})`
    const where = securedFilters.replace(/\$(\d+)/g, (_, index: string) => `$${Number(index) + assignments.length}`)
    if (!assignments.length) throw new Error('La richiesta UPDATE non contiene colonne.')
    return { sql: `update public."${table}" set ${assignments.join(', ')}${where} returning ${keys.join(', ')}`, values, filters, sourceRows: [patch] }
  }
  if (method === 'DELETE') {
    return { sql: `delete from public."${table}"${filters.sql} and (${accessPolicy}) returning ${keys.join(', ')}`, values: filters.values, filters, sourceRows: [] }
  }
  throw new Error(`Metodo PostgREST non supportato: ${method}.`)
}

async function selectByKeys(database: LocalDb, table: SyncTable, keys: Row[], selection: string, columns: Set<string>) {
  const rows: Row[] = []
  for (const key of keys) {
    const predicates = primaryKeys[table].map((column, index) => {
      return `${quoteColumn(column, columns)} = $${index + 1}`
    })
    const values = primaryKeys[table].map((column) => key[column])
    const result = await database.query<Row>(
      `select ${selection} from public."${table}"
       where ${predicates.join(' and ')} and (${policySql(table, 'select')})`,
      values,
    )
    rows.push(...result.rows)
  }
  return rows
}

async function keysPassingPolicy(database: LocalDb, table: SyncTable, keys: Row[], columns: Set<string>, policy: string) {
  const allowed: Row[] = []
  for (const key of keys) {
    const predicates = primaryKeys[table].map((column, index) => `${quoteColumn(column, columns)} = $${index + 1}`)
    const values = primaryKeys[table].map((column) => key[column])
    const result = await database.query(
      `select 1 from public."${table}" where ${predicates.join(' and ')} and (${policy})`,
      values,
    )
    if (result.rows.length) allowed.push(key)
  }
  return allowed
}

function rpcOutboxTarget(name: string, args: Row, result: unknown, user: LocalUser) {
  switch (name) {
    case 'join_calendar_with_code':
      return { table: 'calendar_members', key: { calendar_id: result, user_id: user.id } }
    case 'manage_calendar_member':
      return { table: 'calendar_members', key: { calendar_id: args.p_calendar_id, user_id: args.p_user_id } }
    case 'rotate_calendar_invites':
      return { table: 'calendars', key: { id: args.p_calendar_id } }
    case 'start_watch_round':
      return { table: 'watch_sessions', key: { id: args.p_session_id } }
    case 'finish_watch_round_if_complete':
      return result === true ? { table: 'watch_sessions', key: { id: args.p_session_id } } : null
    case 'add_shared_audio_playlist_item':
    case 'move_shared_audio_playlist_item':
    case 'remove_shared_audio_playlist_item':
      return { table: 'shared_audio_playlist_items', key: { playlist_id: args.p_playlist_id, object_path: args.p_object_path } }
    default:
      return null
  }
}

async function handleLocalRpc(database: LocalDb, user: LocalUser, name: string, args: Row) {
  const definition = rpcSql[name]
  if (!definition) throw new Error(`Funzione RPC locale non supportata: ${name}.`)
  const params = definition.params.map((parameter) => args[parameter])
  const result = await withUserContext(database, user, async () => {
    const queryResult = await database.query<Row>(definition.sql, params)
    const value = definition.result === 'rows'
      ? queryResult.rows
      : definition.result === 'scalar'
        ? queryResult.rows[0]?.value ?? null
        : null
    const target = rpcOutboxTarget(name, args, value, user)
    if (target) {
      await database.exec('reset role')
      const changedAt = (await database.query<{ changed_at: Date }>('select clock_timestamp() as changed_at')).rows[0].changed_at
      await recordOutbox(
        database,
        target.table,
        target.key,
        'rpc',
        { name, args },
        changedAt,
      )
    }
    return value
  })
  return makeResponse(200, result)
}

async function handleLocalTableRequest(database: LocalDb, user: LocalUser, request: Request, table: SyncTable, url: URL) {
  const method = request.method.toUpperCase()
  const columns = await columnsFor(database, table)
  const selection = await selectedColumns(database, table, url, columns)
  const userResult = await withUserContext(database, user, async () => {
    if (method === 'GET' || method === 'HEAD') {
      const filters = buildWhere(url, columns)
      const accessFilter = filters.sql
        ? `${filters.sql} and (${policySql(table, 'select')})`
        : ` where ${policySql(table, 'select')}`
      const range = request.headers.get('range')?.match(/^(\d+)-(\d+)$/)
      const limit = Number(url.searchParams.get('limit') ?? (range ? Number(range[2]) - Number(range[1]) + 1 : 1000))
      const offset = Number(url.searchParams.get('offset') ?? (range ? Number(range[1]) : 0))
      if (!Number.isSafeInteger(limit) || limit < 0 || !Number.isSafeInteger(offset) || offset < 0) throw new Error('Intervallo di righe non valido.')
      const result = await database.query<Row>(
        `select ${selection} from public."${table}"${accessFilter}${orderBy(url, columns)} limit ${limit} offset ${offset}`,
        filters.values,
      )
      return { rows: result.rows, total: result.rows.length }
    }
    if (method !== 'POST' && method !== 'PATCH' && method !== 'DELETE') {
      throw new Error(`Metodo PostgREST non supportato: ${method}.`)
    }
    const requestBody = method === 'DELETE' ? null : await request.clone().json()
    const wantsRepresentation = request.headers.get('prefer')?.includes('return=representation') ?? false
    const filters = buildWhere(url, columns)
    let deletedRows: Row[] = []
    if (method === 'DELETE' && wantsRepresentation) {
      const allowedFilter = `${filters.sql} and (${policySql(table, 'delete')})`
      const result = await database.query<Row>(
        `select ${selection} from public."${table}"${allowedFilter}`,
        filters.values,
      )
      deletedRows = result.rows
    }
    if (method === 'POST') {
      const inputRows = Array.isArray(requestBody) ? requestBody as Row[] : [requestBody as Row]
      for (const row of inputRows) await assertInsertAllowed(database, user, table, row)
    }
    const accessPolicy = policySql(table, method === 'PATCH' ? 'update' : 'delete')
    const query = localMutationQuery(method, table, columns, url, requestBody, accessPolicy)
    const changedKeys = (await database.query<Row>(query.sql, query.values)).rows
    for (const key of changedKeys) {
      if (method === 'DELETE') {
        await recordOutbox(database, table, key, 'delete', {})
      } else {
        const fullRow = await fullLocalRow(database, table, key)
        if (fullRow) {
          const operation = method === 'POST' ? 'insert' : 'update'
          await recordOutbox(database, table, key, operation, fullRow, fullRow.sync_updated_at)
        }
      }
    }
    if (!wantsRepresentation || !changedKeys.length) {
      return { rows: [], total: changedKeys.length }
    }
    if (method === 'DELETE') return { rows: deletedRows, total: deletedRows.length }
    if (method === 'PATCH') {
      const allowedKeys = await keysPassingPolicy(database, table, changedKeys, columns, policySql(table, 'update'))
      if (allowedKeys.length !== changedKeys.length) {
        throw new Error(`Permesso negato dopo l'aggiornamento della riga in ${table}.`)
      }
    }
    const selected = await selectByKeys(database, table, changedKeys, selection, columns)
    return { rows: selected, total: selected.length }
  })
  if (method === 'HEAD') return new Response(null, { status: 200 })
  if (method !== 'GET' && !request.headers.get('prefer')?.includes('return=representation')) {
    return new Response(null, { status: method === 'POST' ? 201 : 204 })
  }
  const data = userResult.rows
  if (request.headers.get('accept')?.includes('application/vnd.pgrst.object+json')) {
    if (data.length !== 1) {
      return makeResponse(406, {
        code: 'PGRST116',
        details: `Results contain ${data.length} rows, application/vnd.pgrst.object+json requires 1 row`,
        hint: null,
        message: 'JSON object requested, multiple (or no) rows returned',
      })
    }
    return makeResponse(200, data[0], { 'content-range': `0-0/${userResult.total}` })
  }
  return makeResponse(method === 'POST' ? 201 : 200, data, { 'content-range': `0-${Math.max(data.length - 1, 0)}/${userResult.total}` })
}

async function handleLocalDatabaseRequestLocked(request: Request, user: LocalUser | null) {
  if (!import.meta.env.DEV) return errorResponse(new Error('Fallback locale disabilitato fuori da npm run dev.'), 503)
  if (!user?.id) return errorResponse(new Error('Per usare il database locale devi avere una sessione Supabase già autenticata.'), 401)
  const url = new URL(request.url)
  const path = url.pathname.match(/\/rest\/v1\/(.+)$/)?.[1] ?? ''
  if (!path) return makeResponse(200, {})
  try {
    const database = await openDatabase()
    await ensureLocalUser(database, user)
    const rpcName = path.startsWith('rpc/') ? path.slice(4) : null
    if (rpcName) {
      const body = await request.clone().json() as Row
      return await handleLocalRpc(database, user, rpcName, body)
    }
    if (!(syncTables as readonly string[]).includes(path)) {
      return errorResponse(new Error(`Endpoint locale non supportato: ${path}.`), 404)
    }
    return await handleLocalTableRequest(database, user, request, path as SyncTable, url)
  } catch (error) {
    return errorResponse(error, 500)
  }
}

export function handleLocalDatabaseRequest(request: Request, user: LocalUser | null) {
  return serializeDatabaseTask(() => handleLocalDatabaseRequestLocked(request, user))
}

async function queueContains(database: LocalDb, table: string, key: Row) {
  const result = await database.query<{ exists: boolean }>(
    'select exists (select 1 from local_sync.outbox where table_name = $1 and row_key = $2) as exists',
    [table, stableKey(key)],
  )
  return result.rows[0]?.exists === true
}

async function upsertLocalRow(database: LocalDb, table: SyncTable, row: Row) {
  const columns = await columnsFor(database, table)
  const entries = Object.entries(row).filter(([column]) => columns.has(column))
  if (!entries.length) return
  await database.exec('begin')
  try {
    await database.query("select set_config('app.syncing', 'true', true)")
    const columnSql = entries.map(([column]) => quoteColumn(column, columns)).join(', ')
    const values = entries.map(([, value]) => value)
    const placeholders = values.map((_, index) => `$${index + 1}`)
    const keyColumns = primaryKeys[table]
    const updates = entries
      .filter(([column]) => !keyColumns.includes(column))
      .map(([column]) => `${quoteColumn(column, columns)} = excluded.${quoteColumn(column, columns)}`)
    const conflict = updates.length
      ? `do update set ${updates.join(', ')}`
      : 'do nothing'
    await database.query(
      `insert into public."${table}" (${columnSql}) values (${placeholders.join(', ')})
       on conflict (${keyColumns.map((column) => quoteColumn(column, columns)).join(', ')}) ${conflict}`,
      values,
    )
    await database.exec('commit')
  } catch (error) {
    await database.exec('rollback')
    throw error
  }
}

async function deleteLocalRow(database: LocalDb, table: SyncTable, key: Row) {
  const columns = await columnsFor(database, table)
  const predicates = primaryKeys[table].map((column, index) => `${quoteColumn(column, columns)} = $${index + 1}`)
  const values = primaryKeys[table].map((column) => key[column])
  await database.query(`delete from public."${table}" where ${predicates.join(' and ')}`, values)
}

async function mirrorRemoteResponseLocked(tableName: string, method: string, data: unknown) {
  if (!(syncTables as readonly string[]).includes(tableName)) return
  const table = tableName as SyncTable
  const database = await openDatabase()
  const rows = Array.isArray(data) ? data as Row[] : data && typeof data === 'object' ? [data as Row] : []
  for (const row of rows) {
    const key = rowKey(table, row)
    if (primaryKeys[table].some((column) => key[column] === undefined)) continue
    if (method === 'DELETE') await deleteLocalRow(database, table, key)
    else if (!await queueContains(database, table, key)) {
      const existing = await fullLocalRow(database, table, key)
      if (!existing && !selectableColumns[table].every((column) => column in row)) continue
      const merged = { ...(existing ?? {}), ...row }
      await seedAuthUsers(database, null, [[merged]])
      await upsertLocalRow(database, table, merged)
    }
  }
}

export function mirrorRemoteResponse(tableName: string, method: string, data: unknown) {
  return serializeDatabaseTask(() => mirrorRemoteResponseLocked(tableName, method, data))
}

export function mirrorSharedFiles(calendarId: string, files: Array<{ name: string; metadata: Record<string, unknown> | null }>) {
  return serializeDatabaseTask(async () => {
    const database = await openDatabase()
    for (const file of files) {
      const objectName = `${calendarId}/${file.name}`
      const existing = await database.query(
        'select 1 from storage.objects where bucket_id = $1 and name = $2 limit 1',
        [sharedStorageBucket, objectName],
      )
      if (existing.rows.length) {
        await database.query(
          'update storage.objects set metadata = $1::jsonb where bucket_id = $2 and name = $3',
          [JSON.stringify(file.metadata ?? {}), sharedStorageBucket, objectName],
        )
      } else {
        await database.query(
          'insert into storage.objects (bucket_id, name, metadata) values ($1, $2, $3::jsonb)',
          [sharedStorageBucket, objectName, JSON.stringify(file.metadata ?? {})],
        )
      }
    }
  })
}

async function remoteRequest(url: string, apiKey: string, accessToken: string, path: string, init: RequestInit = {}) {
  const { response, body } = await fetchForSync(`${url.replace(/\/$/, '')}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: apiKey,
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...init.headers,
    },
  })
  if (!response.ok) {
    throw new Error(`Sincronizzazione Supabase non riuscita (HTTP ${response.status}): ${body.slice(0, 300)}`)
  }
  return body ? JSON.parse(body) as unknown : null
}

async function fetchForSync(url: string, init: RequestInit) {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), 15_000)
  try {
    const response = await fetch(url, { ...init, signal: controller.signal })
    const body = await response.text()
    return { response, body }
  } finally {
    window.clearTimeout(timeout)
  }
}

async function fetchRemoteRows(url: string, apiKey: string, accessToken: string, table: SyncTable, onProgress?: SyncProgress) {
  const rows: Row[] = []
  const selection = new URLSearchParams({ select: selectableColumns[table].join(',') })
  for (let offset = 0; ; offset += 1000) {
    onProgress?.(`Lettura ${table}${offset ? ` (da ${offset})` : ''}`)
    const { response, body } = await fetchForSync(`${url.replace(/\/$/, '')}/rest/v1/${table}?${selection.toString()}`, {
      headers: {
        apikey: apiKey,
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
        'Range-Unit': 'items',
        Range: `${offset}-${offset + 999}`,
      },
    })
    if (!response.ok) {
      throw new Error(`Impossibile leggere ${table} per la sincronizzazione (HTTP ${response.status}): ${body.slice(0, 250)}`)
    }
    const page = body ? JSON.parse(body) as Row[] : []
    if (page.length && page.some((row) => typeof row.sync_updated_at !== 'string')) {
      throw new Error('Aggiorna lo schema Supabase applicando supabase/schema.sql: manca la versione sync_updated_at richiesta per la replica.')
    }
    rows.push(...page)
    if (page.length < 1000) break
  }
  if (!rows.length) {
    await remoteRequest(url, apiKey, accessToken, `${table}?${selection.toString()}&limit=1`)
  }
  return rows
}

async function fetchRemoteTombstones(url: string, apiKey: string, accessToken: string) {
  return await remoteRequest(url, apiKey, accessToken, 'sync_tombstones?select=table_name,row_key,calendar_id,user_id,deleted_at') as Row[]
}

function timestamp(value: unknown) {
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'string') return Date.parse(value)
  return Number.NaN
}

function tombstoneKey(table: string, key: Row) {
  return `${table}:${stableKey(key)}`
}

function remotePath(table: string, key: Row) {
  const params = new URLSearchParams()
  for (const [column, value] of Object.entries(key)) params.set(column, `eq.${String(value)}`)
  return `${table}?${params.toString()}`
}

async function localRows(database: LocalDb, table: SyncTable) {
  return (await database.query<Row>(`select * from public."${table}"`)).rows
}

async function removeOutbox(database: LocalDb, table: string, key: Row) {
  await database.query('delete from local_sync.outbox where table_name = $1 and row_key = $2', [table, stableKey(key)])
}

async function seedAuthUsers(database: LocalDb, user: LocalUser | null, rows: Row[][]) {
  const ids = new Set<string>(user ? [user.id] : [])
  for (const group of rows) {
    for (const row of group) {
      for (const column of ['created_by', 'assignee_id', 'user_id', 'added_by']) {
        if (typeof row[column] === 'string') ids.add(row[column] as string)
      }
      if (Array.isArray(row.visible_to)) {
        for (const id of row.visible_to) if (typeof id === 'string') ids.add(id)
      }
    }
  }
  for (const id of ids) {
    const existing = await database.query('select 1 from auth.users where id = $1', [id])
    if (!existing.rows.length) {
      await database.query('insert into auth.users (id, email) values ($1, $2)', [
        id,
        id === user?.id ? user.email ?? null : null,
      ])
    }
  }
}

async function applyRemoteTombstones(database: LocalDb, tombstones: Row[], rowsByTable: Map<string, Map<string, Row>>) {
  for (const tombstone of tombstones) {
    const tableName = String(tombstone.table_name)
    if (!(syncTables as readonly string[]).includes(tableName)) continue
    const table = tableName as SyncTable
    const key = tombstone.row_key as Row
    const row = rowsByTable.get(table)?.get(stableKey(key))
    if (!row || timestamp(tombstone.deleted_at) > timestamp(row.sync_updated_at)) {
      const local = (await localRows(database, table)).find((candidate) => stableKey(rowKey(table, candidate)) === stableKey(key))
      if (local && timestamp(tombstone.deleted_at) > timestamp(local.sync_updated_at)) {
        await deleteLocalRow(database, table, key)
      }
    }
  }
}

async function replayRpc(url: string, apiKey: string, accessToken: string, payload: Row) {
  const name = String(payload.name)
  if (!rpcSql[name]) throw new Error(`RPC in coda non supportata: ${name}.`)
  await remoteRequest(url, apiKey, accessToken, `rpc/${name}`, {
    method: 'POST',
    body: JSON.stringify(payload.args),
  })
}

async function pushOutboxEntry(
  database: LocalDb,
  url: string,
  apiKey: string,
  accessToken: string,
  entry: OutboxRow,
  remoteRows: Map<string, Row>,
  remoteTombstones: Map<string, Row>,
) {
  const table = entry.table_name as SyncTable
  const key = JSON.parse(entry.row_key) as Row
  const localVersion = timestamp(entry.changed_at)
  const remoteRow = remoteRows.get(entry.row_key)
  const tombstone = remoteTombstones.get(tombstoneKey(table, key))
  const rowVersion = timestamp(remoteRow?.sync_updated_at)
  const tombstoneVersion = timestamp(tombstone?.deleted_at)
  const cloudVersion = Math.max(
    Number.isFinite(rowVersion) ? rowVersion : Number.NEGATIVE_INFINITY,
    Number.isFinite(tombstoneVersion) ? tombstoneVersion : Number.NEGATIVE_INFINITY,
  )
  if (Number.isFinite(cloudVersion) && localVersion <= cloudVersion) {
    await removeOutbox(database, entry.table_name, key)
    return
  }

  if (entry.operation === 'rpc') {
    const payload = entry.payload
    if (entry.table_name === 'calendar_members' && !remoteRow
      && (payload.args as Row | undefined)?.p_remove === true) {
      await removeOutbox(database, entry.table_name, key)
      return
    }
    await replayRpc(url, apiKey, accessToken, payload)
    await removeOutbox(database, entry.table_name, key)
    return
  }
  if (entry.operation === 'delete') {
    if (remoteRow) await remoteRequest(url, apiKey, accessToken, remotePath(table, key), { method: 'DELETE' })
    await removeOutbox(database, entry.table_name, key)
    return
  }

  const writable = remoteRow ? updateColumns[table] : insertColumns[table]
  const body = Object.fromEntries(writable
    .filter((column) => entry.payload[column] !== undefined)
    .map((column) => [column, entry.payload[column]]))
  if (!Object.keys(body).length) {
    throw new Error(`La modifica locale a ${table} non è replicabile con i permessi Supabase correnti.`)
  }
  const result = await remoteRequest(url, apiKey, accessToken, remoteRow ? remotePath(table, key) : table, {
    method: remoteRow ? 'PATCH' : 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(body),
  })
  const row = Array.isArray(result) ? result[0] as Row | undefined : result as Row | null
  if (!row) throw new Error(`Supabase non ha confermato la modifica locale a ${table}.`)
  await upsertLocalRow(database, table, row)
  await removeOutbox(database, entry.table_name, key)
}

function isLockedWatchChange(error: unknown, table: SyncTable) {
  return (table === 'watch_items' || table === 'watch_participants')
    && error instanceof Error
    && error.message.includes('Partecipanti e titoli non possono cambiare dopo l’avvio.')
}

async function synchronizeLocalDatabaseLocked(
  url: string,
  apiKey: string,
  accessToken: string,
  user: LocalUser,
  onProgress?: SyncProgress,
): Promise<SyncResult> {
  onProgress?.('Avvio database locale')
  const database = await openDatabase()
  await ensureLocalUser(database, user)

  const initialSnapshots = new Map<string, Row[]>()
  for (const [index, table] of syncTables.entries()) {
    onProgress?.(`Lettura iniziale ${table} (${index + 1}/${syncTables.length})`)
    initialSnapshots.set(table, await fetchRemoteRows(url, apiKey, accessToken, table, onProgress))
  }
  onProgress?.('Lettura delle eliminazioni')
  const tombstones = await fetchRemoteTombstones(url, apiKey, accessToken)
  await seedAuthUsers(database, user, [...initialSnapshots.values()])

  const remoteRowsByTable = new Map<string, Map<string, Row>>()
  for (const table of syncTables) {
    const rows = initialSnapshots.get(table) ?? []
    remoteRowsByTable.set(table, new Map(rows.map((row) => [stableKey(rowKey(table, row)), row])))
  }
  const tombstonesByKey = new Map(tombstones.map((row) => [
    tombstoneKey(String(row.table_name), row.row_key as Row),
    row,
  ]))
  const queue = await database.query<OutboxRow>(
    'select table_name, row_key, operation, payload, changed_at from local_sync.outbox order by changed_at, table_name',
  )
  let discardedLockedChanges = 0
  onProgress?.(`Invio di ${queue.rows.length} modifiche locali`)
  for (const entry of queue.rows) {
    if (!(syncTables as readonly string[]).includes(entry.table_name)) continue
    const table = entry.table_name as SyncTable
    const remoteRows = remoteRowsByTable.get(table) ?? new Map<string, Row>()
    if (table === 'watch_items' || table === 'watch_participants') {
      const key = JSON.parse(entry.row_key) as Row
      const remoteRow = remoteRows.get(entry.row_key)
      const sessionId = remoteRow?.session_id ?? entry.payload.session_id ?? key.session_id
      const remoteSession = typeof sessionId === 'string'
        ? remoteRowsByTable.get('watch_sessions')?.get(stableKey({ id: sessionId }))
        : undefined
      if (remoteSession && remoteSession.status !== 'draft') {
        await removeOutbox(database, table, key)
        discardedLockedChanges += 1
        continue
      }
    }
    try {
      await pushOutboxEntry(database, url, apiKey, accessToken, entry, remoteRows, tombstonesByKey)
    } catch (error) {
      if (!isLockedWatchChange(error, table)) throw error
      const key = JSON.parse(entry.row_key) as Row
      await removeOutbox(database, table, key)
      discardedLockedChanges += 1
    }
  }

  const finalSnapshots = new Map<string, Row[]>()
  for (const [index, table] of syncTables.entries()) {
    onProgress?.(`Verifica ${table} (${index + 1}/${syncTables.length})`)
    finalSnapshots.set(table, await fetchRemoteRows(url, apiKey, accessToken, table, onProgress))
  }
  onProgress?.('Lettura delle eliminazioni aggiornate')
  const finalTombstones = await fetchRemoteTombstones(url, apiKey, accessToken)
  await seedAuthUsers(database, user, [...finalSnapshots.values()])
  const finalRowsByTable = new Map<string, Map<string, Row>>()
  // Remote snapshots must also replace locally locked Watch-decider rows.
  await setWatchSyncTriggers(database, false)
  try {
    for (const table of syncTables) {
      onProgress?.(`Aggiornamento cache: ${table}`)
      const remoteRows = finalSnapshots.get(table) ?? []
      const rowsByKey = new Map(remoteRows.map((row) => [stableKey(rowKey(table, row)), row]))
      finalRowsByTable.set(table, rowsByKey)
      for (const row of remoteRows) {
        const key = rowKey(table, row)
        if (!await queueContains(database, table, key)) await upsertLocalRow(database, table, row)
      }
    }

    await applyRemoteTombstones(database, finalTombstones, finalRowsByTable)
    for (const table of [...syncTables].reverse()) {
      const remoteKeys = new Set(finalRowsByTable.get(table)?.keys() ?? [])
      const local = await localRows(database, table)
      for (const row of local) {
        const key = rowKey(table, row)
        if (await queueContains(database, table, key)) continue
        if (table === 'watch_votes' && row.user_id !== user.id) continue
        if (!remoteKeys.has(stableKey(key))) await deleteLocalRow(database, table, key)
      }
    }
  } finally {
    await setWatchSyncTriggers(database, true)
  }

  const calendars = finalSnapshots.get('calendars') ?? []
  const members = finalSnapshots.get('calendar_members') ?? []
  const ownedCalendars = calendars.filter((calendar) =>
    members.some((member) => member.calendar_id === calendar.id && member.user_id === user.id && member.role === 'owner'),
  )
  for (const calendar of ownedCalendars) {
    const [inviteCode, editCode] = await Promise.all([
      remoteRequest(url, apiKey, accessToken, `rpc/get_calendar_invite_code`, {
        method: 'POST', body: JSON.stringify({ p_calendar_id: calendar.id }),
      }),
      remoteRequest(url, apiKey, accessToken, `rpc/get_calendar_edit_invite_code`, {
        method: 'POST', body: JSON.stringify({ p_calendar_id: calendar.id }),
      }),
    ])
    await database.exec('begin')
    try {
      await database.query("select set_config('app.syncing', 'true', true)")
      await database.query(
        'update public.calendars set invite_code = $1, edit_invite_code = $2 where id = $3',
        [inviteCode, editCode, calendar.id],
      )
      await database.exec('commit')
    } catch (error) {
      await database.exec('rollback')
      throw error
    }
  }
  return { discardedLockedChanges }
}

export function synchronizeLocalDatabase(
  url: string,
  apiKey: string,
  accessToken: string,
  user: LocalUser,
  onProgress?: SyncProgress,
) {
  return serializeDatabaseTask(() => synchronizeLocalDatabaseLocked(url, apiKey, accessToken, user, onProgress))
}
