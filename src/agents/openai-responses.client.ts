/**
 * Azure OpenAI Responses API Client
 *
 * A client for Azure OpenAI Responses API that supports:
 * - Streaming responses
 * - Non-streaming responses (for JSON mode)
 * - Proper error handling
 *
 * Uses the Azure OpenAI Responses API endpoint format:
 * https://{resource}.openai.azure.com/openai/responses?api-version=2025-04-01-preview
 */

export interface ResponsesApiConfig {
  endpoint?: string;
  apiKey?: string;
  model?: string;
  apiVersion?: string;
}

export interface StreamOptions {
  messages: Array<{ role: string; content: string }>;
  maxTokens?: number;
  temperature?: number;
  systemPrompt?: string;
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
 * Azure OpenAI Responses API Client
 *
 * Uses the native Responses API endpoint with api-key authentication
 */
export class OpenAIResponsesClient {
  private endpoint: string | null = null;
  private apiKey: string | null = null;
  private model: string | null = null;
  private apiVersion: string = '2025-04-01-preview';
  private initialized = false;
  private config?: ResponsesApiConfig;

  constructor(config?: ResponsesApiConfig) {
    this.config = config;
  }

  private ensureInitialized(): void {
    if (this.initialized) return;

    // Support both old and new env var names
    this.endpoint =
      this.config?.endpoint || process.env.AZURE_OPENAI_RESPONSES_ENDPOINT || process.env.AZURE_OPENAI_API_BASE_URL;
    this.apiKey = this.config?.apiKey || process.env.AZURE_OPENAI_API_KEY;
    this.model = this.config?.model || process.env.AZURE_OPENAI_API_DEPLOYMENT_NAME || 'gpt-5.1';
    this.apiVersion = this.config?.apiVersion || process.env.AZURE_OPENAI_API_VERSION || '2025-04-01-preview';

    if (this.endpoint && this.apiKey) {
      console.log(`[OpenAIResponsesClient] Initialized with endpoint: ${this.endpoint}, model: ${this.model}`);
    } else {
      console.warn(
        `[OpenAIResponsesClient] Not configured - endpoint: ${this.endpoint ? 'SET' : 'MISSING'}, apiKey: ${
          this.apiKey ? 'SET' : 'MISSING'
        }`,
      );
    }

    this.initialized = true;
  }

  isConfigured(): boolean {
    this.ensureInitialized();
    return this.endpoint !== null && this.apiKey !== null;
  }

  getModel(): string {
    this.ensureInitialized();
    return this.model || 'gpt-5.1';
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
   * Stream a chat completion response using Responses API
   */
  async *stream(options: StreamOptions): AsyncGenerator<StreamChunk> {
    this.ensureInitialized();

    if (!this.endpoint || !this.apiKey) {
      yield {
        type: 'error',
        error: 'OpenAI client not configured. Check AZURE_OPENAI_RESPONSES_ENDPOINT and AZURE_OPENAI_API_KEY',
      };
      return;
    }

    try {
      const url = this.getApiUrl();
      const input = this.convertToResponsesInput(options.messages);

      console.log(`[OpenAIResponsesClient] Streaming from: ${url}`);

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
   * Get a complete chat completion response (non-streaming)
   * Useful for JSON mode responses
   */
  async complete(options: CompletionOptions): Promise<string> {
    this.ensureInitialized();

    if (!this.endpoint || !this.apiKey) {
      throw new Error('OpenAI client not configured. Check AZURE_OPENAI_RESPONSES_ENDPOINT and AZURE_OPENAI_API_KEY');
    }

    const url = this.getApiUrl();
    const input = this.convertToResponsesInput(options.messages);

    console.log(`[OpenAIResponsesClient] Completing from: ${url}`);

    const response = await fetch(url, {
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
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Azure OpenAI API error: ${response.status} - ${errorText}`);
    }

    const result = await response.json();

    // Extract text from Responses API output format
    const output = result.output?.[0]?.content?.[0]?.text || '';
    return output;
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
