import { ProviderConfig, ToolCall } from '@calendario/domain';

export interface ProviderSessionOptions {
  model?: string;
  maxTokens?: number;
  temperature?: number;
  systemPrompt?: string;
  timeout?: number;
}

export interface ProviderSession {
  complete(
    messages: Array<{ role: 'user' | 'assistant'; content: string }>,
    tools?: ToolCall[]
  ): Promise<{
    content: string;
    toolCalls?: Array<{
      name: string;
      input: Record<string, unknown>;
    }>;
  }>;

  stream(
    messages: Array<{ role: 'user' | 'assistant'; content: string }>,
    tools?: ToolCall[],
    onChunk?: (chunk: string) => void,
    onToolCall?: (toolCall: { name: string; input: Record<string, unknown> }) => void
  ): Promise<{
    content: string;
    toolCalls?: Array<{
      name: string;
      input: Record<string, unknown>;
    }>;
  }>;

  close(): Promise<void>;
}

export interface AiProvider {
  id: string;
  label: string;
  local: boolean;
  config: ProviderConfig;

  isConfigured(): Promise<boolean>;
  isOnline(): Promise<boolean>;
  resolveModel(preferred?: string): Promise<string>;
  startSession(options: ProviderSessionOptions): Promise<ProviderSession>;
  getStatus(): Promise<{
    online: boolean;
    configured: boolean;
    model: string;
    latency?: number;
    error?: string;
  }>;
}

export { DemoProvider } from './providers/demo-provider';
export { GeminiProvider } from './providers/gemini-provider';
export { OpenRouterProvider } from './providers/openrouter-provider';
export { OllamaProvider } from './providers/ollama-provider';
export { ProviderChain } from './provider-chain';
export type { ProviderChainConfig } from './provider-chain';
