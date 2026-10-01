import { ProviderConfig, ProviderError } from '@calendario/domain';
import { AiProvider, ProviderSession } from '../types';
import { CALENDAR_TOOLS, toOpenAITools } from '../tools';

/** Provider OpenAI-compatibile generico: Bionic GPT, LM Studio, Ollama /v1, vLLM, llama.cpp... */
export class LocalOpenAIProvider implements AiProvider {
  id = 'local';
  label = 'Locale (OpenAI-compatibile)';
  local = true;
  config: ProviderConfig;
  private baseUrl: string;
  private model: string | null = null;
  private apiKey: string | null = null;

  constructor(baseUrl = 'http://localhost/v1', model?: string, apiKey?: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.model = model || null;
    this.apiKey = apiKey || null;
    this.config = { id: 'local', type: 'openai-compatible', label: this.label, baseUrl, model, enabled: !!model };
  }
  setConfig(baseUrl: string, model: string, apiKey?: string): void {
    this.baseUrl = baseUrl.replace(/\/$/, ''); this.model = model; this.apiKey = apiKey || null;
    this.config = { ...this.config, baseUrl: this.baseUrl, model, apiKey, enabled: true };
  }
  async isConfigured(): Promise<boolean> { return !!this.model && !!this.baseUrl; }
  async isOnline(): Promise<boolean> {
    try {
      const headers: Record<string, string> = {};
      if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;
      const r = await fetch(`${this.baseUrl}/models`, { headers, signal: AbortSignal.timeout(5000) });
      return r.ok;
    } catch { return false; }
  }
  async listModels(): Promise<string[]> {
    try {
      const headers: Record<string, string> = {};
      if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;
      const r = await fetch(`${this.baseUrl}/models`, { headers, signal: AbortSignal.timeout(8000) });
      if (!r.ok) return [];
      const j = await r.json() as any;
      return (j.data || []).map((m: any) => String(m.id));
    } catch { return []; }
  }
  async resolveModel(preferred?: string): Promise<string> {
    if (preferred) return preferred;
    if (this.model) return this.model;
    const models = await this.listModels();
    if (models.length) { this.model = models[0]; return models[0]; }
    throw new ProviderError('Nessun modello locale. Avvia Bionic/LM Studio e carica un modello.');
  }
  async startSession(options: any): Promise<ProviderSession> {
    const model = options.model || this.model;
    if (!model) throw new ProviderError('Modello locale non configurato');
    return new LocalSession(this.baseUrl, model, this.apiKey, options);
  }
  async getStatus() {
    const configured = await this.isConfigured();
    const online = await this.isOnline();
    let model = this.model || 'non configurato';
    let error: string | undefined;
    if (configured && online && !this.model) {
      try { model = await this.resolveModel(); } catch (e) { error = String(e); }
    }
    return { online, configured, model, error };
  }
}

class LocalSession implements ProviderSession {
  constructor(private baseUrl: string, private model: string, private apiKey: string | null, private options: any) {}
  async complete(messages: Array<{ role: 'user' | 'assistant'; content: string }>, tools?: any) {
    const wantTools = tools === undefined || tools === true || (Array.isArray(tools) && tools.length > 0);
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;
    // Qwen3 1.7B via Bionic: piccolo modello reasoning — niente system prompt gigante
    // nella prima chiamata tool, max_tokens alto per non troncare il reasoning.
    // Ancoraggio date calcolato dal server: il modello non deve MAI inventare le date.
    const romeFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' });
    const romeDay = romeFmt.format(new Date());
    const now = new Date(romeDay + 'T12:00:00');
    const _shiftFor = (d: Date) => {
      const utcNoon = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0);
      return new Date(utcNoon);
    };
    const fmt = (d: Date) => romeFmt.format(_shiftFor(d));
    const monday = new Date(romeDay + 'T12:00:00');
    monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
    const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6);
    const plus14 = new Date(now); plus14.setDate(now.getDate() + 14);
    const dateAnchor = `OGGI=${fmt(now)} LUNEDI=${fmt(monday)} DOMENICA=${fmt(sunday)} OGGI+14=${fmt(plus14)}. ` +
      `REGOLE DATE (obbligatorie): "questa settimana"=startDate=${fmt(monday)} endDate=${fmt(sunday)}. ` +
      `"oggi"=startDate=endDate=${fmt(now)}. "prossimi 14 giorni"=startDate=${fmt(now)} endDate=${fmt(plus14)}. ` +
      `Date SEMPRE YYYY-MM-DD, MAI altri anni. Prima di rispondere con "nessun evento", RICHIAMA il tool con queste date.`;
    const groundRule = `GROUNDING (obbligatorio, priorita massima): dopo il RISULTATO TOOL elenca ESCLUSIVAMENTE gli item ricevuti, con titolo/data/ora identici. VIETATO aggiungere eventi o task non presenti nell'output, VIETATO inventare orari o categorie. Se l'output e vuoto rispondi "nessun evento/task nel periodo". Niente markdown: solo testo semplice con "-".`;
    const shortSystem = `Sei un assistente calendario italiano, concreto e breve. Rispondi in italiano, testo semplice, elenchi con "-". ${dateAnchor} ${groundRule}`;
    const body: any = {
      model: this.model,
      messages: [{ role: 'system', content: wantTools ? shortSystem : (this.options.systemPrompt || shortSystem) }, ...messages],
      max_tokens: wantTools ? 4096 : (this.options.maxTokens || 2048),
      temperature: this.options.temperature ?? 0.1,
    };
    if (wantTools) { body.tools = toOpenAITools(); body.tool_choice = 'auto'; }
    try {
      const r = await fetch(`${this.baseUrl}/chat/completions`, { method: 'POST', headers, body: JSON.stringify(body), signal: this.sig() });
      if (!r.ok) throw new ProviderError(`Locale error: ${r.status} ${r.statusText}`, r.status >= 500);
      const j = await r.json() as any;
      const msg = j.choices?.[0]?.message || {};
      const rawContent = msg.content || '';
      // Fallback JSON testuale: se il modello non usa tool nativi ma scrive
      // {"toolCalls": [...]}, estrailo dal testo (stesso formato di Ollama fallback).
      let calls = parseCalls(msg);
      let content = rawContent;
      if (wantTools && calls.length === 0 && typeof rawContent === 'string' && rawContent.includes('toolCalls')) {
        const fb = extractJsonFallback(rawContent);
        if (fb.toolCalls.length) { calls = fb.toolCalls; content = fb.reply || ''; }
      }
      return { content, toolCalls: calls.length ? calls : undefined };
    } catch (e) {
      if (e instanceof ProviderError) throw e;
      throw new ProviderError(
        `Server locale non raggiungibile su ${this.baseUrl} (${String(e)}). Avvia Bionic/LM Studio e verifica base URL e modello nelle Impostazioni.`,
        true
      );
    }
  }
  async stream(messages: Array<{ role: 'user' | 'assistant'; content: string }>, tools?: any, onChunk?: (c: string) => void) {
    const out = await this.complete(messages, tools);
    if (out.content && onChunk) { const s = 120; for (let i = 0; i < out.content.length; i += s) onChunk(out.content.slice(i, i + s)); }
    return out;
  }
  async close(): Promise<void> {}
  private sig(): AbortSignal | undefined {
    if (!this.options.timeout) return undefined;
    const c = new AbortController(); setTimeout(() => c.abort(), this.options.timeout); return c.signal;
  }
}

function parseCalls(message: any): Array<{ name: string; input: Record<string, unknown> }> {
  const valid = new Set(Object.keys(CALENDAR_TOOLS));
  const raw = message?.tool_calls || message?.toolCalls || [];
  const out: Array<{ name: string; input: Record<string, unknown> }> = [];
  for (const t of raw) {
    const name = t?.function?.name || t?.name;
    if (!name || !valid.has(name)) continue;
    let input = t?.function?.arguments ?? t?.input ?? {};
    if (typeof input === 'string') { try { input = JSON.parse(input); } catch { input = {}; } }
    out.push({ name, input: (input || {}) as Record<string, unknown> });
  }
  return out;
}

/** Fallback: modello piccolo che scrive {"toolCalls":[...],"reply":"..."} nel testo. */
function extractJsonFallback(text: string): { toolCalls: Array<{ name: string; input: Record<string, unknown> }>; reply: string } {
  const empty = { toolCalls: [] as Array<{ name: string; input: Record<string, unknown> }>, reply: '' };
  try {
    const m = text.match(/\{[\s\S]*"toolCalls"[\s\S]*\}/);
    if (!m) return empty;
    const j = JSON.parse(m[0]);
    const raw = j.toolCalls || j.tool_calls || j.calls || [];
    const valid = new Set(Object.keys(CALENDAR_TOOLS));
    const toolCalls: Array<{ name: string; input: Record<string, unknown> }> = [];
    for (const t of raw) {
      const name = t?.name || t?.function?.name || t?.tool;
      if (!name || !valid.has(name)) continue;
      let input = t?.input ?? t?.arguments ?? t?.args ?? t?.parameters ?? {};
      if (typeof input === 'string') { try { input = JSON.parse(input); } catch { input = {}; } }
      toolCalls.push({ name, input: (input || {}) as Record<string, unknown> });
    }
    return { toolCalls, reply: String(j.reply || j.content || '') };
  } catch { return empty; }
}
