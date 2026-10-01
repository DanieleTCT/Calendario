import {
  CalendarItem,
  Conversation,
  PendingAction,
  UserSettings,
} from '@calendario/domain';

export interface Repository {
  // Calendar items
  listItems(): Promise<CalendarItem[]>;
  createItem(item: CalendarItem): Promise<CalendarItem>;
  updateItem(id: string, patch: Partial<CalendarItem>): Promise<CalendarItem | null>;
  deleteItem(id: string): Promise<boolean>;
  getItem(id: string): Promise<CalendarItem | null>;

  // Conversations
  listConversations(): Promise<Conversation[]>;
  getConversation(id: string): Promise<Conversation | null>;
  createConversation(conversation: Conversation): Promise<Conversation>;
  updateConversation(id: string, patch: Partial<Conversation>): Promise<Conversation | null>;

  // Pending actions
  listPendingActions(): Promise<PendingAction[]>;
  getPendingAction(id: string): Promise<PendingAction | null>;
  createPendingAction(action: PendingAction): Promise<PendingAction>;
  updatePendingAction(id: string, patch: Partial<PendingAction>): Promise<PendingAction | null>;

  // Settings
  getSettings(): Promise<UserSettings>;
  updateSettings(settings: Partial<UserSettings>): Promise<UserSettings>;

  // Export/Import
  exportData(): Promise<{
    items: CalendarItem[];
    conversations: Conversation[];
    settings: UserSettings;
    exportedAt: string;
  }>;
  importData(
    data: {
      items?: CalendarItem[];
      conversations?: Conversation[];
      settings?: Partial<UserSettings>;
    },
    merge?: boolean
  ): Promise<void>;
}

export { JsonRepository } from './json-repository';
export type { RepositoryConfig } from './json-repository';
export { SupabaseRepository } from './supabase-repository';
export type { SupabaseRepositoryConfig } from './supabase-repository';

// Factory: Supabase se SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY sono impostate,
// altrimenti JSON locale (NAS / dev). Stessa interfaccia Repository.
export async function createRepository(): Promise<Repository> {
  const url = (process.env.SUPABASE_URL || '').trim();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (url && key) {
    const { SupabaseRepository } = await import('./supabase-repository');
    const repo = new SupabaseRepository({ supabaseUrl: url, supabaseKey: key });
    await repo.initialize();
    console.log('🗄️  Storage: Supabase/Postgres');
    return repo;
  }
  const dataDir =
    process.env.DATA_DIR || (process.env.NODE_ENV === 'production' ? '/app/data' : './data');
  const { JsonRepository } = await import('./json-repository');
  const repo = new JsonRepository({ dataDir });
  await repo.initialize();
  console.log(`🗄️  Storage: JSON locale (${dataDir})`);
  return repo;
}
