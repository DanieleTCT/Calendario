// Verifica OFFLINE (nessuna credenziale/rete) della logica SupabaseRepository,
// usando un finto client con la stessa API chainable di @supabase/supabase-js.
//   npx tsx scripts/test-supabase-mock.ts
// Copre: tabelle, mapping {id,data}, CRUD items, conversazioni, pending actions,
// settings single-row (id='global'), export/import, propagazione errori.
import { SupabaseRepository } from '../packages/storage/src/supabase-repository';

type Row = Record<string, any>;
type Res = { data: any; error: any; count?: number | null };

class FakeBuilder implements PromiseLike<Res> {
  private filters: Array<[string, any]> = [];
  private notFilters: Array<[string, any]> = [];
  private limitN: number | null = null;
  private single = false;
  constructor(
    private store: { rows: Row[] },
    private op: 'select' | 'insert' | 'update' | 'upsert' | 'delete',
    public payload?: any,
    private countMode: 'exact' | null = null
  ) {}
  select(_cols?: string) { return this; }
  eq(col: string, val: any) { this.filters.push([col, val]); return this; }
  neq(col: string, val: any) { this.notFilters.push([col, val]); return this; }
  limit(n: number) { this.limitN = n; return this; }
  maybeSingle() { this.single = true; return this; }
  private matches(r: Row) {
    const okEq = this.filters.every(([c, v]) => r[c] === v);
    const okNeq = this.notFilters.every(([c, v]) => r[c] !== v);
    return okEq && okNeq;
  }
  private run(): Res {
    const { rows } = this.store;
    if (this.op === 'select') {
      let out = rows.filter((r) => this.matches(r));
      if (this.limitN !== null) out = out.slice(0, this.limitN);
      if (this.single) return { data: out[0] ?? null, error: null };
      return { data: out, error: null };
    }
    if (this.op === 'insert') {
      rows.push({ ...this.payload });
      return { data: null, error: null };
    }
    if (this.op === 'upsert') {
      const i = rows.findIndex((r) => r.id === this.payload.id);
      if (i === -1) rows.push({ ...this.payload });
      else rows[i] = { ...rows[i], ...this.payload };
      return { data: null, error: null };
    }
    if (this.op === 'update') {
      const hit = rows.filter((r) => this.matches(r));
      for (const r of hit) Object.assign(r, this.payload);
      return { data: hit, error: null };
    }
    const hit = rows.filter((r) => this.matches(r));
    for (const r of hit) rows.splice(rows.indexOf(r), 1);
    return { data: hit, error: null, count: this.countMode === 'exact' ? hit.length : null };
  }
  then<A = Res, B = never>(onF?: ((v: Res) => A | PromiseLike<A>) | null, onR?: ((e: any) => B | PromiseLike<B>) | null): PromiseLike<A | B> {
    return Promise.resolve(this.run()).then(onF as any, onR as any);
  }
}

class FakeClient {
  tables = new Map<string, { rows: Row[] }>();
  private store(t: string) { if (!this.tables.has(t)) this.tables.set(t, { rows: [] }); return this.tables.get(t)!; }
  from(table: string) {
    const s = this.store(table);
    return {
      select: (cols?: string) => new FakeBuilder(s, 'select').select(cols),
      insert: (payload: any) => new FakeBuilder(s, 'insert', payload),
      upsert: (payload: any) => new FakeBuilder(s, 'upsert', payload),
      update: (payload: any) => new FakeBuilder(s, 'update', payload),
      delete: (opts?: { count?: 'exact' }) => new FakeBuilder(s, 'delete', undefined, opts?.count ?? null),
    };
  }
  rows(t: string) { return this.store(t).rows; }
}

let failures = 0;
function check(label: string, cond: boolean) {
  console.log(`${cond ? '✓' : '✗'} ${label}`);
  if (!cond) failures++;
}

async function main() {
  const client = new FakeClient();
  const repo = new SupabaseRepository({ supabaseUrl: 'http://fake', supabaseKey: 'fake' }, client as any);
  await repo.initialize();
  check('initialize(): crea riga settings globale', client.rows('app_settings').length === 1 && client.rows('app_settings')[0].id === 'global');

  // Settings
  const s0 = await repo.getSettings();
  check('getSettings(): default applicati', s0.defaultView === 'week' && !!s0.calendarFilters);
  await repo.updateSettings({ defaultView: 'month', calendarFilters: { showEvents: false } as any });
  const s1 = await repo.getSettings();
  check('updateSettings(): merge + persistenza', s1.defaultView === 'month' && (s1.calendarFilters as any).showEvents === false);
  check('updateSettings(): i default non toccati restano', (s1.calendarFilters as any).showTasks === true);
  check('settings: una sola riga', client.rows('app_settings').length === 1);
  check('settings: salvato come {id,data}', Object.keys(client.rows('app_settings')[0]).length === 2);

  // Items
  const item: any = { id: 'i-1', type: 'event', title: 'A', date: '2030-01-01', allDay: true, category: 'general', visibility: 'default', recurrence: 'none', reminderMinutes: 1440, source: 'local', createdAt: 'now' };
  await repo.createItem(item);
  check('createItem(): riga {id,data} completa', client.rows('calendar_items')[0].id === 'i-1' && client.rows('calendar_items')[0].data.title === 'A');
  check('getItem(): round-trip', (await repo.getItem('i-1'))?.title === 'A');
  check('listItems(): 1 elemento', (await repo.listItems()).length === 1);
  const up = await repo.updateItem('i-1', { title: 'B' });
  check('updateItem(): merge preserva i campi non passati', up?.title === 'B' && up?.date === '2030-01-01');
  check('updateItem(): id inesistente -> null', (await repo.updateItem('nope', { title: 'x' })) === null);
  check('getItem(): id inesistente -> null', (await repo.getItem('nope')) === null);
  check('deleteItem(): true', (await repo.deleteItem('i-1')) === true);
  check('deleteItem(): secondo delete -> false', (await repo.deleteItem('i-1')) === false);
  check('listItems(): vuoto dopo delete', (await repo.listItems()).length === 0);

  // Conversations
  await repo.createConversation({ id: 'c-1', title: 'T', createdAt: 'x', updatedAt: 'x', messages: [{ id: 'm', conversationId: 'c-1', role: 'user', content: 'ciao', timestamp: 'x' }] });
  check('conversations: messaggi annidati salvati', (await repo.getConversation('c-1'))?.messages.length === 1);
  const cu = await repo.updateConversation('c-1', { title: 'T2' });
  check('updateConversation(): merge', cu?.title === 'T2' && cu?.messages.length === 1);
  check('getConversation(): inesistente -> null', (await repo.getConversation('zz')) === null);

  // Pending actions
  await repo.createPendingAction({ id: 'a-1', conversationId: 'c-1', toolName: 'tasks_create', toolInput: { title: 'X' }, description: 'd', createdAt: 'x', expiresAt: 'y', status: 'pending' });
  check('createPendingAction()/listPendingActions()', (await repo.listPendingActions()).length === 1);
  const au = await repo.updatePendingAction('a-1', { status: 'approved' });
  check('updatePendingAction(): cambia solo lo stato', au?.status === 'approved' && au?.toolName === 'tasks_create');
  check('getPendingAction(): inesistente -> null', (await repo.getPendingAction('zz')) === null);

  // Export / Import
  const dump = await repo.exportData();
  check('exportData(): items + conversations + settings + exportedAt', Array.isArray(dump.items) && Array.isArray(dump.conversations) && !!dump.settings && !!dump.exportedAt);
  await repo.importData({ items: [{ ...item, id: 'i-2', title: 'Import' }] }, true);
  check('importData(merge): aggiunge', (await repo.listItems()).some((i) => i.id === 'i-2'));
  await repo.importData({ items: [{ ...item, id: 'i-2', title: 'Import' }] }, true);
  check('importData(merge): non duplica', (await repo.listItems()).length === 1);
  await repo.importData({ items: [{ ...item, id: 'i-9', title: 'Sostituzione' }] }, false);
  const after = await repo.listItems();
  check('importData(!merge): sostituisce tutto', after.length === 1 && after[0].id === 'i-9');

  // Solo le 4 tabelle dello schema sono state toccate (nessun nome sbagliato)
  const usedTables = [...client.tables.keys()].filter((t) => client.rows(t).length >= 0).sort().join(',');
  check('usa solo le 4 tabelle dello schema', usedTables === 'app_settings,calendar_items,conversations,pending_actions');

  // Errori propagati con contesto
  const failing = { then: (onF: any) => Promise.resolve({ data: null, error: { message: 'boom' } }).then(onF) };
  const badRepo = new SupabaseRepository(
    { supabaseUrl: 'http://x', supabaseKey: 'x' },
    { from: () => ({ select: () => failing }) } as any
  );
  let err = '';
  try { await badRepo.listItems(); } catch (e: any) { err = String(e?.message || e); }
  check('errori riportati con contesto ("Supabase listItems")', err.includes('Supabase listItems') && err.includes('boom'));

  console.log(failures === 0 ? '\n✅ SupabaseRepository: tutti i controlli superati (offline).' : `\n✗ ${failures} controllo/i fallito/i.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error('✗ Errore inatteso:', e); process.exit(1); });
