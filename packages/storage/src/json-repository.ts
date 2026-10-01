import * as fs from 'fs/promises';
import * as path from 'path';
import {
  CalendarItem,
  Conversation,
  PendingAction,
  UserSettings,
  ValidationError,
} from '@calendario/domain';
import { Repository } from './index';

export interface RepositoryConfig {
  dataDir: string;
}

const DEFAULT_SETTINGS: UserSettings = {
  theme: 'auto',
  defaultView: 'week',
  notificationsEnabled: true,
  aiProvider: 'demo',
  // Layout settings with sensible defaults
  layoutMode: 'card',
  sidebarWidth: 280,
  calendarSlotHeight: 48,
  daySlotHeight: 60,
  monthCellMinHeight: 120,
  contentMaxWidth: null,
  // Card mode settings
  cardWidthPercent: 90,
  cardHeightPercent: 85,
  cardMaxWidth: 1200,
  autoFit: true,
  calendarFilters: {
    showEvents: true,
    showTasks: true,
    showCompletedTasks: true,
    showAllDay: true,
    showPolito: true,
    hiddenCourses: [],
    visibilityFilter: 'all',
  },
};

const SCHEMA_VERSION = 1;

interface StorageData {
  version: number;
  items: CalendarItem[];
  conversations: Conversation[];
  pendingActions: PendingAction[];
  settings: UserSettings;
}

export class JsonRepository implements Repository {
  private dataDir: string;
  private dataFile: string;
  private data: StorageData | null = null;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(config: RepositoryConfig) {
    this.dataDir = config.dataDir;
    this.dataFile = path.join(this.dataDir, 'data.json');
  }

  async initialize(): Promise<void> {
    await fs.mkdir(this.dataDir, { recursive: true });

    // Create backup if data file exists
    try {
      const exists = await this.fileExists(this.dataFile);
      if (exists) {
        const backup = `${this.dataFile}.backup-${Date.now()}`;
        await fs.copyFile(this.dataFile, backup);
      }
    } catch (error) {
      console.warn('Could not create backup:', error);
    }

    await this.load();
  }

  private async load(): Promise<void> {
    try {
      const exists = await this.fileExists(this.dataFile);
      if (!exists) {
        this.data = {
          version: SCHEMA_VERSION,
          items: [],
          conversations: [],
          pendingActions: [],
          settings: DEFAULT_SETTINGS,
        };
        await this.save();
        return;
      }

      const content = await fs.readFile(this.dataFile, 'utf-8');
      const parsed = JSON.parse(content);
      
      // Version check
      if (!parsed.version || parsed.version !== SCHEMA_VERSION) {
        throw new ValidationError(
          `Schema version ${parsed.version} not supported. Expected ${SCHEMA_VERSION}`
        );
      }

      // Fill missing fields with defaults
      if (!parsed.settings) {
        parsed.settings = DEFAULT_SETTINGS;
      } else {
        // Merge: i settings salvati restano, i nuovi default (es. calendarFilters) vengono aggiunti
        parsed.settings = { ...DEFAULT_SETTINGS, ...parsed.settings };
        if (!parsed.settings.calendarFilters) {
          parsed.settings.calendarFilters = { ...(DEFAULT_SETTINGS.calendarFilters as any) };
        } else {
          parsed.settings.calendarFilters = {
            ...(DEFAULT_SETTINGS.calendarFilters as any),
            ...(parsed.settings.calendarFilters as any),
          };
        }
      }

      this.data = parsed;
    } catch (error) {
      if (error instanceof ValidationError) throw error;
      console.error('Failed to load data:', error);
      this.data = {
        version: SCHEMA_VERSION,
        items: [],
        conversations: [],
        pendingActions: [],
        settings: DEFAULT_SETTINGS,
      };
    }
  }

  private async save(): Promise<void> {
    // Queue writes to avoid concurrent file writes
    this.writeQueue = this.writeQueue.then(async () => {
      if (!this.data) return;

      try {
        const content = JSON.stringify(this.data, null, 2);
        const tmpFile = `${this.dataFile}.tmp`;

        // Write to temporary file first (atomic operation)
        await fs.writeFile(tmpFile, content, 'utf-8');
        await fs.rename(tmpFile, this.dataFile);
      } catch (error) {
        console.error('Failed to save data:', error);
        throw error;
      }
    });

    return this.writeQueue;
  }

  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  private ensureLoaded(): StorageData {
    if (!this.data) {
      throw new Error('Repository not initialized. Call initialize() first.');
    }
    return this.data;
  }

  // Calendar Items
  async listItems(): Promise<CalendarItem[]> {
    const data = this.ensureLoaded();
    return [...data.items];
  }

  async getItem(id: string): Promise<CalendarItem | null> {
    const data = this.ensureLoaded();
    return data.items.find((item) => item.id === id) || null;
  }

  async createItem(item: CalendarItem): Promise<CalendarItem> {
    const data = this.ensureLoaded();
    this.validateCalendarItem(item);
    data.items.push(item);
    await this.save();
    return { ...item };
  }

  async updateItem(id: string, patch: Partial<CalendarItem>): Promise<CalendarItem | null> {
    const data = this.ensureLoaded();
    const index = data.items.findIndex((item) => item.id === id);
    if (index === -1) return null;

    const updated = { ...data.items[index], ...patch, id };
    this.validateCalendarItem(updated);
    data.items[index] = updated;
    await this.save();
    return { ...updated };
  }

  async deleteItem(id: string): Promise<boolean> {
    const data = this.ensureLoaded();
    const index = data.items.findIndex((item) => item.id === id);
    if (index === -1) return false;

    data.items.splice(index, 1);
    await this.save();
    return true;
  }

  // Conversations
  async listConversations(): Promise<Conversation[]> {
    const data = this.ensureLoaded();
    return [...data.conversations];
  }

  async getConversation(id: string): Promise<Conversation | null> {
    const data = this.ensureLoaded();
    return data.conversations.find((c) => c.id === id) || null;
  }

  async createConversation(conversation: Conversation): Promise<Conversation> {
    const data = this.ensureLoaded();
    data.conversations.push(conversation);
    await this.save();
    return { ...conversation };
  }

  async updateConversation(
    id: string,
    patch: Partial<Conversation>
  ): Promise<Conversation | null> {
    const data = this.ensureLoaded();
    const index = data.conversations.findIndex((c) => c.id === id);
    if (index === -1) return null;

    const updated = {
      ...data.conversations[index],
      ...patch,
      id,
    };
    data.conversations[index] = updated;
    await this.save();
    return { ...updated };
  }

  // Pending Actions
  async listPendingActions(): Promise<PendingAction[]> {
    const data = this.ensureLoaded();
    return [...data.pendingActions];
  }

  async getPendingAction(id: string): Promise<PendingAction | null> {
    const data = this.ensureLoaded();
    return data.pendingActions.find((a) => a.id === id) || null;
  }

  async createPendingAction(action: PendingAction): Promise<PendingAction> {
    const data = this.ensureLoaded();
    data.pendingActions.push(action);
    await this.save();
    return { ...action };
  }

  async updatePendingAction(
    id: string,
    patch: Partial<PendingAction>
  ): Promise<PendingAction | null> {
    const data = this.ensureLoaded();
    const index = data.pendingActions.findIndex((a) => a.id === id);
    if (index === -1) return null;

    const updated = {
      ...data.pendingActions[index],
      ...patch,
      id,
    };
    data.pendingActions[index] = updated;
    await this.save();
    return { ...updated };
  }

  // Settings
  async getSettings(): Promise<UserSettings> {
    const data = this.ensureLoaded();
    return { ...data.settings };
  }

  async updateSettings(settings: Partial<UserSettings>): Promise<UserSettings> {
    const data = this.ensureLoaded();
    data.settings = { ...data.settings, ...settings };
    await this.save();
    return { ...data.settings };
  }

  // Export/Import
  async exportData(): Promise<{
    items: CalendarItem[];
    conversations: Conversation[];
    settings: UserSettings;
    exportedAt: string;
  }> {
    const data = this.ensureLoaded();
    return {
      items: [...data.items],
      conversations: [...data.conversations],
      settings: { ...data.settings },
      exportedAt: new Date().toISOString(),
    };
  }

  async importData(
    importData: {
      items?: CalendarItem[];
      conversations?: Conversation[];
      settings?: Partial<UserSettings>;
    },
    merge: boolean = true
  ): Promise<void> {
    const data = this.ensureLoaded();

    if (!merge) {
      // Full replacement mode
      if (importData.items) {
        importData.items.forEach((item) => this.validateCalendarItem(item));
        data.items = importData.items;
      }
      if (importData.conversations) {
        data.conversations = importData.conversations;
      }
      if (importData.settings) {
        data.settings = { ...data.settings, ...importData.settings };
      }
    } else {
      // Merge mode
      if (importData.items) {
        const existingIds = new Set(data.items.map((i) => i.id));
        importData.items.forEach((item) => {
          this.validateCalendarItem(item);
          if (!existingIds.has(item.id)) {
            data.items.push(item);
          }
        });
      }
      if (importData.conversations) {
        const existingIds = new Set(data.conversations.map((c) => c.id));
        importData.conversations.forEach((conv) => {
          if (!existingIds.has(conv.id)) {
            data.conversations.push(conv);
          }
        });
      }
      if (importData.settings) {
        data.settings = { ...data.settings, ...importData.settings };
      }
    }

    await this.save();
  }

  private validateCalendarItem(item: CalendarItem): void {
    if (!item.id || !item.title || !item.date) {
      throw new ValidationError('Invalid calendar item: missing required fields');
    }
    if (!['event', 'task'].includes(item.type)) {
      throw new ValidationError(`Invalid item type: ${item.type}`);
    }
  }
}
