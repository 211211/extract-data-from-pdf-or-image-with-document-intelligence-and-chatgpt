/**
 * Multi-Provider LLM Client
 *
 * Supports multiple LLM providers:
 * - Azure OpenAI Responses API (production)
 * - Ollama (local development, free)
 * - Mock mode (testing, no LLM calls)
 *
 * Provider selection via LLM_PROVIDER env var: 'azure' | 'ollama' | 'mock'
 */

export type LLMProvider = 'azure' | 'ollama' | 'mock';

export interface ResponsesApiConfig {
  provider?: LLMProvider;
  endpoint?: string;
  apiKey?: string;
  model?: string;
  apiVersion?: string;
  // Ollama specific
  ollamaUrl?: string;
  ollamaModel?: string;
  // Mock specific
  mockDelayMs?: number;
}

export interface StreamOptions {
  messages: Array<{ role: string; content: string }>;
  maxTokens?: number;
  temperature?: number;
  systemPrompt?: string;
  /** Request timeout in milliseconds (default: 30000 for complete, 60000 for stream) */
  timeout?: number;
}

export interface CompletionOptions extends StreamOptions {
  jsonMode?: boolean;
}

export interface StreamChunk {
  type: 'content' | 'done' | 'error';
  content?: string;
  error?: string;
}

interface ResponseInputItem {
  role: 'developer' | 'user' | 'assistant';
  content: Array<{ type: 'input_text'; text: string }>;
}

/**
 * Multi-Provider LLM Client
 *
 * Supports Azure OpenAI, Ollama (local), and Mock mode
 */
export class OpenAIResponsesClient {
  private provider: LLMProvider = 'azure';
  private endpoint: string | null = null;
  private apiKey: string | null = null;
  private model: string | null = null;
  private apiVersion: string = '2025-04-01-preview';
  // Ollama config
  private ollamaUrl: string = 'http://localhost:11434';
  private ollamaModel: string = 'phi3:mini';
  // Mock config
  private mockDelayMs: number = 50;

  private initialized = false;
  private config?: ResponsesApiConfig;

  constructor(config?: ResponsesApiConfig) {
    this.config = config;
  }

  private ensureInitialized(): void {
    if (this.initialized) return;

    // Determine provider
    const providerEnv = process.env.LLM_PROVIDER?.toLowerCase() as LLMProvider | undefined;
    this.provider = this.config?.provider || providerEnv || 'azure';

    // Mock mode shortcut
    if (process.env.LLM_MOCK_MODE === 'true') {
      this.provider = 'mock';
    }

    // Azure OpenAI config
    this.endpoint =
      this.config?.endpoint || process.env.AZURE_OPENAI_RESPONSES_ENDPOINT || process.env.AZURE_OPENAI_API_BASE_URL;
    this.apiKey = this.config?.apiKey || process.env.AZURE_OPENAI_API_KEY;
    this.model = this.config?.model || process.env.AZURE_OPENAI_API_DEPLOYMENT_NAME || 'gpt-5.1';
    this.apiVersion = this.config?.apiVersion || process.env.AZURE_OPENAI_API_VERSION || '2025-04-01-preview';

    // Ollama config
    this.ollamaUrl = this.config?.ollamaUrl || process.env.OLLAMA_URL || 'http://localhost:11434';
    this.ollamaModel = this.config?.ollamaModel || process.env.OLLAMA_MODEL || 'phi3:mini';

    // Mock config
    this.mockDelayMs = this.config?.mockDelayMs || parseInt(process.env.LLM_MOCK_DELAY_MS || '50', 10);

    console.log(`[LLMClient] Provider: ${this.provider}`);
    if (this.provider === 'azure') {
      console.log(`[LLMClient] Azure endpoint: ${this.endpoint}, model: ${this.model}`);
    } else if (this.provider === 'ollama') {
      console.log(`[LLMClient] Ollama URL: ${this.ollamaUrl}, model: ${this.ollamaModel}`);
    } else {
      console.log(`[LLMClient] Mock mode enabled (delay: ${this.mockDelayMs}ms)`);
    }

    this.initialized = true;
  }

  isConfigured(): boolean {
    this.ensureInitialized();
    if (this.provider === 'mock') return true;
    if (this.provider === 'ollama') return true;
    return this.endpoint !== null && this.apiKey !== null;
  }

  getModel(): string {
    this.ensureInitialized();
    if (this.provider === 'ollama') return this.ollamaModel;
    if (this.provider === 'mock') return 'mock-model';
    return this.model || 'gpt-5.1';
  }

  getProvider(): LLMProvider {
    this.ensureInitialized();
    return this.provider;
  }

  /**
   * Build the Responses API URL
   */
  private getApiUrl(): string {
    // Handle different endpoint formats
    let baseUrl = this.endpoint!;

    // If endpoint already contains /openai/responses, use as-is
    if (baseUrl.includes('/openai/responses')) {
      if (!baseUrl.includes('api-version')) {
        baseUrl += `?api-version=${this.apiVersion}`;
      }
      return baseUrl;
    }

    // If endpoint ends with /openai/v1/, convert to responses API
    if (baseUrl.endsWith('/openai/v1/') || baseUrl.endsWith('/openai/v1')) {
      baseUrl = baseUrl.replace(/\/openai\/v1\/?$/, '');
    }

    // Remove trailing slash
    baseUrl = baseUrl.replace(/\/$/, '');

    // Build responses API URL
    return `${baseUrl}/openai/responses?api-version=${this.apiVersion}`;
  }

  /**
   * Convert messages to Responses API input format
   */
  private convertToResponsesInput(messages: Array<{ role: string; content: string }>): ResponseInputItem[] {
    return messages.map((msg) => ({
      role: msg.role === 'system' ? 'developer' : (msg.role as 'user' | 'assistant'),
      content: [{ type: 'input_text' as const, text: msg.content }],
    }));
  }

  /**
   * Stream a chat completion response
   * Routes to appropriate provider based on configuration
   */
  async *stream(options: StreamOptions): AsyncGenerator<StreamChunk> {
    this.ensureInitialized();

    switch (this.provider) {
      case 'mock':
        yield* this.streamMock(options);
        break;
      case 'ollama':
        yield* this.streamOllama(options);
        break;
      case 'azure':
      default:
        yield* this.streamAzure(options);
        break;
    }
  }

  /**
   * Stream from Azure OpenAI Responses API
   */
  private async *streamAzure(options: StreamOptions): AsyncGenerator<StreamChunk> {
    if (!this.endpoint || !this.apiKey) {
      yield {
        type: 'error',
        error: 'Azure OpenAI not configured. Check AZURE_OPENAI_API_BASE_URL and AZURE_OPENAI_API_KEY',
      };
      return;
    }

    try {
      const url = this.getApiUrl();
      const input = this.convertToResponsesInput(options.messages);

      console.log(`[LLMClient] Azure streaming from: ${url}`);

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'api-key': this.apiKey,
        },
        body: JSON.stringify({
          model: this.model,
          input,
          stream: true,
          max_output_tokens: options.maxTokens || 4096,
          temperature: options.temperature ?? 0.7,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Azure OpenAI API error: ${response.status} - ${errorText}`);
      }

      // Process SSE stream
      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('No response body');
      }

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6).trim();
            if (data === '[DONE]') continue;

            try {
              const event = JSON.parse(data);
              // Handle different event types from Responses API
              if (event.type === 'response.output_text.delta' && event.delta) {
                yield { type: 'content', content: event.delta };
              } else if (event.type === 'response.content_part.delta' && event.delta?.text) {
                yield { type: 'content', content: event.delta.text };
              }
            } catch {
              // Skip invalid JSON lines
            }
          }
        }
      }

      yield { type: 'done' };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      yield { type: 'error', error: message };
    }
  }

  /**
   * Stream from Ollama (local LLM)
   */
  private async *streamOllama(options: StreamOptions): AsyncGenerator<StreamChunk> {
    try {
      const url = `${this.ollamaUrl}/api/chat`;
      console.log(`[LLMClient] Ollama streaming from: ${url}`);

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.ollamaModel,
          messages: options.messages.map((m) => ({
            role: m.role === 'developer' ? 'system' : m.role,
            content: m.content,
          })),
          stream: true,
          options: {
            temperature: options.temperature ?? 0.7,
            num_predict: options.maxTokens || 4096,
          },
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Ollama API error: ${response.status} - ${errorText}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('No response body');
      }

      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const lines = decoder.decode(value).split('\n').filter(Boolean);
        for (const line of lines) {
          try {
            const json = JSON.parse(line);
            if (json.message?.content) {
              yield { type: 'content', content: json.message.content };
            }
            if (json.done) {
              yield { type: 'done' };
              return;
            }
          } catch {
            // Skip invalid JSON
          }
        }
      }

      yield { type: 'done' };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      yield { type: 'error', error: message };
    }
  }

  /**
   * Stream mock responses (for testing without LLM)
   */
  private async *streamMock(options: StreamOptions): AsyncGenerator<StreamChunk> {
    const lastMessage = options.messages[options.messages.length - 1]?.content || '';
    const mockResponse = this.generateMockResponse(lastMessage);

    console.log(`[LLMClient] Mock streaming response`);

    // Simulate realistic token-by-token streaming
    const words = mockResponse.split(' ');
    for (const word of words) {
      await this.delay(this.mockDelayMs);
      yield { type: 'content', content: word + ' ' };
    }

    yield { type: 'done' };
  }

  /**
   * Generate context-aware mock response
   */
  private generateMockResponse(input: string): string {
    const lowerInput = input.toLowerCase();

    // JSON responses for agents expecting structured output
    if (lowerInput.includes('plan') || lowerInput.includes('steps')) {
      return JSON.stringify({
        steps: ['Analyze the request', 'Research relevant information', 'Generate comprehensive response'],
        complexity: 'medium',
        requiresResearch: true,
        summary: 'Mock execution plan for testing',
      });
    }

    if (lowerInput.includes('research') || lowerInput.includes('findings')) {
      return JSON.stringify({
        findings: ['Mock finding 1: System is operational', 'Mock finding 2: All tests passing'],
        sources: ['internal-docs', 'test-fixtures'],
        confidence: 0.85,
      });
    }

    // Default conversational response
    return (
      `This is a mock response to your query. ` +
      `The system is running in mock mode (LLM_PROVIDER=mock) to avoid API costs during development. ` +
      `Your input was: "${input.substring(0, 100)}${input.length > 100 ? '...' : ''}" ` +
      `To use a real LLM, set LLM_PROVIDER=ollama for local or LLM_PROVIDER=azure for production.`
    );
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Create a fetch request with timeout support
   */
  private async fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        ...init,
        signal: controller.signal,
      });
      return response;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`Request timed out after ${timeoutMs}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Get a complete chat completion response (non-streaming)
   * Routes to appropriate provider
   */
  async complete(options: CompletionOptions): Promise<string> {
    this.ensureInitialized();

    switch (this.provider) {
      case 'mock':
        return this.completeMock(options);
      case 'ollama':
        return this.completeOllama(options);
      case 'azure':
      default:
        return this.completeAzure(options);
    }
  }

  private async completeAzure(options: CompletionOptions): Promise<string> {
    if (!this.endpoint || !this.apiKey) {
      throw new Error('Azure OpenAI not configured. Check AZURE_OPENAI_API_BASE_URL and AZURE_OPENAI_API_KEY');
    }

    const url = this.getApiUrl();
    const input = this.convertToResponsesInput(options.messages);
    const timeoutMs = options.timeout || 30000; // Default 30 second timeout for completions

    console.log(`[LLMClient] Azure completing from: ${url} (timeout: ${timeoutMs}ms)`);

    const response = await this.fetchWithTimeout(
      url,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'api-key': this.apiKey,
        },
        body: JSON.stringify({
          model: this.model,
          input,
          stream: false,
          max_output_tokens: options.maxTokens || 4096,
          temperature: options.temperature ?? 0.7,
          text: options.jsonMode ? { format: { type: 'json_object' } } : { format: { type: 'text' } },
        }),
      },
      timeoutMs,
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Azure OpenAI API error: ${response.status} - ${errorText}`);
    }

    const result = await response.json();
    return result.output?.[0]?.content?.[0]?.text || '';
  }

  private async completeOllama(options: CompletionOptions): Promise<string> {
    const url = `${this.ollamaUrl}/api/chat`;
    const timeoutMs = options.timeout || 60000; // Default 60 second timeout for local Ollama (can be slower)
    console.log(`[LLMClient] Ollama completing from: ${url} (timeout: ${timeoutMs}ms)`);

    const response = await this.fetchWithTimeout(
      url,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.ollamaModel,
          messages: options.messages.map((m) => ({
            role: m.role === 'developer' ? 'system' : m.role,
            content: m.content,
          })),
          stream: false,
          format: options.jsonMode ? 'json' : undefined,
          options: {
            temperature: options.temperature ?? 0.7,
            num_predict: options.maxTokens || 4096,
          },
        }),
      },
      timeoutMs,
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Ollama API error: ${response.status} - ${errorText}`);
    }

    const result = await response.json();
    return result.message?.content || '';
  }

  private async completeMock(options: CompletionOptions): Promise<string> {
    const lastMessage = options.messages[options.messages.length - 1]?.content || '';
    await this.delay(this.mockDelayMs * 5); // Simulate processing time
    return this.generateMockResponse(lastMessage);
  }
}

/**
 * Singleton instance for shared use
 */
let sharedClient: OpenAIResponsesClient | null = null;

export function getOpenAIClient(): OpenAIResponsesClient {
  if (!sharedClient) {
    sharedClient = new OpenAIResponsesClient();
  }
  return sharedClient;
}

/**
 * Reset the shared client (useful for testing or reconfiguration)
 */
export function resetOpenAIClient(): void {
  sharedClient = null;
}
