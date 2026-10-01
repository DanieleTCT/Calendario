import { ProviderConfig, ProviderError } from '@calendario/domain';
import { AiProvider, ProviderSession, ProviderSessionOptions } from './types';

export interface ProviderChainConfig {
  providers: (ProviderConfig | AiProvider)[];
  maxRetries?: number;
  timeout?: number;
}

export class ProviderChain implements AiProvider {
  id = 'chain';
  label = 'Provider Chain (Auto-Fallback)';
  local = false;
  config: ProviderConfig;
  private providers: AiProvider[] = [];
  private cooldowns = new Map<string, number>();
  private maxRetries: number;
  private timeout: number;

  constructor(config: ProviderChainConfig) {
    this.config = {
      id: 'chain',
      type: 'openai-compatible',
      label: this.label,
      enabled: true,
    };

    this.maxRetries = config.maxRetries || 3;
    this.timeout = config.timeout || 30000;

    // Convert configs to providers (in a real app, this would be more sophisticated)
    for (const item of config.providers) {
      if ('isConfigured' in item) {
        this.providers.push(item as AiProvider);
      }
    }
  }

  addProvider(provider: AiProvider): void {
    this.providers.push(provider);
  }

  async isConfigured(): Promise<boolean> {
    for (const provider of this.providers) {
      if (await provider.isConfigured()) {
        return true;
      }
    }
    return false;
  }

  async isOnline(): Promise<boolean> {
    for (const provider of this.providers) {
      if (await provider.isConfigured() && await provider.isOnline()) {
        return true;
      }
    }
    return false;
  }

  async resolveModel(preferred?: string): Promise<string> {
    for (const provider of this.providers) {
      if (await provider.isConfigured()) {
        return await provider.resolveModel(preferred);
      }
    }
    throw new ProviderError('No configured providers available');
  }

  async startSession(options: ProviderSessionOptions): Promise<ProviderSession> {
    return new ChainSession(this.providers, this.cooldowns, this.maxRetries, options);
  }

  async getStatus() {
    const statuses = [];
    for (const provider of this.providers) {
      const status = await provider.getStatus();
      statuses.push({
        id: provider.id,
        provider: provider.label,
        ...status,
      });
    }

    const anyOnline = statuses.some((s) => s.online);
    // Prefer a real (non-demo) online provider for the displayed model
    const real =
      statuses.find((s) => s.online && s.id !== 'demo') ||
      statuses.find((s) => s.configured && s.id !== 'demo') ||
      statuses.find((s) => s.configured);
    const model = real?.model || 'none';

    return {
      online: anyOnline,
      configured: anyOnline,
      model,
    };
  }
}

class ChainSession implements ProviderSession {
  constructor(
    private providers: AiProvider[],
    private cooldowns: Map<string, number>,
    private maxRetries: number,
    private options: ProviderSessionOptions
  ) {}

  async complete(
    messages: Array<{ role: 'user' | 'assistant'; content: string }>
  ): Promise<{ content: string }> {
    let lastError: ProviderError | null = null;

    for (const provider of this.providers) {
      // Check if provider is on cooldown
      if (this.isCoolingDown(provider.id)) {
        continue;
      }

      // Check if provider is configured and online
      if (!(await provider.isConfigured()) || !(await provider.isOnline())) {
        continue;
      }

      try {
        const session = await provider.startSession(this.options);
        const result = await session.complete(messages);
        await session.close();
        return result;
      } catch (error) {
        lastError = error instanceof ProviderError ? error : new ProviderError(String(error));

        // Put provider on cooldown if error is not retryable
        if (!lastError.retryable) {
          this.setCooldown(provider.id, 300000); // 5 minutes
        }
      }
    }

    throw (
      lastError ||
      new ProviderError('No available providers in the chain')
    );
  }

  async stream(
    messages: Array<{ role: 'user' | 'assistant'; content: string }>,
    tools?: any,
    onChunk?: (chunk: string) => void,
    onToolCall?: (toolCall: { name: string; input: Record<string, unknown> }) => void
  ): Promise<{ content: string }> {
    let lastError: ProviderError | null = null;

    for (const provider of this.providers) {
      // Check if provider is on cooldown
      if (this.isCoolingDown(provider.id)) {
        continue;
      }

      // Check if provider is configured and online
      if (!(await provider.isConfigured()) || !(await provider.isOnline())) {
        continue;
      }

      try {
        const session = await provider.startSession(this.options);
        const result = await session.stream(messages, tools, onChunk, onToolCall);
        await session.close();
        return result;
      } catch (error) {
        lastError = error instanceof ProviderError ? error : new ProviderError(String(error));

        // Put provider on cooldown if error is not retryable
        if (!lastError.retryable) {
          this.setCooldown(provider.id, 300000); // 5 minutes
        }
      }
    }

    throw (
      lastError ||
      new ProviderError('No available providers in the chain')
    );
  }

  async close(): Promise<void> {
    // Nothing to do
  }

  private isCoolingDown(providerId: string): boolean {
    const cooldownUntil = this.cooldowns.get(providerId);
    if (!cooldownUntil) return false;
    if (Date.now() > cooldownUntil) {
      this.cooldowns.delete(providerId);
      return false;
    }
    return true;
  }

  private setCooldown(providerId: string, durationMs: number): void {
    this.cooldowns.set(providerId, Date.now() + durationMs);
  }
}
