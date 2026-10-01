import { DemoProvider, GeminiProvider, OpenRouterProvider, OllamaProvider, LocalOpenAIProvider } from '@calendario/agent';

// Risoluzione URL Ollama: env OLLAMA_BASE_URL > impostazioni salvate > default.
// In Docker 'localhost' punta al container stesso: usare host.docker.internal
// (LAN) oppure l'IP Tailscale del PC con Ollama (VPN, es. http://100.x.y.z:11434).
export function resolveOllamaBaseUrl(saved?: string): string {
  const fromEnv = (process.env.OLLAMA_BASE_URL || '').trim();
  if (fromEnv) return fromEnv.replace(/\/$/, '');
  if (saved && saved.trim()) return saved.trim().replace(/\/$/, '');
  return 'http://localhost:11434';
}

export function resolveOllamaModel(saved?: string): string {
  const fromEnv = (process.env.OLLAMA_MODEL || '').trim();
  if (fromEnv) return fromEnv;
  return (saved || '').trim();
}

// Shared helper: build provider list from current settings.
// Called at startup AND after settings update (hot-reload, no restart needed).
export async function buildProviders(repository: any) {
  const settings = await repository.getSettings();
  const providers: any[] = [new DemoProvider()];
  const envGemini = (process.env.GEMINI_API_KEY || '').trim();
  const envOpenRouter = (process.env.OPENROUTER_API_KEY || '').trim();
  const geminiKey = settings.cloudProviders?.gemini?.apiKey || envGemini;
  const openRouterKey = settings.cloudProviders?.openrouter?.apiKey || envOpenRouter;
  if ((settings.cloudProviders?.gemini?.enabled ?? !!envGemini) && geminiKey) {
    providers.push(new GeminiProvider(geminiKey));
  }
  if ((settings.cloudProviders?.openrouter?.enabled ?? !!envOpenRouter) && openRouterKey) {
    providers.push(new OpenRouterProvider(openRouterKey));
  }
  const ollamaModel = resolveOllamaModel(settings.ollama?.model);
  if (ollamaModel) {
    providers.push(new OllamaProvider(resolveOllamaBaseUrl(settings.ollama?.baseUrl), ollamaModel));
  }
  // Provider locale OpenAI-compatibile (Bionic GPT, LM Studio, vLLM...): env > settings salvate.
  const localBase = ((process.env.LOCAL_BASE_URL || (settings as any).local?.baseUrl || '') as string).trim();
  const localModel = ((process.env.LOCAL_MODEL || (settings as any).local?.model || '') as string).trim();
  const localKey = ((process.env.LOCAL_API_KEY || (settings as any).local?.apiKey || '') as string).trim();
  if (localModel || localBase) {
    providers.push(new LocalOpenAIProvider(localBase || 'http://localhost/v1', localModel || undefined, localKey || undefined));
  }
  return { providers, settings };
}

// Ordine di preferenza della catena (modalita 'auto'): Gemini -> OpenRouter -> Locale -> Ollama -> Demo.
export function rankProviders<T extends { id: string }>(providers: T[]): T[] {
  const rank = (id: string) => (id === 'gemini' ? 0 : id === 'openrouter' ? 1 : id === 'local' ? 2 : id === 'ollama' ? 3 : 4);
  return [...providers].sort((a, b) => rank(a.id) - rank(b.id));
}

export function pickProvider(providers: any[], preferred?: string): any | null {
  if (!providers || providers.length === 0) return null;
  const order = preferred && preferred !== 'auto'
    ? [...providers].sort((a, b) => (a.id === preferred ? -1 : b.id === preferred ? 1 : 0))
    : rankProviders(providers);
  return order[0] || null;
}