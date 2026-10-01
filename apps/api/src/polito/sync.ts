import { CalendarItem, PolitoSettings, PolitoLessonMeta } from '@calendario/domain';
import type { Repository } from '@calendario/storage';
import { PolitoApiError, PolitoLecture, politoLogin, getLectures, politoLogout } from './client';

export interface SyncResult {
  ok: boolean;
  added: number;
  updated: number;
  removed: number;
  total: number;
  error?: string;
  mfaRequired?: boolean;
}

const DEFAULT_INTERVAL_MIN = 60;
const DEFAULT_WINDOW_DAYS = 28;

function pad(n: number): string {
  return String(n).padStart(2, '0');
}
function ymd(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function hm(d: Date): string {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Categoria locale in base al tipo lezione PoliTO. */
function categoryFor(type: string): string {
  const t = type.toLowerCase();
  if (t.includes('esercitazione') || t.includes('lab')) return 'exercise';
  if (t.includes('esame') || t.includes('appello')) return 'exam';
  return 'lesson';
}

/** Converte una Lecture PoliTO in CalendarItem locale (orari convertiti nel fuso locale). */
function toCalendarItem(lez: PolitoLecture, now: string): CalendarItem {
  const start = new Date(lez.startsAt);
  const end = new Date(lez.endsAt);
  const meta: PolitoLessonMeta = {
    lectureId: lez.id,
    courseId: lez.courseId,
    courseName: lez.courseName,
    lessonType: lez.type,
    teacherId: lez.teacherId,
    room: lez.place?.name,
    buildingId: lez.place?.buildingId,
  };
  const placeParts = [lez.place?.name, lez.place?.buildingId].filter(Boolean);
  const descParts = [
    lez.type,
    lez.description || '',
    (lez.virtualClassrooms || []).map((v) => v.title).join(', '),
  ].filter(Boolean);

  return {
    id: `polito-${lez.id}`,
    type: 'event',
    title: lez.courseName,
    description: descParts.join(' · ') || undefined,
    date: ymd(start),
    startTime: hm(start),
    endTime: hm(end),
    allDay: false,
    category: categoryFor(lez.type),
    visibility: 'default',
    recurrence: 'none',
    reminderMinutes: 15,
    location: placeParts.join(' - ') || undefined,
    createdAt: now,
    source: 'polito',
    polito: meta,
  };
}

/** Risolve la config con i default. */
export function resolvePolitoSettings(p: PolitoSettings | undefined): PolitoSettings {
  return {
    enabled: p?.enabled ?? false,
    username: p?.username,
    password: p?.password,
    token: p?.token,
    clientId: p?.clientId,
    lastSyncAt: p?.lastSyncAt,
    lastError: p?.lastError,
    syncIntervalMin: p?.syncIntervalMin ?? DEFAULT_INTERVAL_MIN,
    windowDays: p?.windowDays ?? DEFAULT_WINDOW_DAYS,
    colorMap: p?.colorMap ?? {},
    showInWeek: p?.showInWeek ?? true,
    showInMonth: p?.showInMonth ?? true,
    showInDay: p?.showInDay ?? true,
  };
}

/** Login (o riuso token) e persistenza di token/clientId in settings.polito. */
async function ensureToken(repository: Repository): Promise<{ token: string; settings: PolitoSettings }> {
  const settings = resolvePolitoSettings((await repository.getSettings()).polito);
  if (!settings.username || !settings.password) {
    throw new PolitoApiError('Credenziali PoliTO mancanti: configura username e password in Impostazioni.');
  }
  if (settings.token) return { token: settings.token, settings };

  const identity = await politoLogin(settings.username, settings.password);
  settings.token = identity.token;
  settings.clientId = identity.clientId;
  settings.lastError = '';
  await repository.updateSettings({ polito: settings });
  return { token: identity.token, settings };
}

/**
 * Sync completo: login se necessario, fetch lezioni, upsert + riconciliazione.
 * - Upsert con id deterministico `polito-<lectureId>` (niente duplicati).
 * - Vengono eliminati i item polito fuori dalla finestra o rimossi dall'API.
 * - Su 401 (token scaduto) riprova una volta con login fresco.
 */
export async function syncPolito(
  repository: Repository,
  opts: { forceLogin?: boolean } = {}
): Promise<SyncResult> {
  let settings = resolvePolitoSettings((await repository.getSettings()).polito);
  if (!settings.enabled) {
    return { ok: false, added: 0, updated: 0, removed: 0, total: 0, error: 'Integrazione PoliTO disabilitata' };
  }

  try {
    if (opts.forceLogin && settings.token) {
      await politoLogout(settings.token);
      settings.token = undefined;
      await repository.updateSettings({ polito: settings });
    }

    let token: string;
    try {
      ({ token, settings } = await ensureToken(repository));
    } catch (e) {
      if (e instanceof PolitoApiError && e.status === 401 && settings.token) {
        settings.token = undefined;
        await repository.updateSettings({ polito: settings });
        ({ token, settings } = await ensureToken(repository));
      } else {
        throw e;
      }
    }

    const today = new Date();
    const from = new Date(today);
    from.setDate(from.getDate() - 7); // copri anche le lezioni passate recenti
    const to = new Date(today);
    to.setDate(to.getDate() + (settings.windowDays ?? DEFAULT_WINDOW_DAYS));

    let lectures: PolitoLecture[];
    try {
      lectures = await getLectures(token, ymd(from), ymd(to));
    } catch (e) {
      if (e instanceof PolitoApiError && e.status === 401 && settings.password) {
        settings.token = undefined;
        await repository.updateSettings({ polito: settings });
        ({ token, settings } = await ensureToken(repository));
        lectures = await getLectures(token, ymd(from), ymd(to));
      } else {
        throw e;
      }
    }

    const now = new Date().toISOString();
    const existing = (await repository.listItems()).filter((i) => i.source === 'polito');
    const wantedIds = new Set<string>();

    let added = 0;
    let updated = 0;
    let removed = 0;

    for (const lez of lectures) {
      const item = toCalendarItem(lez, now);
      wantedIds.add(item.id);
      const prev = existing.find((i) => i.id === item.id);
      if (!prev) {
        await repository.createItem(item);
        added++;
      } else {
        const changed =
          prev.date !== item.date ||
          prev.startTime !== item.startTime ||
          prev.endTime !== item.endTime ||
          prev.title !== item.title ||
          prev.location !== item.location ||
          prev.description !== item.description ||
          prev.category !== item.category;
        if (changed) {
          await repository.updateItem(item.id, { ...item, createdAt: prev.createdAt, updatedAt: now });
          updated++;
        }
      }
    }

    // Riconciliazione: elimina item polito non più presenti (fuori finestra o cancellati)
    for (const item of existing) {
      if (!wantedIds.has(item.id)) {
        await repository.deleteItem(item.id);
        removed++;
      }
    }

    settings.lastSyncAt = new Date().toISOString();
    settings.lastError = '';
    await repository.updateSettings({ polito: settings });

    const total = (await repository.listItems()).filter((i) => i.source === 'polito').length;
    return { ok: true, added, updated, removed, total };
  } catch (e) {
    const msg = e instanceof PolitoApiError ? e.message : String(e);
    const mfaRequired = e instanceof PolitoApiError && e.mfaRequired;
    try {
      settings.lastError = msg;
      await repository.updateSettings({ polito: settings });
    } catch { /* non bloccare */ }
    return { ok: false, added: 0, updated: 0, removed: 0, total: 0, error: msg, mfaRequired };
  }
}

/**
 * Avvia il sync automatico a intervalli. Ritorna una funzione di stop.
 */
export function startPolitoScheduler(repository: Repository): () => void {
  let timer: NodeJS.Timeout | null = null;
  let running = false;

  async function scheduleNext() {
    const settings = resolvePolitoSettings((await repository.getSettings()).polito);
    const ms = Math.max(5, settings.syncIntervalMin ?? DEFAULT_INTERVAL_MIN) * 60_000;
    timer = setTimeout(run, ms);
  }

  async function run() {
    if (running) return scheduleNext();
    running = true;
    try {
      const settings = resolvePolitoSettings((await repository.getSettings()).polito);
      if (settings.enabled && settings.username && settings.password) {
        const res = await syncPolito(repository);
        if (!res.ok) console.warn('⚠️  Sync PoliTO:', res.error);
      }
    } catch (e) {
      console.warn('⚠️  Sync PoliTO (errore timer):', e);
    } finally {
      running = false;
      await scheduleNext();
    }
  }

  // Primo sync ritardato di 20s (lascia partire il server) e poi a intervalli
  const boot = setTimeout(run, 20_000);

  return () => {
    clearTimeout(boot);
    if (timer) clearTimeout(timer);
  };
}

