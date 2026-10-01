import { ProviderConfig } from '@calendario/domain';
import { AiProvider, ProviderSession, ProviderSessionOptions } from '../types';

export class DemoProvider implements AiProvider {
  id = 'demo';
  label = 'Demo Provider (for testing)';
  local = false;
  config: ProviderConfig;

  constructor() {
    this.config = {
      id: 'demo',
      type: 'demo',
      label: this.label,
      enabled: true,
    };
  }

  async isConfigured(): Promise<boolean> {
    return true;
  }

  async isOnline(): Promise<boolean> {
    return true;
  }

  async resolveModel(): Promise<string> {
    return 'demo-model';
  }

  async startSession(options: ProviderSessionOptions): Promise<ProviderSession> {
    return new DemoSession();
  }

  async getStatus() {
    return {
      online: true,
      configured: true,
      model: 'demo-model',
    };
  }
}

class DemoSession implements ProviderSession {
  async complete(
    messages: Array<{ role: 'user' | 'assistant'; content: string }>
  ): Promise<{ content: string }> {
    // Simulate a response based on the last user message
    const lastMessage = messages[messages.length - 1];

    if (!lastMessage || lastMessage.role !== 'user') {
      return { content: 'I did not receive a valid message.' };
    }

    const userInput = lastMessage.content.toLowerCase();

    // Deterministic responses for testing
    if (userInput.includes('create event') || userInput.includes('new event')) {
      return {
        content:
          'I can help you create an event. Let me add a test event to your calendar.',
      };
    }

    if (userInput.includes('find free') || userInput.includes('free time')) {
      return {
        content:
          'I found some free slots tomorrow morning. Would you like me to suggest a meeting time?',
      };
    }

    if (userInput.includes('task') || userInput.includes('todo')) {
      return {
        content:
          'I can help you with your tasks. What would you like to do?',
      };
    }

    return {
      content: `You said: "${userInput}". How can I help with your calendar?`,
    };
  }

  async stream(
    messages: Array<{ role: 'user' | 'assistant'; content: string }>,
    _tools?: any,
    onChunk?: (chunk: string) => void
  ): Promise<{ content: string }> {
    const result = await this.complete(messages);

    if (onChunk) {
      // Simulate streaming by sending chunks
      for (const char of result.content) {
        onChunk(char);
        // Simulate latency
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    }

    return result;
  }

  async close(): Promise<void> {
    // Nothing to do for demo
  }
}
