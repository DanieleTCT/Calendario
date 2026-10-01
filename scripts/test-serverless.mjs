// Test locale del bundle serverless Vercel (api/index.js) SENZA Vercel CLI.
//   npm run test:serverless
// Avvia il handler come server HTTP, verifica le rotte principali, esce con
// codice 0/1. Con KEEP_ALIVE=1 resta in ascolto per prove manuali con curl.
// Usa lo storage indicato dalle env var: Supabase se SUPABASE_URL è impostata,
// altrimenti JSON locale. NB: richiede `node scripts/build-api.mjs` già eseguito.
import { createServer } from 'node:http';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const HTTP_PORT = Number(process.env.TEST_PORT || 4000);
// server.ts non deve fare il proprio listen: usa una porta dedicata.
process.env.PORT = process.env.PORT || '3999';

let handler;
try {
  const mod = require('../api/index.js');
  handler = mod.default || mod;
} catch (err) {
  console.error('✗ Impossibile caricare api/index.js — esegui prima: node scripts/build-api.mjs');
  console.error(String(err));
  process.exit(1);
}

const server = createServer((req, res) => handler(req, res));

server.listen(HTTP_PORT, '127.0.0.1', async () => {
  const base = `http://127.0.0.1:${HTTP_PORT}`;
  console.log(`🧪 Handler serverless attivo su ${base}`);

  if (process.env.KEEP_ALIVE === '1') {
    console.log('   KEEP_ALIVE=1: resta in ascolto (Ctrl+C per uscire).');
    console.log(`   curl -s ${base}/api/health`);
    return;
  }

  let failures = 0;
  const check = (label, ok, extra = '') => {
    console.log(`${ok ? '✓' : '✗'} ${label}${extra ? ` — ${extra}` : ''}`);
    if (!ok) failures++;
  };

  try {
    const health = await fetch(`${base}/api/health`).then((r) => r.json());
    check('GET /api/health risponde', health.status === 'ok');
    check('health.storage coerente con le env', health.storage === (process.env.SUPABASE_URL ? 'supabase' : 'json'), `storage=${health.storage}`);

    const itemsRes = await fetch(`${base}/api/items`);
    const items = await itemsRes.json();
    check('GET /api/items risponde (array)', itemsRes.ok && Array.isArray(items), `${items.length ?? '?'} item`);

    const settingsRes = await fetch(`${base}/api/settings`);
    check('GET /api/settings risponde', settingsRes.ok);

    const exportRes = await fetch(`${base}/api/data/export`);
    const dump = await exportRes.json();
    check('GET /api/data/export risponde', exportRes.ok && Array.isArray(dump.items));
    check('export: nessun segreto (apiKey/password)', !JSON.stringify(dump).includes('apiKey') && !JSON.stringify(dump).includes('"password"'));

    const bad = await fetch(`${base}/api/data/import`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    });
    check('POST /api/data/import valida il body vuoto (400)', bad.status === 400);

    const notFound = await fetch(`${base}/api/inesistente`);
    check('rotta /api sconosciuta → 404 JSON', notFound.status === 404);
  } catch (err) {
    console.error('✗ Errore durante i test:', String(err));
    failures++;
  }

  console.log(failures === 0 ? '\n✅ Bundle serverless: tutti i controlli superati.' : `\n✗ ${failures} controllo/i fallito/i.`);
  server.close(() => process.exit(failures === 0 ? 0 : 1));
});
