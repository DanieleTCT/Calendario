// Colori degli eventi personali (per categoria) e utilità per il colore del testo.
// I colori delle lezioni PoliTO restano in politoColors.ts (per corso).

export type EventTextMode = 'auto' | 'light' | 'dark';

/** Colori base per categoria (hex). Gradiente derivato automaticamente. */
export const DEFAULT_CATEGORY_COLORS: Record<string, string> = {
  work: '#4f46e5',
  meeting: '#0891b2',
  personal: '#059669',
  birthday: '#db2777',
  holiday: '#ea580c',
  general: '#64748b',
};

/** Etichette leggibili delle categorie (anche quelle PoliTO usate dai filtri). */
export const CATEGORY_LABELS: Record<string, string> = {
  work: 'Lavoro',
  meeting: 'Riunione',
  personal: 'Personale',
  birthday: 'Compleanno',
  holiday: 'Vacanza',
  general: 'Generale',
  lesson: 'Lezione (PoliTO)',
  exercise: 'Esercitazione (PoliTO)',
  exam: 'Esame (PoliTO)',
};

/** Categorie modificabili dall'utente (gli eventi personali). */
export const EDITABLE_CATEGORIES = ['work', 'meeting', 'personal', 'birthday', 'holiday', 'general'];

/** Schiarisce (amount > 0) o scurisce (amount < 0) una hex #rrggbb. */
export function shade(hex: string, amount: number): string {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!m) return hex;
  const ch = (v: number) => Math.max(0, Math.min(255, Math.round(v + (amount / 100) * 255)));
  const toHex = (v: number) => v.toString(16).padStart(2, '0');
  return `#${toHex(ch(parseInt(m[1], 16)))}${toHex(ch(parseInt(m[2], 16)))}${toHex(ch(parseInt(m[3], 16)))}`;
}

export const DEFAULT_EVENT_OPACITY = 1;

/** Colore dedicato alla scadenza dei task (bordo/forma "scadenza"). */
export const DEFAULT_TASK_DEADLINE_COLOR = '#f59e0b';

/** Normalizza l'opacità eventi in [0.2, 1] (default 1). */
export function clampOpacity(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return DEFAULT_EVENT_OPACITY;
  return Math.min(1, Math.max(0.2, n));
}

/** Aggiunge alfa a una hex #rrggbb -> #rrggbbaa. */
export function hexWithAlpha(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{6}|[0-9a-f]{3})\b/i.exec(hex || '');
  if (!m) return hex;
  let h = m[1];
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const a = Math.round(Math.min(1, Math.max(0, alpha)) * 255).toString(16).padStart(2, '0');
  return `#${h}${a}`;
}

/** Sfondo deadline per i task: tinta chiara + bordo pieno del colore scadenza. */
export function taskDeadlineGradient(deadlineColor?: string): string {
  const base = deadlineColor || DEFAULT_TASK_DEADLINE_COLOR;
  return `linear-gradient(135deg, ${hexWithAlpha(base, 0.28)}, ${hexWithAlpha(base, 0.12)})`;
}
/** Colore base di una categoria: override utente -> default. */
export function categoryBase(category: string, catColors?: Record<string, string>): string {
  if (catColors && catColors[category]) return catColors[category];
  return DEFAULT_CATEGORY_COLORS[category] || DEFAULT_CATEGORY_COLORS.general;
}

/** Sfondo a gradiente per una categoria (usato nelle viste settimana/giorno). */
export function categoryGradient(category: string, catColors?: Record<string, string>): string {
  const base = categoryBase(category, catColors);
  return `linear-gradient(135deg, ${base}, ${shade(base, 28)})`;
}

/** Colore piatto per una categoria (dot vista mese, barra laterale). */
export function categoryDot(category: string, catColors?: Record<string, string>): string {
  return categoryBase(category, catColors);
}

/** Estrae la prima hex (#rgb/#rrggbb) da una stringa (hex, rgb() o gradiente). */
function firstHex(color: string): string | null {
  const m = /#([0-9a-f]{6}|[0-9a-f]{3})\b/i.exec(color || '');
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  return `#${h}`;
}

/**
 * Colore del testo leggibile su uno sfondo.
 * - 'light': bianco forzato, 'dark': nero forzato,
 * - 'auto' (default): contrasto automatico via luminanza YIQ — testo scuro su sfondi chiari,
 *   testo chiaro su sfondi scuri (niente più testo bianco su colori pastello illeggibili).
 */
export function eventTextColor(background: string, mode: EventTextMode = 'auto'): string {
  if (mode === 'light') return '#ffffff';
  if (mode === 'dark') return '#0f172a';
  const hex = firstHex(background);
  if (!hex) return '#ffffff';
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const yiq = (r * 299 + g * 587 + b * 114) / 1000;
  // Soglia 140: leggermente più prudente del 128 per garantire buona leggibilità
  return yiq >= 140 ? '#0f172a' : '#ffffff';
}
