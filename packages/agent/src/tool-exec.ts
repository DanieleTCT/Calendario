import type { ToolResult, ToolContext } from './tools';
import { CALENDAR_TOOLS } from './tools';
import { v4 as uuid } from 'uuid';

export async function executeTool(name: string, input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const repo = ctx.repository;
  const def = (CALENDAR_TOOLS as Record<string, any>)[name];
  if (!def) return { success: false, message: `Tool sconosciuto: ${name}` };
  if (!def.modifying) {
    try {
      const data = await runReadOnlyTool(name, input, repo);
      return { success: true, data };
    } catch (e: any) { return { success: false, message: String(e?.message || e) }; }
  }
  const action = {
    id: uuid(), conversationId: ctx.conversationId, toolName: name, toolInput: input,
    description: describeAction(name, input),
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
    status: 'pending' as const,
  };
  await repo.createPendingAction(action);
  return { success: true, message: `Azione in attesa di approvazione: ${action.description}`, pendingActionId: action.id, data: { pendingActionId: action.id } };
}

export function describeAction(name: string, input: Record<string, unknown>): string {
  const g = (k: string) => (input[k] !== undefined ? String(input[k]) : '');
  if (name === 'calendar_create_item') return `Crea ${g('type') || 'evento'} "${g('title')}" il ${g('date')}${g('startTime') ? ' alle ' + g('startTime') : ''}`;
  if (name === 'calendar_update_item') return `Modifica elemento ${g('id')}`;
  if (name === 'calendar_delete_item') return `Elimina elemento ${g('id')}`;
  if (name === 'tasks_create') return `Crea task "${g('title')}" scadenza ${g('date')}`;
  if (name === 'tasks_complete') return `Segna task ${g('id')} come ${input.completed ? 'completato' : 'da fare'}`;
  return `${name} ${JSON.stringify(input).slice(0, 120)}`;
}

export async function runReadOnlyTool(name: string, input: Record<string, unknown>, repo: any): Promise<unknown> {
  const items = await repo.listItems();
  if (name === 'calendar_query_range') {
    const start = String(input.startDate || '0000-00-00');
    const end = String(input.endDate || '9999-99-99');
    const type = String(input.type || 'all');
    return items.filter((i: any) => i.date >= start && i.date <= end && (type === 'all' || i.type === type))
      .sort((a: any, b: any) => `${a.date}${a.startTime || ''}`.localeCompare(`${b.date}${b.startTime || ''}`))
      .map((i: any) => ({ id: i.id, type: i.type, title: i.title, date: i.date, startTime: i.startTime, endTime: i.endTime, category: i.category, completed: i.completed }));
  }
  if (name === 'calendar_search') {
    const q = String(input.query || '').toLowerCase();
    const limit = Number(input.limit || 10);
    return items.filter((i: any) => `${i.title} ${i.description || ''} ${i.category || ''}`.toLowerCase().includes(q))
      .slice(0, limit).map((i: any) => ({ id: i.id, type: i.type, title: i.title, date: i.date, startTime: i.startTime, completed: i.completed }));
  }
  if (name === 'calendar_find_free_slots') {
    const date = String(input.date);
    const sh = Number(input.startHour ?? 8);
    const eh = Number(input.endHour ?? 20);
    const dur = Number(input.slotDurationMinutes ?? 30);
    const toMin = (t?: string) => { const [h, m] = String(t || '0:0').split(':').map(Number); return h * 60 + (m || 0); };
    const busy = items.filter((i: any) => i.date === date && i.startTime)
      .map((i: any) => [toMin(i.startTime), toMin(i.endTime || i.startTime)] as [number, number]).sort((a: [number, number], b: [number, number]) => a[0] - b[0]);
    const free: string[] = [];
    for (let m = sh * 60; m + dur <= eh * 60; m += dur) {
      if (!busy.some(([a, b]: [number, number]) => m < b && m + dur > a)) {
        free.push(`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);
      }
    }
    return { date, freeSlots: free };
  }
  if (name === 'tasks_list') {
    const status = String(input.status || 'all');
    const limit = Number(input.limit || 20);
    const today = new Date().toISOString().slice(0, 10);
    const tasks = items.filter((i: any) => i.type === 'task');
    return tasks.filter((t: any) => status === 'all' ? true : status === 'open' ? !t.completed : status === 'completed' ? !!t.completed : !t.completed && t.date < today)
      .slice(0, limit).map((t: any) => ({ id: t.id, title: t.title, date: t.date, completed: !!t.completed, category: t.category }));
  }
  if (name === 'memory_get') return { key: String(input.key), value: null };
  if (name === 'ask_user') return { question: String(input.question) };
  throw new Error(`Tool read-only non implementato: ${name}`);
}

export async function applyApprovedAction(action: { toolName: string; toolInput: Record<string, unknown> }, repo: any): Promise<unknown> {
  const { toolName: name, toolInput: input } = action;
  if (name === 'calendar_create_item' || name === 'tasks_create') {
    const item = {
      id: uuid(), type: (((input.type as any) || 'task') as any), title: String(input.title),
      description: input.description ? String(input.description) : undefined, date: String(input.date),
      startTime: input.startTime ? String(input.startTime) : undefined, endTime: input.endTime ? String(input.endTime) : undefined,
      allDay: !!input.allDay, category: String(input.category || 'general'), visibility: 'default' as const,
      recurrence: ((((input.recurrence as any) || 'none')) as any),
      completed: ((((input.type as any) || 'task') === 'task' ? false : undefined)),
      reminderMinutes: Number(input.reminderMinutes ?? 1440), source: 'agent' as const, createdAt: new Date().toISOString(),
    };
    return repo.createItem(item);
  }
  if (name === 'calendar_update_item') { const { id, ...patch } = input as any; return repo.updateItem(String(id), patch); }
  if (name === 'tasks_complete') return repo.updateItem(String(input.id), { completed: !!input.completed });
  if (name === 'calendar_delete_item') return { deleted: await repo.deleteItem(String(input.id)) };
  if (name === 'memory_set') return { stored: true };
  throw new Error(`Applicazione non supportata per: ${name}`);
}

