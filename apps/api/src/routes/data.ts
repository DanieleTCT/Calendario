import { Router, Request, Response } from 'express';

export const dataRoutes = Router();

/**
 * Rimuove i segreti dai settings prima di esportarli:
 * cloudProviders.*.apiKey e polito.password/token NON escono dal server.
 * (Vanno reinseriti nelle Impostazioni dell'ambiente di destinazione.)
 */
function stripSecrets(settings: any) {
  if (!settings) return settings;
  const clean = { ...settings };
  if (clean.cloudProviders) {
    clean.cloudProviders = Object.fromEntries(
      Object.entries(clean.cloudProviders).map(([k, v]: [string, any]) => [k, { enabled: !!v?.enabled }])
    );
  }
  if (clean.polito) {
    const { password, token, ...rest } = clean.polito;
    clean.polito = rest;
  }
  return clean;
}

/**
 * GET /api/data/export — esporta items + conversazioni + settings (senza segreti).
 * Utile per spostare i dati tra NAS (JSON) e Vercel/Supabase.
 * ?download=1 aggiunge l'header Content-Disposition per scaricare un file .json
 */
dataRoutes.get('/export', async (req: Request, res: Response) => {
  try {
    const repository = req.appContext!.repository;
    const dump = await repository.exportData();
    const body = {
      ...dump,
      settings: stripSecrets(dump.settings),
      storage: req.appContext!.storageKind,
    };
    if (req.query.download) {
      const name = `calendario-backup-${new Date().toISOString().slice(0, 10)}.json`;
      res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    }
    res.json(body);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

/**
 * POST /api/data/import — importa dati esportati da un altro ambiente.
 * body: { items?, conversations?, settings?, merge? } (merge default true).
 * Con merge=false i dati attuali di items/conversazioni vengono SOSTITUITI.
 */
dataRoutes.post('/import', async (req: Request, res: Response) => {
  try {
    const repository = req.appContext!.repository;
    const { items, conversations, settings, merge } = req.body || {};

    if (items !== undefined && !Array.isArray(items)) {
      return res.status(400).json({ error: 'items deve essere un array' });
    }
    if (conversations !== undefined && !Array.isArray(conversations)) {
      return res.status(400).json({ error: 'conversations deve essere un array' });
    }
    if (settings !== undefined && (typeof settings !== 'object' || settings === null || Array.isArray(settings))) {
      return res.status(400).json({ error: 'settings deve essere un oggetto' });
    }
    if (!items && !conversations && !settings) {
      return res.status(400).json({ error: 'Niente da importare: fornisci items, conversations o settings' });
    }

    await repository.importData({ items, conversations, settings }, merge !== false);
    const after = await repository.exportData();
    res.json({
      ok: true,
      merge: merge !== false,
      imported: {
        items: items?.length || 0,
        conversations: conversations?.length || 0,
        settings: !!settings,
      },
      total: { items: after.items.length, conversations: after.conversations.length },
    });
  } catch (error) {
    res.status(400).json({ error: String(error) });
  }
});
