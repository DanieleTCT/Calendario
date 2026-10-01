import { ProviderConfig, ProviderError } from '@calendario/domain';
import { AiProvider, ProviderSession, ProviderSessionOptions } from '../types';
import { toGeminiFunctionDeclarations } from '../tools';

export class GeminiProvider implements AiProvider {
  id = 'gemini';
  label = 'Google Gemini';
  local = false;
  config: ProviderConfig;
  private apiKey: string | null = null;

  constructor(apiKey?: string) {
    this.config = {
      id: 'gemini',
      type: 'gemini',
      label: this.label,
      enabled: !!apiKey,
      apiKey,
    };
    this.apiKey = apiKey || null;
  }

  setApiKey(apiKey: string): void {
    this.apiKey = apiKey;
    this.config.apiKey = apiKey;
    this.config.enabled = true;
  }

  async isConfigured(): Promise<boolean> {
    return !!this.apiKey;
  }

  async isOnline(): Promise<boolean> {
    if (!this.apiKey) return false;

    try {
      const response = await fetch(
        'https://generativelanguage.googleapis.com/v1beta/models?key=' +
          this.apiKey,
        { method: 'GET', signal: AbortSignal.timeout(5000) }
      );
      return response.ok;
    } catch {
      return false;
    }
  }

  async resolveModel(preferred?: string): Promise<string> {
    return preferred || 'gemini-3.6-flash';
  }

  async startSession(options: ProviderSessionOptions): Promise<ProviderSession> {
    if (!this.apiKey) {
      throw new ProviderError('Gemini API key not configured');
    }

    return new GeminiSession(this.apiKey, options);
  }

  async getStatus() {
    const configured = await this.isConfigured();
    const online = await this.isOnline();
    const model = await this.resolveModel();

    return {
      online,
      configured,
      model,
    };
  }
}

export interface ToolCallRequest {
  name: string;
  input: Record<string, unknown>;
}

export interface SessionResult {
  content: string;
  toolCalls?: ToolCallRequest[];
}

function extractToolCalls(data: any): ToolCallRequest[] {
  const out: ToolCallRequest[] = [];
  const cands = data?.candidates || [];
  for (const c of cands) {
    const parts = c?.content?.parts || [];
    for (const p of parts) {
      const fc = p?.functionCall;
      if (fc?.name) out.push({ name: fc.name, input: (fc.args || {}) as Record<string, unknown> });
    }
  }
  return out;
}

function extractText(data: any): string {
  const cands = data?.candidates || [];
  let t = '';
  for (const c of cands) {
    for (const p of c?.content?.parts || []) {
      if (typeof p?.text === 'string') t += p.text;
    }
  }
  return t;
}

class GeminiSession implements ProviderSession {
  constructor(
    private apiKey: string,
    private options: ProviderSessionOptions
  ) {}

  async complete(
    messages: Array<{ role: 'user' | 'assistant'; content: string }>,
    tools?: any,
  ): Promise<{ content: string; toolCalls?: Array<{ name: string; input: Record<string, unknown> }> }> {
    const model = this.options.model || 'gemini-3.6-flash';
    const systemPrompt = this.options.systemPrompt || 'You are a helpful calendar assistant.';
    const useTools = tools !== false;

    try {
      const payload: any = {
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: messages.map((m) => ({
          role: m.role === 'user' ? 'user' : 'model',
          parts: [{ text: m.content }],
        })),
        generationConfig: {
          maxOutputTokens: this.options.maxTokens || 2048,
          temperature: this.options.temperature || 0.7,
        },
      };
      if (useTools) {
        payload.tools = [{ functionDeclarations: toGeminiFunctionDeclarations() }];
      }

      // Retry transient failures (429/5xx): Gemini often returns 503 "high demand"
      const MAX_ATTEMPTS = 3;
      let data: any = null;
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${this.apiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: this.createAbortSignal(),
          }
        );

        if (!response.ok) {
          const errBody = await response.text().catch(() => '');
          const transient = [429, 500, 502, 503, 504].includes(response.status);
          if (transient && attempt < MAX_ATTEMPTS) {
            await new Promise((r) => setTimeout(r, attempt * 900));
            continue;
          }
          throw new ProviderError(
            `Gemini API error: ${response.status} ${response.statusText}${errBody ? ' - ' + errBody.slice(0, 300) : ''}`,
            transient
          );
        }
        data = await response.json();
        break;
      }

      if (!data) throw new ProviderError('Gemini: nessuna risposta dopo i tentativi', true);

      if (data.promptFeedback?.blockReason) {
        throw new ProviderError(`Gemini ha bloccato la richiesta: ${data.promptFeedback.blockReason}`);
      }
      if (!data.candidates || !data.candidates[0]) {
        throw new ProviderError('No content generated by Gemini');
      }

      const content = extractText(data);
      const toolCalls = extractToolCalls(data);
      if (!content && toolCalls.length === 0) {
        const cand = data.candidates[0];
        throw new ProviderError(
          `Gemini ha risposto senza testo (finishReason: ${cand.finishReason || 'sconosciuto'}). Riformula la richiesta in modo piu semplice.`
        );
      }
      return { content, toolCalls: toolCalls.length ? toolCalls : undefined };
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      throw new ProviderError(`Gemini request failed: ${String(error)}`, true);
    }
  }

  async stream(
    messages: Array<{ role: 'user' | 'assistant'; content: string }>,
    _tools?: any,
    onChunk?: (chunk: string) => void
  ): Promise<{ content: string }> {
    const model = this.options.model || 'gemini-3.6-flash';
    const systemPrompt = this.options.systemPrompt || 'You are a helpful calendar assistant.';

    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?key=${this.apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: systemPrompt }] },
            contents: messages.map((m) => ({
              role: m.role === 'user' ? 'user' : 'model',
              parts: [{ text: m.content }],
            })),
            generationConfig: {
              maxOutputTokens: this.options.maxTokens || 2048,
              temperature: this.options.temperature || 0.7,
            },
          }),
          signal: this.createAbortSignal(),
        }
      );

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new ProviderError(`Gemini API error: ${response.status} ${response.statusText}${body ? ' - ' + body.slice(0, 300) : ''}`);
      }

      let fullContent = '';

      if (response.body) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        const emitText = (text: string) => {
          if (text) { fullContent += text; onChunk?.(text); }
        };
        // Gemini streamGenerateContent returns a JSON ARRAY (not SSE):
        //   [{ candidates: [...] }, { candidates: [...] }, ...]
        // Parse incrementally: extract each complete {...} object as it arrives.
        const tryParse = (s: string): any | null => {
          try { return JSON.parse(s); } catch { return null; }
        };
        const drain = (final: boolean) => {
          // Split buffer into candidate JSON objects by brace depth
          let depth = 0; let start = -1; let inStr = false; let esc = false;
          let lastEnd = 0;
          for (let i = 0; i < buffer.length; i++) {
            const ch = buffer[i];
            if (inStr) {
              if (esc) esc = false;
              else if (ch === '\\') esc = true;
              else if (ch === '"') inStr = false;
              continue;
            }
            if (ch === '"') inStr = true;
            else if (ch === '{' || ch === '[') { if (depth === 0 && ch === '{') start = i; depth++; }
            else if (ch === '}' || ch === ']') {
              depth = Math.max(0, depth - 1);
              if (ch === '}' && depth === 1 && start >= 0) {
                // candidate object closed (inside outer array)
                const obj = tryParse(buffer.slice(start, i + 1));
                if (obj) {
                  const plist = obj.candidates?.[0]?.content?.parts || [];
                  const text = plist.map((p: any) => (typeof p?.text === 'string' ? p.text : '')).join('');
                  if (text) emitText(text);
                  lastEnd = i + 1;
                }
              }
            }
          }
          if (lastEnd > 0) buffer = buffer.slice(lastEnd);
          if (final && buffer.trim()) {
            const arr = tryParse(buffer.trim().replace(/,$/, ''));
            const list = Array.isArray(arr) ? arr : [arr];
            for (const obj of list) {
              if (!obj) continue;
              const plist = obj.candidates?.[0]?.content?.parts || [];
              const text = plist.map((p: any) => (typeof p?.text === 'string' ? p.text : '')).join('');
              if (text) emitText(text);
            }
            buffer = '';
          }
        };

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          drain(false);
        }
        buffer += decoder.decode();
        drain(true);
      }

      // Fallback: if stream parsing yielded nothing, try whole-body JSON
      if (!fullContent) {
        throw new ProviderError('Gemini stream: nessun contenuto ricevuto (parsing stream vuoto)');
      }

      return { content: fullContent };
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      throw new ProviderError(`Gemini stream failed: ${String(error)}`, true);
    }
  }

  async close(): Promise<void> {
    // Cleanup if needed
  }

  private createAbortSignal(): AbortSignal | undefined {
    if (!this.options.timeout) return undefined;
    const controller = new AbortController();
    setTimeout(() => controller.abort(), this.options.timeout);
    return controller.signal;
  }
}
