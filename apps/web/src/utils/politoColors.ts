// Colori e legenda per le lezioni PoliTO.
// Colore stabile per corso (hash del courseName su palette curata) + override manuale.

export const POLITO_PALETTE = [
  '#4f46e5', '#0891b2', '#059669', '#db2777', '#ea580c',
  '#7c3aed', '#b45309', '#0369a1', '#be123c', '#4d7c0f',
  '#9333ea', '#c2410c', '#0f766e', '#1d4ed8', '#a21caf',
];

export function isPolito(item: any): boolean {
  return item?.source === 'polito';
}

/** Hash semplice e stabile (djb2) per derivare un colore dal nome del corso. */
function hash(str: string): number {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
  return h;
}

/**
 * Colore di un corso: prima l'eventuale override manuale (colorMap),
 * poi hash stabile su palette.
 */
export function courseColor(courseName: string, colorMap?: Record<string, string>): string {
  if (colorMap && colorMap[courseName]) return colorMap[courseName];
  return POLITO_PALETTE[hash(courseName) % POLITO_PALETTE.length];
}

/** Gradiente "pieno" per le lezioni. */
export function courseGradient(courseName: string, colorMap?: Record<string, string>): string {
  const c = courseColor(courseName, colorMap);
  return `linear-gradient(135deg, ${c}, ${shade(c, 28)})`;
}

/** Mescola verso il bianco preservando la tonalità (shade() slavizzerebbe i colori già chiari). */
function mixWhite(hex: string, amount: number): string {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!m) return hex;
  const ch = (v: number) => Math.max(0, Math.min(255, Math.round(v * (1 - amount) + 255 * amount)));
  const toHex = (v: number) => v.toString(16).padStart(2, '0');
  return `#${toHex(ch(parseInt(m[1], 16)))}${toHex(ch(parseInt(m[2], 16)))}${toHex(ch(parseInt(m[3], 16)))}`;
}

/** Variante più chiara per le esercitazioni (distinguo lezione/esercitazione), mantenendo la tinta del corso. */
export function courseSoftGradient(courseName: string, colorMap?: Record<string, string>): string {
  const c = courseColor(courseName, colorMap);
  return `linear-gradient(135deg, ${mixWhite(c, 0.45)}, ${mixWhite(c, 0.28)})`;
}

/** Colora in chiaro/scuro una hex (#rrggbb), amount > 0 schiarisce, < 0 scurisce. */
function shade(hex: string, amount: number): string {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!m) return hex;
  const ch = (v: number) => Math.max(0, Math.min(255, Math.round(v + (amount / 100) * 255)));
  const toHex = (v: number) => v.toString(16).padStart(2, '0');
  return `#${toHex(ch(parseInt(m[1], 16)))}${toHex(ch(parseInt(m[2], 16)))}${toHex(ch(parseInt(m[3], 16)))}`;
}

/** Sfondo per un item PoliTO (lezione piena, esercitazione chiara). */
export function politoBackground(item: any, colorMap?: Record<string, string>): string {
  const course = item?.polito?.courseName || item?.title || 'PoliTO';
  const isExercise = item?.category === 'exercise';
  return isExercise ? courseSoftGradient(course, colorMap) : courseGradient(course, colorMap);
}

/** Colore piatto (dot nella vista mese / legenda). */
export function politoDotColor(item: any, colorMap?: Record<string, string>): string {
  const course = item?.polito?.courseName || item?.title || 'PoliTO';
  return courseColor(course, colorMap);
}

export interface LegendCourse {
  name: string;
  color: string;
  count: number;
}

/** Estrae i corsi (con conteggio) da una lista di item per costruire la legenda. */
export function legendCourses(items: any[], colorMap?: Record<string, string>): LegendCourse[] {
  const map = new Map<string, LegendCourse>();
  for (const it of items) {
    if (!isPolito(it)) continue;
    const name = it.polito?.courseName || it.title;
    const color = courseColor(name, colorMap);
    const found = map.get(name);
    if (found) found.count++;
    else map.set(name, { name, color, count: 1 });
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, 'it'));
}
