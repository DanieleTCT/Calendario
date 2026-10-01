import type { CalendarItem, Conversation, PendingAction, UserSettings } from '@calendario/domain';
import type { Repository } from './index';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// SupabaseRepository — tabelle JSONB (vedi supabase/schema.sql):
// calendar_items, conversations, pending_actions, app_settings(id='global').
// RLS: backend con SERVICE_ROLE (bypassa RLS). MAI esporre la key al browser.

export interface SupabaseRepositoryConfig {
  supabaseUrl: string;
  supabaseKey: string;
}

const DEFAULT_SETTINGS: UserSettings = {
  theme: 'auto', defaultView: 'week', notificationsEnabled: true, aiProvider: 'demo',
  layoutMode: 'card', sidebarWidth: 280, calendarSlotHeight: 48, daySlotHeight: 60,
  monthCellMinHeight: 120, contentMaxWidth: null, cardWidthPercent: 90,
  cardHeightPercent: 85, cardMaxWidth: 1200, autoFit: true,
  calendarFilters: { showEvents: true, showTasks: true, showCompletedTasks: true, showAllDay: true, showPolito: true, hiddenCourses: [], visibilityFilter: 'all' },
};

function mergeSettings(saved: Partial<UserSettings> | null): UserSettings {
  const base = { ...DEFAULT_SETTINGS, ...(saved || {}) } as UserSettings;
  base.calendarFilters = { ...(DEFAULT_SETTINGS.calendarFilters as object), ...((saved as any)?.calendarFilters || {}) } as any;
  return base;
}

export class SupabaseRepository implements Repository {
  private client: SupabaseClient;
  /** `client` opzionale: usato solo dai test offline (mock della client supabase-js). */
  constructor(config: SupabaseRepositoryConfig, client?: SupabaseClient) {
    if (client) {
      this.client = client;
      return;
    }
    if (!config.supabaseUrl) throw new Error('SUPABASE_URL mancante');
    if (!config.supabaseKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY mancante');
    this.client = createClient(config.supabaseUrl, config.supabaseKey, { auth: { persistSession: false, autoRefreshToken: false } });
  }
  async initialize(): Promise<void> {
    const { error } = await this.client.from('app_settings').select('id').eq('id', 'global').limit(1);
    if (error) throw new Error(`Supabase: schema mancante o non raggiungibile (${error.message}). Esegui supabase/schema.sql nel SQL Editor.`);
    await this.getSettings();
  }
  async listItems(): Promise<CalendarItem[]> {
    const { data, error } = await this.client.from('calendar_items').select('data');
    if (error) throw new Error(`Supabase listItems: ${error.message}`);
    return (data || []).map((r: any) => r.data as CalendarItem);
  }
  async getItem(id: string): Promise<CalendarItem | null> {
    const { data, error } = await this.client.from('calendar_items').select('data').eq('id', id).maybeSingle();
    if (error) throw new Error(`Supabase getItem: ${error.message}`);
    return (data?.data as CalendarItem) || null;
  }
  async createItem(item: CalendarItem): Promise<CalendarItem> {
    const { error } = await this.client.from('calendar_items').insert({ id: item.id, data: item });
    if (error) throw new Error(`Supabase createItem: ${error.message}`);
    return { ...item };
  }
  async updateItem(id: string, patch: Partial<CalendarItem>): Promise<CalendarItem | null> {
    const current = await this.getItem(id);
    if (!current) return null;
    const updated = { ...current, ...patch, id };
    const { error } = await this.client.from('calendar_items').update({ data: updated }).eq('id', id);
    if (error) throw new Error(`Supabase updateItem: ${error.message}`);
    return { ...updated };
  }
  async deleteItem(id: string): Promise<boolean> {
    const { error, count } = await this.client.from('calendar_items').delete({ count: 'exact' }).eq('id', id);
    if (error) throw new Error(`Supabase deleteItem: ${error.message}`);
    return (count || 0) > 0;
  }
  async listConversations(): Promise<Conversation[]> {
    const { data, error } = await this.client.from('conversations').select('data');
    if (error) throw new Error(`Supabase listConversations: ${error.message}`);
    return (data || []).map((r: any) => r.data as Conversation);
  }
  async getConversation(id: string): Promise<Conversation | null> {
    const { data, error } = await this.client.from('conversations').select('data').eq('id', id).maybeSingle();
    if (error) throw new Error(`Supabase getConversation: ${error.message}`);
    return (data?.data as Conversation) || null;
  }
  async createConversation(c: Conversation): Promise<Conversation> {
    const { error } = await this.client.from('conversations').insert({ id: c.id, data: c });
    if (error) throw new Error(`Supabase createConversation: ${error.message}`);
    return { ...c };
  }
  async updateConversation(id: string, patch: Partial<Conversation>): Promise<Conversation | null> {
    const cur = await this.getConversation(id);
    if (!cur) return null;
    const updated = { ...cur, ...patch, id };
    const { error } = await this.client.from('conversations').update({ data: updated }).eq('id', id);
    if (error) throw new Error(`Supabase updateConversation: ${error.message}`);
    return { ...updated };
  }
  async listPendingActions(): Promise<PendingAction[]> {
    const { data, error } = await this.client.from('pending_actions').select('data');
    if (error) throw new Error(`Supabase listPendingActions: ${error.message}`);
    return (data || []).map((r: any) => r.data as PendingAction);
  }
  async getPendingAction(id: string): Promise<PendingAction | null> {
    const { data, error } = await this.client.from('pending_actions').select('data').eq('id', id).maybeSingle();
    if (error) throw new Error(`Supabase getPendingAction: ${error.message}`);
    return (data?.data as PendingAction) || null;
  }
  async createPendingAction(a: PendingAction): Promise<PendingAction> {
    const { error } = await this.client.from('pending_actions').insert({ id: a.id, data: a });
    if (error) throw new Error(`Supabase createPendingAction: ${error.message}`);
    return { ...a };
  }
  async updatePendingAction(id: string, patch: Partial<PendingAction>): Promise<PendingAction | null> {
    const cur = await this.getPendingAction(id);
    if (!cur) return null;
    const updated = { ...cur, ...patch, id };
    const { error } = await this.client.from('pending_actions').update({ data: updated }).eq('id', id);
    if (error) throw new Error(`Supabase updatePendingAction: ${error.message}`);
    return { ...updated };
  }
  async getSettings(): Promise<UserSettings> {
    const { data, error } = await this.client.from('app_settings').select('data').eq('id', 'global').maybeSingle();
    if (error) throw new Error(`Supabase getSettings: ${error.message}`);
    if (!data) {
      // Prima inizializzazione: crea la riga globale. Se due istanze serverless
      // la creano insieme, la violazione di chiave primaria la gestiamo rileggendo.
      const { error: insErr } = await this.client.from('app_settings').insert({ id: 'global', data: DEFAULT_SETTINGS });
      if (insErr) {
        const reread = await this.client.from('app_settings').select('data').eq('id', 'global').maybeSingle();
        if (reread.data) return mergeSettings(reread.data.data as Partial<UserSettings>);
        throw new Error(`Supabase init settings: ${insErr.message}`);
      }
      return { ...DEFAULT_SETTINGS };
    }
    return mergeSettings(data.data as Partial<UserSettings>);
  }
  async updateSettings(s: Partial<UserSettings>): Promise<UserSettings> {
    // Sempre merge sullo stato corrente del DB (nessuna cache: multi-istanza serverless).
    const next = mergeSettings({ ...(await this.getSettings()), ...s } as UserSettings);
    const { error } = await this.client.from('app_settings').upsert({ id: 'global', data: next });
    if (error) throw new Error(`Supabase updateSettings: ${error.message}`);
    return { ...next };
  }
  async exportData() {
    return { items: await this.listItems(), conversations: await this.listConversations(), settings: await this.getSettings(), exportedAt: new Date().toISOString() };
  }
  async importData(d: { items?: CalendarItem[]; conversations?: Conversation[]; settings?: Partial<UserSettings> }, merge = true): Promise<void> {
    if (!merge) {
      if (d.items) { await this.client.from('calendar_items').delete().neq('id', '__none__'); for (const i of d.items) await this.createItem(i); }
      if (d.conversations) { await this.client.from('conversations').delete().neq('id', '__none__'); for (const c of d.conversations) await this.createConversation(c); }
      if (d.settings) await this.updateSettings(d.settings);
      return;
    }
    if (d.items) { const ex = new Set((await this.listItems()).map((i) => i.id)); for (const i of d.items) if (!ex.has(i.id)) await this.createItem(i); }
    if (d.conversations) { const ex = new Set((await this.listConversations()).map((c) => c.id)); for (const c of d.conversations) if (!ex.has(c.id)) await this.createConversation(c); }
    if (d.settings) await this.updateSettings(d.settings);
  }
}
