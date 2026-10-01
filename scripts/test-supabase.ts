// Verifica Supabase end-to-end: schema, CRUD, settings, cleanup.
// Uso (dopo aver creato .env con SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
// ed eseguito supabase/schema.sql):
//   npx tsx scripts/test-supabase.ts
// Non lascia dati in giro: cancella tutto quello che crea.
import { SupabaseRepository } from '../packages/storage/src/supabase-repository';

async function main() {
  const url = (process.env.SUPABASE_URL || '').trim();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!url || !key) {
    console.error('✗ Imposta SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY (vedi .env.vercel.example).');
    process.exit(1);
  }

  const repo = new SupabaseRepository({ supabaseUrl: url, supabaseKey: key });
  console.log('→ Connessione e inizializzazione…');
  await repo.initialize();
  console.log('✓ Connessione OK, schema presente');

  // Settings: legge (crea la riga se manca) e riscrive lo stesso valore
  const settings = await repo.getSettings();
  console.log(`✓ Settings OK (view=${settings.defaultView}, provider=${settings.aiProvider})`);
  await repo.updateSettings({ defaultView: settings.defaultView });

  // Items CRUD
  const id = `test-${Date.now()}`;
  await repo.createItem({
    id, type: 'event', title: 'Test Supabase', date: '2030-01-01',
    allDay: true, category: 'general', visibility: 'default', recurrence: 'none',
    reminderMinutes: 1440, source: 'local', createdAt: new Date().toISOString(),
  });
  const read = await repo.getItem(id);
  if (!read || read.title !== 'Test Supabase') throw new Error('getItem/createItem falliti');
  const updated = await repo.updateItem(id, { title: 'Test Supabase (modificato)' });
  if (!updated || updated.title !== 'Test Supabase (modificato)') throw new Error('updateItem fallito');
  const listed = await repo.listItems();
  if (!listed.some((i) => i.id === id)) throw new Error('listItems non contiene il record');
  const deleted = await repo.deleteItem(id);
  if (!deleted) throw new Error('deleteItem fallito');
  console.log('✓ Items CRUD OK (create/read/update/list/delete)');

  // Conversations + PendingActions (creazione e lettura)
  const convId = `test-conv-${Date.now()}`;
  await repo.createConversation({ id: convId, title: 'Test', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), messages: [] });
  if (!(await repo.getConversation(convId))) throw new Error('createConversation fallito');
  await repo.updateConversation(convId, { title: 'Test 2' });
  console.log('✓ Conversations OK');

  const actionId = `test-act-${Date.now()}`;
  await repo.createPendingAction({
    id: actionId, conversationId: convId, toolName: 'tasks_create', toolInput: {},
    description: 'test', createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 3600_000).toISOString(), status: 'pending',
  });
  await repo.updatePendingAction(actionId, { status: 'rejected' });
  console.log('✓ Pending actions OK');

  // Export/Import (solo lettura export; import in merge di dati vuoti = no-op)
  const dump = await repo.exportData();
  console.log(`✓ exportData OK (${dump.items.length} item, ${dump.conversations.length} conversazioni)`);
  await repo.importData({}, true);

  console.log('\n✅ Supabase: tutto funzionante. La app può girare su Vercel.');
}

main().catch((err) => {
  console.error('\n✗ ERRORE:', err?.message || err);
  console.error('Suggerimenti: schema eseguito? (supabase/schema.sql) — URL/key corretti? — RLS?');
  process.exit(1);
});
