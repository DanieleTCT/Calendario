import { ProviderConfig, ProviderError } from '@calendario/domain';
import { AiProvider, ProviderSession, ProviderSessionOptions } from '../types';
import { CALENDAR_TOOLS, toOpenAITools, OLLAMA_JSON_FALLBACK_SUFFIX } from '../tools';

export class OllamaProvider implements AiProvider {
  id = 'ollama';
  label = 'Ollama (Local)';
  local = true;
  config: ProviderConfig;
  private baseUrl: string;
  private model: string | null = null;

  constructor(baseUrl: string = 'http://localhost:11434', model?: string) {
    this.baseUrl = baseUrl;
    this.model = model || null;
    this.config = {
      id: 'ollama',
      type: 'ollama',
      label: this.label,
      baseUrl,
      model,
      enabled: !!model,
    };
  }

  setModel(model: string): void {
    this.model = model;
    this.config.model = model;
    this.config.enabled = true;
  }

  async isConfigured(): Promise<boolean> {
    return !!this.model;
  }

  async isOnline(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`, {
        signal: AbortSignal.timeout(3000),
      });
      if (!response.ok) return false;

      // Check if requested model exists (match esatto o per prefisso: 'qwen2.5:3b' vs 'qwen2.5:3b-instruct')
      if (this.model) {
        const data = (await response.json()) as any;
        const models = data.models?.map((m: any) => m.name) || [];
        const want: string = this.model;
        return models.some((m: string) => m === want || m.startsWith(want + ':') || want.startsWith(m));
      }

      return true;
    } catch {
      return false;
    }
  }

  async resolveModel(preferred?: string): Promise<string> {
    if (preferred) {
      this.model = preferred;
      return preferred;
    }

    if (this.model) return this.model;

    // Try to get available models
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`);
      if (response.ok) {
        const data = (await response.json()) as any;
        const models = data.models?.map((m: any) => m.name) || [];

        // Prefer smaller models for low VRAM
        const preferred = [
          'mistral:latest',
          'neural-chat',
          'phi',
          'orca-mini',
        ].find((m) => models.includes(m));

        if (preferred) {
          this.model = preferred;
          return preferred;
        }

        if (models.length > 0) {
          this.model = models[0];
          return models[0];
        }
      }
    } catch {
      // Ignore error
    }

    throw new ProviderError('No Ollama models available. Please install a model first.');
  }

  async startSession(options: ProviderSessionOptions): Promise<ProviderSession> {
    const model = options.model || this.model;
    if (!model) {
      throw new ProviderError('No Ollama model configured');
    }

    return new OllamaSession(this.baseUrl, model, options);
  }

  async getStatus() {
    const configured = await this.isConfigured();
    const online = await this.isOnline();
    let model = 'not configured';
    let error: string | undefined;

    try {
      model = await this.resolveModel();
    } catch (e) {
      error = String(e);
    }

    return {
      online,
      configured,
      model,
      error,
    };
  }
}

export interface OllamaToolCall {
  name: string;
  input: Record<string, unknown>;
}

/** Estrae tool-call da risposta JSON di fallback: ```json {...}```, {...} o testo misto. */
export function extractJsonToolCalls(content: string): { toolCalls: OllamaToolCall[]; reply: string } {
  const valid = new Set(Object.keys(CALENDAR_TOOLS));
  const clean = (s: string) => s.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  const candidates: string[] = [clean(content)];
  const raw = clean(content);
  let depth = 0;
  let start = -1;
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === '{') { if (depth === 0) start = i; depth++; }
    else if (raw[i] === '}') { depth--; if (depth === 0 && start >= 0) candidates.push(raw.slice(start, i + 1)); }
  }
  for (const c of candidates) {
    try {
      const obj = JSON.parse(c);
      const rawCalls = obj.toolCalls || obj.tool_calls || obj.calls || [];
      const list = Array.isArray(rawCalls) ? rawCalls : [];
      const toolCalls: OllamaToolCall[] = [];
      for (const t of list) {
        const name = t.name || t.function?.name || t.tool;
        if (!name || !valid.has(name)) continue;
        let input = t.input || t.arguments || t.args || t.parameters || {};
        if (typeof input === 'string') { try { input = JSON.parse(input); } catch { input = {}; } }
        toolCalls.push({ name, input: (input || {}) as Record<string, unknown> });
      }
      const reply = typeof obj.reply === 'string' ? obj.reply : (typeof obj.content === 'string' ? obj.content : '');
      if (toolCalls.length > 0 || /"toolCalls"\s*:/.test(c)) return { toolCalls, reply };
    } catch { /* prossimo candidato */ }
  }
  return { toolCalls: [], reply: '' };
}

function extractNativeToolCalls(message: any): OllamaToolCall[] {
  const valid = new Set(Object.keys(CALENDAR_TOOLS));
  const raw = message?.tool_calls || message?.toolCalls || [];
  const out: OllamaToolCall[] = [];
  for (const t of raw) {
    const name = t?.function?.name || t?.name;
    if (!name || !valid.has(name)) continue;
    let input = t?.function?.arguments ?? t?.input ?? t?.arguments ?? {};
    if (typeof input === 'string') { try { input = JSON.parse(input); } catch { input = {}; } }
    out.push({ name, input: (input || {}) as Record<string, unknown> });
  }
  return out;
}

class OllamaSession implements ProviderSession {
  constructor(
    private baseUrl: string,
    private model: string,
    private options: ProviderSessionOptions
  ) {}

  async complete(
    messages: Array<{ role: 'user' | 'assistant'; content: string }>,
    tools?: any
  ): Promise<{ content: string; toolCalls?: Array<{ name: string; input: Record<string, unknown> }> }> {
    const wantTools = tools === undefined || tools === true || (Array.isArray(tools) && tools.length > 0);
    const systemPrompt = wantTools
      ? (this.options.systemPrompt || 'You are a helpful calendar assistant.') + OLLAMA_JSON_FALLBACK_SUFFIX
      : (this.options.systemPrompt || 'You are a helpful calendar assistant.');

    try {
      const body: any = {
        model: this.model,
        messages: [
          { role: 'system', content: systemPrompt },
          ...messages,
        ],
        stream: false,
        options: {
          temperature: this.options.temperature ?? 0.2,
          num_predict: this.options.maxTokens || 1024,
          num_ctx: 4096,
        },
      };
      // Formato OpenAI: identico a quello che Cline / estensioni VSCode inviano a Ollama.
      if (wantTools) body.tools = toOpenAITools();
      const response = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: this.createAbortSignal(),
      });

      if (!response.ok) {
        throw new ProviderError(
          `Ollama error: ${response.statusText}`,
          response.status >= 500
        );
      }

      const data = (await response.json()) as any;
      const message = data.message || {};
      const content: string = message.content || '';
      // 1) Tool nativi (qwen2.5, llama3.1+, mistral-nemo...)
      const native = extractNativeToolCalls(message);
      if (native.length > 0) return { content, toolCalls: native };
      // 2) Fallback JSON testuale (mistral 7b, phi, orca-mini...)
      if (wantTools) {
        const parsed = extractJsonToolCalls(content);
        if (parsed.toolCalls.length > 0) return { content: parsed.reply || '', toolCalls: parsed.toolCalls };
        if (/"toolCalls"\s*:\s*\[\s*\]/.test(content) && parsed.reply) return { content: parsed.reply };
      }
      return { content };
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      throw new ProviderError(`Ollama request failed: ${String(error)}`, true);
    }
  }

  async stream(
    messages: Array<{ role: 'user' | 'assistant'; content: string }>,
    tools?: any,
    onChunk?: (chunk: string) => void
  ): Promise<{ content: string; toolCalls?: Array<{ name: string; input: Record<string, unknown> }> }> {
    // Lo streaming Ollama non veicola tool_calls in modo affidabile:
    // riusa complete() e poi emette il testo a chunk per la SSE.
    const out = await this.complete(messages, tools);
    if (out.content && onChunk) {
      const step = 120;
      for (let i = 0; i < out.content.length; i += step) onChunk(out.content.slice(i, i + step));
    }
    return out;
  }

  async close(): Promise<void> {
    // No cleanup needed
  }

  private createAbortSignal(): AbortSignal | undefined {
    if (!this.options.timeout) return undefined;
    const controller = new AbortController();
    setTimeout(() => controller.abort(), this.options.timeout);
    return controller.signal;
  }
}
