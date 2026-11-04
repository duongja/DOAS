import type { AssistantStatusDTO } from '../shared/assistant';

export interface AssistantConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  sessionId: string | null;
  timeoutMs: number;
}

const DEFAULT_BASE_URL = 'https://opencode.ai/zen/v1';
const DEFAULT_MODEL = 'deepseek-v4.1-flash';
const DEFAULT_TIMEOUT_MS = 60_000;

export function getAssistantConfig(): AssistantConfig | null {
  const apiKey = process.env.OPENCODE_API_KEY?.trim();
  if (!apiKey) return null;

  const baseUrl = (process.env.OPENCODE_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(
    /\/+$/,
    '',
  );
  const model = process.env.OPENCODE_MODEL?.trim() || DEFAULT_MODEL;
  const sessionId = process.env.OPENCODE_SESSION_ID?.trim() || null;
  const configuredTimeout = Number(process.env.OPENCODE_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);
  const timeoutMs =
    Number.isFinite(configuredTimeout) && configuredTimeout > 0
      ? Math.min(configuredTimeout, 180_000)
      : DEFAULT_TIMEOUT_MS;

  return { apiKey, baseUrl, model, sessionId, timeoutMs };
}

export function getAssistantStatus(): AssistantStatusDTO {
  const config = getAssistantConfig();
  return {
    configured: config !== null,
    model: config?.model ?? (process.env.OPENCODE_MODEL?.trim() || DEFAULT_MODEL),
    baseUrl: config?.baseUrl ?? (process.env.OPENCODE_BASE_URL?.trim() || DEFAULT_BASE_URL),
  };
}
