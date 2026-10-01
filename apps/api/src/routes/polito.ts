import { Router, Request, Response } from 'express';
import { syncPolito, resolvePolitoSettings } from '../polito/sync';
import { politoLogin, PolitoApiError } from '../polito/client';

export const politoRoutes = Router();

/** GET /api/polito/status — stato integrazione (MAI espone password/token). */
politoRoutes.get('/status', async (req: Request, res: Response) => {
  try {
    const repository = req.appContext!.repository;
    const p = resolvePolitoSettings((await repository.getSettings()).polito);
    const items = (await repository.listItems()).filter((i) => i.source === 'polito');
    const courses = [...new Set(items.map((i) => i.polito?.courseName).filter(Boolean))] as string[];
    res.json({
      enabled: p.enabled,
      configured: !!(p.username && p.password),
      username: p.username || null,
      lastSyncAt: p.lastSyncAt || null,
      lastError: p.lastError || null,
      syncIntervalMin: p.syncIntervalMin,
      windowDays: p.windowDays,
      showInWeek: p.showInWeek,
      showInMonth: p.showInMonth,
      showInDay: p.showInDay,
      colorMap: p.colorMap || {},
      lessonCount: items.length,
      courses,
    });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

/**
 * POST /api/polito/login — salva credenziali e verifica subito con un login reale.
 * body: { username, password }
 */
politoRoutes.post('/login', async (req: Request, res: Response) => {
  try {
    const repository = req.appContext!.repository;
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: 'Username e password obbligatori' });
    }

    const current = resolvePolitoSettings((await repository.getSettings()).polito);
    // Login di prova PRIMA di salvare: se fallisce non persistiamo credenziali errate
    const identity = await politoLogin(username, password);

    const next = {
      ...current,
      enabled: true,
      username,
      password,
      token: identity.token,
      clientId: identity.clientId,
      lastError: '',
    };
    await repository.updateSettings({ polito: next });

    // Sync immediato così le lezioni compaiono subito
    const sync = await syncPolito(repository);
    res.json({ ok: true, sync });
  } catch (error) {
    const msg = error instanceof PolitoApiError ? error.message : String(error);
    const mfaRequired = error instanceof PolitoApiError && error.mfaRequired;
    res.status(400).json({ error: msg, mfaRequired });
  }
});

/** POST /api/polito/logout — rimuove credenziali/token e le lezioni importate. */
politoRoutes.post('/logout', async (req: Request, res: Response) => {
  try {
    const repository = req.appContext!.repository;
    const p = resolvePolitoSettings((await repository.getSettings()).polito);
    await repository.updateSettings({
      polito: { ...p, enabled: false, username: undefined, password: undefined, token: undefined, clientId: undefined, lastError: '' },
    });
    const items = (await repository.listItems()).filter((i) => i.source === 'polito');
    for (const item of items) await repository.deleteItem(item.id);
    res.json({ ok: true, removed: items.length });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

/** POST /api/polito/sync — sync forzato (opzionale { forceLogin: true }). */
politoRoutes.post('/sync', async (req: Request, res: Response) => {
  try {
    const repository = req.appContext!.repository;
    const result = await syncPolito(repository, { forceLogin: !!req.body?.forceLogin });
    res.status(result.ok ? 200 : 400).json(result);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

/** PATCH /api/polito/settings — aggiorna la sotto-config polito (colori, visibilità, intervalli). */
politoRoutes.patch('/settings', async (req: Request, res: Response) => {
  try {
    const repository = req.appContext!.repository;
    const current = resolvePolitoSettings((await repository.getSettings()).polito);
    const allowed = ['enabled', 'syncIntervalMin', 'windowDays', 'colorMap', 'showInWeek', 'showInMonth', 'showInDay'];
    const patch: Record<string, unknown> = {};
    for (const key of allowed) {
      if (key in (req.body || {})) patch[key] = req.body[key];
    }
    const next = { ...current, ...patch };
    await repository.updateSettings({ polito: next });
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});
