/**
 * Client per l'API ufficiale PoliTO (app.didattica.polito.it/api).
 * Spec: https://github.com/polito/api-spec
 *
 * - POST /auth/login  -> { data: { username, type, clientId, token } }
 * - GET  /lectures    -> { data: Lecture[] } (fromDate/toDate, courseIds[])
 * - Gestione MFA: se il login risponde con una challenge, si recupera con
 *   GET /auth/mfa/challenge e si valida con POST /auth/mfa/validate.
 *
 * NOTA: API non ufficialmente stabile: gli errori vengono propagati con messaggio
 * leggibile, il sync non deve mai crashare l'app.
 */

const BASE = (typeof process !== 'undefined' && process.env?.POLITO_API_BASE) || 'https://app.didattica.polito.it/api';

export interface PolitoLecture {
  id: number;
  startsAt: string; // UTC ISO
  endsAt: string;
  type: string; // "Lezione" | "Esercitazione" | "Lezione / Esercitazione"
  description: string | null;
  courseId: number;
  courseName: string;
  teacherId: number;
  virtualClassrooms: { id: number; title: string }[];
  place: {
    buildingId: string;
    floorId: string;
    roomId: string;
    siteId: string;
    name: string;
  };
}

export interface PolitoIdentity {
  username: string;
  type: string;
  clientId: string;
  token: string;
}

export class PolitoApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly mfaRequired: boolean = false
  ) {
    super(message);
    this.name = 'PolitoApiError';
  }
}

// Identificativi client/device plausibili (spec: Client richiede name + buildNumber + appVersion)
const CLIENT = {
  name: 'Sito Calendario',
  buildNumber: '1060200',
  appVersion: '1.0.0',
};
const DEVICE = {
  name: 'Sito Calendario',
  platform: 'web',
  version: '1.0.0',
  model: 'browser',
  manufacturer: 'custom',
  toothPicCompatible: false,
};

async function postJson(path: string, body: unknown, token?: string): Promise<any> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    throw new PolitoApiError(`Impossibile contattare app.didattica.polito.it: ${String(e)}`);
  }
  const text = await res.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* risposta non JSON */ }
  if (!res.ok) {
    const msg = data?.message || data?.error || `HTTP ${res.status}`;
    // La API risponde 401/403 con hint su MFA quando serve la challenge push
    const mfa = res.status === 401 || res.status === 403
      ? /mfa|challenge|two.?factor/i.test(String(msg))
      : false;
    throw new PolitoApiError(`Login PoliTO fallito: ${msg}`, res.status, mfa);
  }
  return data;
}

async function getJson(path: string, token: string): Promise<any> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch (e) {
    throw new PolitoApiError(`Impossibile contattare app.didattica.polito.it: ${String(e)}`);
  }
  if (res.status === 401 || res.status === 403) {
    throw new PolitoApiError('Token PoliTO non valido o scaduto', res.status);
  }
  const text = await res.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* non JSON */ }
  if (!res.ok) {
    throw new PolitoApiError(
      `API PoliTO ha restituito ${res.status}: ${data?.message || ''}`.trim(),
      res.status
    );
  }
  return data;
}

/** Esegue il login con matricola/password e restituisce l'identity (con token). */
export async function politoLogin(username: string, password: string): Promise<PolitoIdentity> {
  const body = {
    loginType: 'basic',
    username,
    password,
    client: CLIENT,
    device: DEVICE,
    preferences: { language: 'it' },
  };
  const res = await postJson('/auth/login', body);
  const identity = res?.data;
  if (!identity?.token) {
    // Alcuni account hanno MFA attivo: la risposta può contenere una challenge
    if (identity?.challenge || res?.mfaRequired) {
      throw new PolitoApiError(
        'Account PoliTO con MFA/2FA attivo: l\'accesso push non è supportato da questa integrazione. Usa un account senza MFA oppure verifica se il portale offre una password per le applicazioni.',
        401,
        true
      );
    }
    throw new PolitoApiError('Risposta di login PoliTO priva di token');
  }
  return identity as PolitoIdentity;
}

/** Revoca il token (best effort). */
export async function politoLogout(token: string): Promise<void> {
  try {
    await fetch(`${BASE}/auth/logout`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    /* ignorato: il token decade comunque lato server */
  }
}

/**
 * Recupera le lezioni nella finestra [fromDate, toDate] (YYYY-MM-DD).
 * courseIds opzionale per filtrare per corso.
 */
export async function getLectures(
  token: string,
  fromDate: string,
  toDate: string,
  courseIds?: number[]
): Promise<PolitoLecture[]> {
  const params = new URLSearchParams({ fromDate, toDate });
  (courseIds || []).forEach((id) => params.append('courseIds[]', String(id)));
  const res = await getJson(`/lectures?${params.toString()}`, token);
  const list = res?.data;
  if (!Array.isArray(list)) {
    throw new PolitoApiError('Risposta inattesa da /lectures (data non è un array)');
  }
  return list as PolitoLecture[];
}
