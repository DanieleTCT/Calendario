// Entry serverless per Vercel (function `api/index.js`).
// Viene bundlato da scripts/build-api.mjs insieme all'app Express.
// In produzione Vercel imposta VERCEL=1 => server.ts NON fa listen(),
// usa Supabase (niente fs), niente scheduler PoliTO, niente statico.
import { app, initialize } from '../apps/api/src/server';

let ready = null;

export default async function handler(req, res) {
  try {
    if (!ready) ready = initialize();
    await ready;
    return app(req, res);
  } catch (err) {
    console.error('Vercel init failed:', err?.message || err);
    res.statusCode = 500;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ error: String(err?.message || err) }));
  }
}
