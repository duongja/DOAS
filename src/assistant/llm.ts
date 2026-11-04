import type { AssistantConfig } from './config';

export interface LlmToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface LlmToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export type LlmRole = 'system' | 'user' | 'assistant' | 'tool';

export interface LlmMessage {
  role: LlmRole;
  content: string | null;
  tool_calls?: LlmToolCall[];
  tool_call_id?: string;
}

export interface LlmResponse {
  content: string | null;
  toolCalls: LlmToolCall[];
  finishReason: string | null;
}

export class LlmError extends Error {
  readonly status: number | null;

  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = 'LlmError';
    this.status = status;
  }
}

interface OpenAiChatResponse {
  choices?: Array<{
    message?: {
      content?: string | null;
      tool_calls?: LlmToolCall[];
    };
    finish_reason?: string;
  }>;
  error?: {
    message?: string;
    type?: string;
  };
}

/**
 * OpenCode Zen exposes an OpenAI-compatible Chat Completions endpoint at
 * `.../v1/chat/completions`. The same shape also works for the Console
 * inference gateway. The API key never leaves the server.
 */
export async function createChatCompletion(
  config: AssistantConfig,
  messages: LlmMessage[],
  tools: LlmToolDefinition[],
): Promise<LlmResponse> {
  const endpoint = config.baseUrl.endsWith('/chat/completions')
    ? config.baseUrl
    : `${config.baseUrl}/chat/completions`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(config.sessionId ? { 'x-opencode-session': config.sessionId } : {}),
      },
      body: JSON.stringify({
        model: config.model,
        messages,
        tools,
        tool_choice: 'auto',
        temperature: 0.2,
        max_tokens: 1800,
        stream: false,
      }),
      signal: controller.signal,
    });

    const raw = await response.text();
    let payload: OpenAiChatResponse | null = null;
    try {
      payload = raw ? (JSON.parse(raw) as OpenAiChatResponse) : null;
    } catch {
      payload = null;
    }

    if (!response.ok) {
      const detail = payload?.error?.message?.slice(0, 500) ?? `HTTP ${response.status}`;
      throw new LlmError(`Model request failed: ${detail}`, response.status);
    }

    const choice = payload?.choices?.[0];
    const message = choice?.message;
    if (!message) {
      throw new LlmError('The model returned an empty response.', response.status);
    }

    return {
      content: typeof message.content === 'string' ? message.content : null,
      toolCalls: Array.isArray(message.tool_calls) ? message.tool_calls : [],
      finishReason: choice?.finish_reason ?? null,
    };
  } catch (error) {
    if (error instanceof LlmError) throw error;
    if (error instanceof Error && error.name === 'AbortError') {
      throw new LlmError('The model request timed out.', 504);
    }
    throw new LlmError(
      error instanceof Error ? error.message : 'The model request failed.',
      null,
    );
  } finally {
    clearTimeout(timeout);
  }
}
