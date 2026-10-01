import { CalendarItem, RecurrenceType } from './index';

/**
 * Calcola tutte le occorrenze di un evento ricorrente entro un intervallo
 */
export function expandRecurrence(
  item: CalendarItem,
  startDate: string, // YYYY-MM-DD
  endDate: string    // YYYY-MM-DD
): CalendarItem[] {
  if (item.recurrence === 'none') {
    const itemDate = item.date;
    if (itemDate >= startDate && itemDate <= endDate) {
      return [item];
    }
    return [];
  }

  const results: CalendarItem[] = [];
  let current = new Date(item.date);
  const end = new Date(endDate);
  const recurrenceEnd = item.recurrenceUntil
    ? new Date(item.recurrenceUntil)
    : new Date('2099-12-31');

  while (current <= end && current <= recurrenceEnd) {
    const dateStr = current.toISOString().split('T')[0];
    if (dateStr >= startDate) {
      results.push({
        ...item,
        id: `${item.id}-${dateStr}`,
        date: dateStr,
      });
    }

    // Move to next occurrence
    switch (item.recurrence) {
      case 'daily':
        current.setDate(current.getDate() + 1);
        break;
      case 'weekly':
        current.setDate(current.getDate() + 7);
        break;
      case 'monthly':
        current.setMonth(current.getMonth() + 1);
        break;
    }
  }

  return results;
}

/**
 * Trova intervalli liberi nel calendario in una data
 */
export function findFreeSlots(
  items: CalendarItem[],
  date: string, // YYYY-MM-DD
  startHour: number = 8,
  endHour: number = 20,
  slotDurationMinutes: number = 30
): Array<{ start: string; end: string }> {
  const dayItems = items.filter(
    (item) =>
      item.date === date &&
      item.type === 'event' &&
      !item.allDay &&
      item.startTime &&
      item.endTime
  );

  // Sort by start time
  dayItems.sort((a, b) => {
    if (!a.startTime || !b.startTime) return 0;
    return a.startTime.localeCompare(b.startTime);
  });

  const slots: Array<{ start: string; end: string }> = [];
  let currentHour = startHour;

  for (const item of dayItems) {
    const itemStart = timeToMinutes(item.startTime!);
    const itemEnd = timeToMinutes(item.endTime!);
    let slotStart = currentHour * 60;

    if (slotStart < itemStart) {
      // Add free slot before this item
      let slotEnd = itemStart;
      while (slotStart + slotDurationMinutes <= slotEnd) {
        slots.push({
          start: minutesToTime(slotStart),
          end: minutesToTime(slotStart + slotDurationMinutes),
        });
        slotStart += slotDurationMinutes;
      }
    }

    currentHour = Math.ceil(itemEnd / 60);
  }

  // Add remaining slots until end of day
  const dayEndMinutes = endHour * 60;
  let slotStart = currentHour * 60;
  while (slotStart + slotDurationMinutes <= dayEndMinutes) {
    slots.push({
      start: minutesToTime(slotStart),
      end: minutesToTime(slotStart + slotDurationMinutes),
    });
    slotStart += slotDurationMinutes;
  }

  return slots;
}

function timeToMinutes(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

function minutesToTime(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}

/**
 * Valida una data nel formato YYYY-MM-DD
 */
export function isValidDate(dateStr: string): boolean {
  const regex = /^\d{4}-\d{2}-\d{2}$/;
  if (!regex.test(dateStr)) return false;
  const date = new Date(dateStr);
  return date instanceof Date && !isNaN(date.getTime());
}

/**
 * Valida un orario nel formato HH:mm
 */
export function isValidTime(timeStr: string): boolean {
  const regex = /^\d{2}:\d{2}$/;
  if (!regex.test(timeStr)) return false;
  const [hours, minutes] = timeStr.split(':').map(Number);
  return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59;
}

/**
 * Calcola i giorni rimanenti fino a una scadenza
 */
export function daysUntil(dateStr: string): number {
  const target = new Date(dateStr);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffTime = target.getTime() - today.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  return diffDays;
}

/**
 * Formatta una data nel locale dell'utente
 */
export function formatDate(dateStr: string, locale: string = 'it-IT'): string {
  const date = new Date(dateStr + 'T00:00:00');
  return date.toLocaleDateString(locale, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}
