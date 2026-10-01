// Calendar Item - unified type for events and tasks
export type CalendarItemType = 'event' | 'task';
export type Visibility = 'default' | 'private' | 'public' | 'confidential';
export type RecurrenceType = 'none' | 'daily' | 'weekly' | 'monthly';
export type ItemSource = 'local' | 'agent' | 'imported' | 'polito';

// Metadata per le lezioni PoliTO importate dall'API ufficiale
export interface PolitoLessonMeta {
  lectureId: number;
  courseId: number;
  courseName: string;
  /** Tipo originale PoliTO: "Lezione", "Esercitazione", "Lezione / Esercitazione" */
  lessonType: string;
  teacherId?: number;
  /** Aula, es. "Aula 1P" */
  room?: string;
  /** Edificio/sede, es. "TO_CIT22" */
  buildingId?: string;
}

export interface CalendarItem {
  id: string;
  type: CalendarItemType;
  title: string;
  description?: string;
  date: string; // YYYY-MM-DD
  startTime?: string; // HH:mm
  endTime?: string; // HH:mm
  allDay: boolean;
  category: string;
  visibility: Visibility;
  recurrence: RecurrenceType;
  recurrenceUntil?: string; // YYYY-MM-DD
  completed?: boolean;
  reminderMinutes: number;
  location?: string;
  createdAt: string; // ISO 8601
  updatedAt?: string; // ISO 8601
  source: ItemSource;
  /** Presente solo per gli item sincronizzati da PoliTO */
  polito?: PolitoLessonMeta;
}

// AI and Agent types
export interface ChatMessage {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

export interface Conversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: ChatMessage[];
  metadata?: Record<string, unknown>;
}

export interface AgentStep {
  id: string;
  type: 'reasoning' | 'tool_call' | 'tool_result' | 'decision';
  content: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  toolOutput?: Record<string, unknown>;
  timestamp: string;
}

export interface PendingAction {
  id: string;
  conversationId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  description: string;
  expectedResult?: string;
  createdAt: string;
  expiresAt: string;
  status: 'pending' | 'approved' | 'rejected' | 'expired';
  approvedAt?: string;
}

// Configurazione integrazione PoliTO (calendario lezioni)
export interface PolitoSettings {
  enabled: boolean;
  /** Matricola/username PoliTO, es. s123456 */
  username?: string;
  /** Password PoliTO - salvata SOLO in data.json locale, mai esposta via GET /settings */
  password?: string;
  /** Token bearer cacheato (scadenza ignota: refresh automatico su 401) */
  token?: string;
  clientId?: string;
  /** Data ora ISO dell'ultimo sync riuscito */
  lastSyncAt?: string;
  /** Ultimo errore di sync/login (stringa vuota se ok) */
  lastError?: string;
  /** Minuti tra un sync automatico e l'altro (default 60) */
  syncIntervalMin?: number;
  /** Finestra di giorni futuri da sincronizzare (default 28) */
  windowDays?: number;
  /** Colori personalizzati per corso: courseName -> hex */
  colorMap?: Record<string, string>;
  /** Visibilità per vista */
  showInWeek: boolean;
  showInMonth: boolean;
  showInDay: boolean;
}

// Settings
export interface UserSettings {
  theme: 'light' | 'dark' | 'auto';
  defaultView: 'month' | 'week' | 'day' | 'list';
  notificationsEnabled: boolean;
  aiProvider: string; // provider ID
  ollama?: {
    baseUrl: string;
    model: string;
  };
  polito?: PolitoSettings;
  // Colori degli eventi personali per categoria (category -> hex, es. "work": "#4f46e5")
  categoryColors?: Record<string, string>;
  // Colore del testo sulle card evento: auto = contrasto automatico rispetto allo sfondo
  eventTextMode?: 'auto' | 'light' | 'dark';
  // Opacità degli eventi nel calendario (0.2 - 1, default 1)
  eventOpacity?: number;
  // Colore dedicato alla scadenza dei task (default ambra #f59e0b)
  taskDeadlineColor?: string;
  cloudProviders?: Record<string, {
    apiKey: string;
    enabled: boolean;
  }>;
  // Layout settings
  layoutMode: 'fit' | 'scroll' | 'card';
  sidebarWidth: number; // px, 200-500
  calendarSlotHeight: number; // px per slot 30min in week view
  daySlotHeight: number; // px per slot 30min in day view
  monthCellMinHeight: number; // px minimum height for month cells
  contentMaxWidth: number | null; // px, null for full width
  // Card mode settings (when layoutMode === 'card')
  cardWidthPercent: number; // 50-100, percentage of screen width
  cardHeightPercent: number; // 50-100, percentage of screen height
  cardMaxWidth: number | null; // max width in px, null for no limit
  autoFit: boolean; // if true, calendar automatically fits in card
  // Filtri/visibilità selezionabili e salvabili (sezione calendario)
  calendarFilters?: CalendarFilters;
}

// Visibilità/filtri del calendario (selezionabili e salvabili nelle impostazioni)
export interface CalendarFilters {
  showEvents: boolean;
  showTasks: boolean;
  showCompletedTasks: boolean;
  showAllDay: boolean;
  showPolito: boolean;
  hiddenCourses?: string[];
  visibilityFilter?: 'all' | Visibility;
}

export const DEFAULT_CALENDAR_FILTERS: CalendarFilters = {
  showEvents: true,
  showTasks: true,
  showCompletedTasks: true,
  showAllDay: true,
  showPolito: true,
  hiddenCourses: [],
  visibilityFilter: 'all',
};
export interface ProviderConfig {
  id: string;
  type: 'demo' | 'gemini' | 'openrouter' | 'ollama' | 'openai-compatible';
  label: string;
  enabled: boolean;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
  timeout?: number;
}

// Tool types
export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  modifying: boolean; // if true, requires approval
}

export interface ToolCall {
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

// Error types
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export class ProviderError extends Error {
  constructor(message: string, public readonly retryable: boolean = false) {
    super(message);
    this.name = 'ProviderError';
  }
}
