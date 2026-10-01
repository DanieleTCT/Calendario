import { Router, Request, Response } from 'express';

export const settingsRoutes = Router();

/** Rimuove i segreti PoliTO (password/token) dalla risposta. */
function sanitizePolito(polito: any) {
  if (!polito) return polito;
  const { password, token, ...rest } = polito;
  return { ...rest, passwordSet: !!password, tokenSet: !!token };
}

function sanitizeSettings(settings: any) {
  return {
    ...settings,
    polito: sanitizePolito(settings.polito),
    cloudProviders: settings.cloudProviders
      ? Object.fromEntries(
          Object.entries(settings.cloudProviders).map(([key, config]: [string, any]) => [
            key,
            {
              enabled: config.enabled,
              configured: !!config.apiKey,
            },
          ])
        )
      : {},
  };
}

settingsRoutes.get('/', async (req: Request, res: Response) => {
  try {
    const repository = req.appContext!.repository;
    const settings = await repository.getSettings();

    // Don't expose API keys in the response, but indicate if they're configured
    res.json(sanitizeSettings(settings));
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

settingsRoutes.put('/', async (req: Request, res: Response) => {
  try {
    const repository = req.appContext!.repository;
    const updates = req.body;

    // Validate basic settings
    if (updates.theme && !['light', 'dark', 'auto'].includes(updates.theme)) {
      return res.status(400).json({ error: 'Invalid theme' });
    }

    if (
      updates.defaultView &&
      !['month', 'week', 'day', 'list'].includes(updates.defaultView)
    ) {
      return res.status(400).json({ error: 'Invalid default view' });
    }

    // Il frontend non riceve mai password/token PoliTO: se mancanti, conserva quelli salvati
    if (updates.polito) {
      const current = (await repository.getSettings()).polito;
      updates.polito = { ...current, ...updates.polito };
      if (!updates.polito.password) updates.polito.password = current?.password;
      if (!updates.polito.token) updates.polito.token = current?.token;
      if (!updates.polito.clientId) updates.polito.clientId = current?.clientId;
    }

    const updated = await repository.updateSettings(updates);

    // Hot-reload providers so new API keys work WITHOUT restarting the API
    try { await req.appContext!.refreshProviders(); } catch (e) { console.warn('refreshProviders failed', e); }

    res.json(sanitizeSettings(updated));
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});
