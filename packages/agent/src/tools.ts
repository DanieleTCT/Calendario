import { CalendarItem, ToolDefinition } from '@calendario/domain';
import { v4 as uuid } from 'uuid';

export interface ToolContext {
  repository: any;
  conversationId: string;
  userId: string;
}

export interface ToolHandler {
  (input: Record<string, unknown>, context: ToolContext): Promise<unknown>;
}

export interface ToolResult {
  success: boolean;
  data?: unknown;
  message?: string;
  pendingActionId?: string;
}

export const CALENDAR_TOOLS = {
  calendar_query_range: {
    name: 'calendar_query_range',
    description:
      'Query calendar items within a date range. Read-only operation that returns matching events and tasks.',
    inputSchema: {
      type: 'object',
      properties: {
        startDate: { type: 'string', description: 'Start date (YYYY-MM-DD)' },
        endDate: { type: 'string', description: 'End date (YYYY-MM-DD)' },
        type: {
          type: 'string',
          enum: ['event', 'task', 'all'],
          description: 'Filter by item type',
        },
      },
      required: ['startDate', 'endDate'],
    },
    modifying: false,
  } as ToolDefinition,

  calendar_search: {
    name: 'calendar_search',
    description: 'Search calendar items by title, description, or category. Read-only operation.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        limit: { type: 'number', description: 'Maximum results to return', default: 10 },
      },
      required: ['query'],
    },
    modifying: false,
  } as ToolDefinition,

  calendar_find_free_slots: {
    name: 'calendar_find_free_slots',
    description:
      'Find free time slots on a specific date. Read-only operation that analyzes calendar.',
    inputSchema: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'Date (YYYY-MM-DD)' },
        startHour: { type: 'number', description: 'Start hour (0-23)', default: 8 },
        endHour: { type: 'number', description: 'End hour (0-23)', default: 20 },
        slotDurationMinutes: { type: 'number', description: 'Slot duration in minutes', default: 30 },
      },
      required: ['date'],
    },
    modifying: false,
  } as ToolDefinition,

  calendar_create_item: {
    name: 'calendar_create_item',
    description:
      'Create a new calendar item (event or task). This operation requires user approval.',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['event', 'task'], description: 'Item type' },
        title: { type: 'string', description: 'Item title' },
        description: { type: 'string', description: 'Item description' },
        date: { type: 'string', description: 'Date (YYYY-MM-DD)' },
        startTime: { type: 'string', description: 'Start time (HH:mm), optional for all-day events' },
        endTime: { type: 'string', description: 'End time (HH:mm)' },
        allDay: { type: 'boolean', description: 'Is all-day event', default: false },
        category: { type: 'string', description: 'Category', default: 'general' },
        recurrence: {
          type: 'string',
          enum: ['none', 'daily', 'weekly', 'monthly'],
          description: 'Recurrence type',
          default: 'none',
        },
      },
      required: ['type', 'title', 'date'],
    },
    modifying: true,
  } as ToolDefinition,

  calendar_update_item: {
    name: 'calendar_update_item',
    description: 'Update an existing calendar item. This operation requires user approval.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Item ID' },
        title: { type: 'string' },
        description: { type: 'string' },
        date: { type: 'string' },
        startTime: { type: 'string' },
        endTime: { type: 'string' },
        completed: { type: 'boolean' },
      },
      required: ['id'],
    },
    modifying: true,
  } as ToolDefinition,

  calendar_delete_item: {
    name: 'calendar_delete_item',
    description: 'Delete a calendar item. This operation requires user approval.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Item ID' },
      },
      required: ['id'],
    },
    modifying: true,
  } as ToolDefinition,

  tasks_list: {
    name: 'tasks_list',
    description: 'List tasks with optional filters. Read-only operation.',
    inputSchema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['all', 'open', 'completed', 'overdue'],
          description: 'Filter by status',
          default: 'all',
        },
        limit: { type: 'number', description: 'Maximum results', default: 20 },
      },
    },
    modifying: false,
  } as ToolDefinition,

  tasks_create: {
    name: 'tasks_create',
    description: 'Create a new task. This operation requires user approval.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Task title' },
        description: { type: 'string', description: 'Task description' },
        date: { type: 'string', description: 'Due date (YYYY-MM-DD)' },
        category: { type: 'string', description: 'Category', default: 'general' },
        reminderMinutes: { type: 'number', description: 'Reminder offset', default: 1440 },
      },
      required: ['title', 'date'],
    },
    modifying: true,
  } as ToolDefinition,

  tasks_complete: {
    name: 'tasks_complete',
    description: 'Mark a task as complete or incomplete. This operation requires user approval.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Task ID' },
        completed: { type: 'boolean', description: 'Completion status' },
      },
      required: ['id', 'completed'],
    },
    modifying: true,
  } as ToolDefinition,

  memory_get: {
    name: 'memory_get',
    description: 'Retrieve stored conversation memory. Read-only operation.',
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Memory key' },
      },
      required: ['key'],
    },
    modifying: false,
  } as ToolDefinition,

  memory_set: {
    name: 'memory_set',
    description: 'Store information in conversation memory. This operation requires user approval.',
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Memory key' },
        value: { type: 'object', description: 'Value to store' },
      },
      required: ['key', 'value'],
    },
    modifying: true,
  } as ToolDefinition,

  ask_user: {
    name: 'ask_user',
    description:
      'Ask the user for clarification or additional information. Pauses execution until response.',
    inputSchema: {
      type: 'object',
      properties: {
        question: { type: 'string', description: 'Question to ask the user' },
        options: {
          type: 'array',
          description: 'Optional list of suggested options',
          items: { type: 'string' },
        },
      },
      required: ['question'],
    },
    modifying: false,
  } as ToolDefinition,
};

export function createTools(): Record<string, ToolDefinition> {
  return CALENDAR_TOOLS;
}

export function getModifyingTools(): string[] {
  return Object.values(CALENDAR_TOOLS)
    .filter((tool) => tool.modifying)
    .map((tool) => tool.name);
}

function schemaToGemini(schema: Record<string, any>): any {
  if (!schema || typeof schema !== 'object') return { type: 'OBJECT' };
  const out: any = {};
  const t = String(schema.type || 'object').toUpperCase();
  out.type = t === 'ARRAY' ? 'ARRAY' : t === 'NUMBER' ? 'NUMBER' : t === 'BOOLEAN' ? 'BOOLEAN' : t === 'STRING' ? 'STRING' : 'OBJECT';
  if ((schema as any).description) out.description = (schema as any).description;
  if ((schema as any).enum) out.enum = (schema as any).enum;
  if ((schema as any).properties) {
    out.properties = {};
    for (const [k, v] of Object.entries((schema as any).properties as Record<string, any>)) {
      out.properties[k] = schemaToGemini(v);
    }
  }
  if ((schema as any).items) out.items = schemaToGemini((schema as any).items as any);
  if ((schema as any).required) out.required = (schema as any).required;
  return out;
}

export function toGeminiFunctionDeclarations(): any[] {
  return Object.values(CALENDAR_TOOLS).map((t) => ({
    name: t.name,
    description: t.description + (t.modifying ? ' (richiede approvazione: crea pending action, NON eseguire direttamente)' : ''),
    parameters: schemaToGemini(t.inputSchema as any),
  }));
}

// --- OpenAI/Ollama function-calling format ---
// Ollama /api/chat accetta `tools` in formato OpenAI quando il modello lo supporta
// (qwen2.5, mistral-nemo, llama3.1+). Stesso formato usato da Cline/VSCode extensions:
// ecco perché i tool "non andavano": non venivano mai inviati.
// Per modelli piccoli senza supporto nativo si usa il fallback JSON nel system prompt
// (vedi OLLAMA_JSON_FALLBACK_SUFFIX + extractJsonToolCalls in ollama-provider).
function cleanJsonSchema(schema: Record<string, any>): any {
  if (!schema || typeof schema !== 'object') return { type: 'object' };
  const out: any = {};
  if (typeof schema.type === 'string') out.type = schema.type;
  if (typeof schema.description === 'string') out.description = schema.description;
  if (Array.isArray(schema.enum)) out.enum = schema.enum;
  if (typeof schema.default !== 'undefined') out.default = schema.default;
  if (schema.properties && typeof schema.properties === 'object') {
    out.properties = {};
    for (const [k, v] of Object.entries(schema.properties as Record<string, any>)) {
      out.properties[k] = cleanJsonSchema(v);
    }
  }
  if (schema.items) out.items = cleanJsonSchema(schema.items as any);
  if (Array.isArray(schema.required)) out.required = schema.required;
  return out;
}

export function toOpenAITools(): any[] {
  return Object.values(CALENDAR_TOOLS).map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description + (t.modifying ? ' IMPORTANT: this only creates an approval request, it never applies changes directly.' : ''),
      parameters: cleanJsonSchema(t.inputSchema as any),
    },
  }));
}

/** Suffix aggiunto al system prompt per modelli senza tool nativi: li forza a rispondere in JSON parsabile. */
export const OLLAMA_JSON_FALLBACK_SUFFIX = [
  '',
  'TOOL CALLING (obbligatorio quando servono dati o modifiche):',
  'rispondi con UNA riga JSON valida e nient\u2019altro nel formato:',
  '{"toolCalls": [{"name": "<nome_tool>", "input": { ... }}], "reply": "<breve testo per l\u2019utente>"}',
  'Nomi tool validi: calendar_query_range, calendar_search, calendar_find_free_slots, tasks_list, calendar_create_item, tasks_create, calendar_update_item, calendar_delete_item, tasks_complete, memory_get, memory_set, ask_user.',
  'Se non serve alcun tool rispondi con {"toolCalls": [], "reply": "<risposta>"} in testo semplice.',
].join('\n');
