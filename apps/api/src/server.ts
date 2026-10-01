import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { createRepository, type Repository } from '@calendario/storage';
import { ProviderChain } from '@calendario/agent';
import { buildProviders } from './providers';
import { itemRoutes } from './routes/items';
import { settingsRoutes } from './routes/settings';
import { aiRoutes } from './routes/ai';
import { dataRoutes } from './routes/data';
import { politoRoutes } from './routes/polito';
import { startPolitoScheduler } from './polito/sync';

export const app = express();
const PORT = Number(process.env.PORT || 3000);
// Su Vercel il filesystem è read-only: niente scheduler, niente statico, Supabase obbligatorio.
export const IS_VERCEL = !!(process.env.VERCEL || process.env.VERCEL_ENV);
// Origini consentite per il frontend (LAN + Tailnet + dominio Vercel). '*' solo in dev.
const ALLOWED_ORIGIN = (process.env.ALLOWED_ORIGIN || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(
  cors({
    origin: ALLOWED_ORIGIN.length > 0 ? ALLOWED_ORIGIN : true,
    credentials: false,
  })
);

// Request context
export interface AppContext {
  repository: Repository;
  providers: ProviderChain;
  refreshProviders: () => Promise<void>;
  /** Quale storage sta usando il server (per /api/health e /api/data/export). */
  storageKind: 'supabase' | 'json';
}

declare global {
  namespace Express {
    interface Request {
      appContext?: AppContext;
    }
  }
}

// Initialize (idempotente: riusata tra invocazioni serverless su Vercel)
let initPromise: Promise<AppContext> | null = null;
export function initialize(): Promise<AppContext> {
  if (!initPromise) initPromise = doInitialize();
  return initPromise;
}
async function doInitialize(): Promise<AppContext> {
  // Factory storage: Supabase se SUPABASE_URL+KEY, altrimenti JSON (NAS/dev).
  // Su Vercel il JSON non persiste: richiedi Supabase con errore chiaro.
  if (IS_VERCEL && !(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)) {
    throw new Error(
      'Su Vercel serve Supabase: imposta SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY nelle Environment Variables (vedi supabase/schema.sql).'
    );
  }
  const repository = await createRepository();
  const storageKind: 'supabase' | 'json' =
    process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY ? 'supabase' : 'json';

  // Build providers from current settings (Gemini first if configured)
  const { providers } = await buildProviders(repository);
  let providerChain = new ProviderChain({ providers });

  async function refreshProviders() {
    const rebuilt = await buildProviders(repository);
    providerChain = new ProviderChain({ providers: rebuilt.providers });
    appContext.providers = providerChain;
  }

  const appContext: AppContext = {
    repository,
    providers: providerChain,
    refreshProviders,
    storageKind,
  };
  // Ritorna il context per riuso serverless (Vercel)
  void appContext;

  // Attach context to all requests
  app.use((req, res, next) => {
    req.appContext = appContext;
    next();
  });

  // Routes
  app.use('/api/items', itemRoutes);
  app.use('/api/settings', settingsRoutes);
  app.use('/api/ai', aiRoutes);
  app.use('/api/polito', politoRoutes);
  app.use('/api/data', dataRoutes);

  // Sync automatico PoliTO solo fuori Vercel (su serverless niente timer:
  // il sync resta manuale via POST /api/polito/sync o via cron esterna)
  if (!IS_VERCEL) {
    startPolitoScheduler(repository as any);
  }

  // Health check
  app.get('/api/health', (req: Request, res: Response) => {
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      storage: storageKind,
    });
  });

  // Servi il frontend buildato (single-container NAS) — saltato su Vercel
  // (su Vercel il frontend è deployato come progetto statico separato)
  if (!IS_VERCEL) {
  try {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(here, '../web-dist'),
    path.resolve(here, '../../web/dist'),
    path.resolve(process.cwd(), '../web/dist'),
  ];
  const webDist = candidates.find((p) => fs.existsSync(path.join(p, 'index.html')));
  if (webDist) {
    app.use(express.static(webDist));
    // SPA fallback: tutto ciò che non è /api/* torna a index.html
    app.get('*', (req: Request, res: Response, next: NextFunction) => {
      if (req.path.startsWith('/api/')) return next();
      res.sendFile(path.join(webDist, 'index.html'));
    });
    console.log(`🖥️  Frontend statico servito da: ${webDist}`);
  } else {
    console.log('ℹ️  web/dist non trovato: servo solo API (modalità dev).');
  }
  } catch { console.log('ℹ️  statico non disponibile (bundle serverless).'); }
  }

  // Error handler
  app.use((err: any, req: Request, res: Response, next: NextFunction) => {
    console.error('Error:', err);
    res.status(err.status || 500).json({
      error: err.message || 'Internal server error',
      timestamp: new Date().toISOString(),
    });
  });

  // 404
  app.use((req: Request, res: Response) => {
    res.status(404).json({
      error: 'Not found',
    });
  });

  return appContext;
}

// Avvio server long-lived (NAS/dev/Docker). Su Vercel questo blocco non gira:
// la function api/index.ts importa { app, initialize } senza listen().
if (!IS_VERCEL || process.env.VERCEL_DEV_LISTEN === '1') {
initialize()
  .then(() => {
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`🚀 Calendar API running on http://0.0.0.0:${PORT}`);
      console.log(`🗄️  Storage: ${process.env.SUPABASE_URL ? 'Supabase' : 'JSON locale'}`);
      if (ALLOWED_ORIGIN.length > 0) console.log(`🔒 CORS consentito per: ${ALLOWED_ORIGIN.join(', ')}`);
    });
  })
  .catch((error) => {
    console.error('Failed to initialize:', error);
    process.exit(1);
  });
}

export default app;
