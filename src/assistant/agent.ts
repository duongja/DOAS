import {
  AssistantMessageModel,
  toChatMessageDTO,
  type AssistantMessageDocument,
} from '../models/knowledge';
import {
  resolveConversation,
  touchConversation,
} from '../services/conversation-service';
import { getDashboard, listGoals } from '../services/mission-service';
import { getMemoryIndex } from '../services/memory-service';
import type {
  AssistantAction,
  AssistantChatResponse,
} from '../shared/assistant';
import { getAssistantConfig, type AssistantConfig } from './config';
import { LlmError, createChatCompletion, type LlmMessage } from './llm';
import { buildSystemPrompt } from './prompt';
import { ASSISTANT_TOOLS, executeTool } from './tools';

const MAX_STEPS = 8;
const MAX_CONTEXT_MESSAGES = 30;
const MAX_MESSAGE_CHARS = 4_000;

export class AssistantUnavailableError extends Error {
  constructor() {
    super('Assistant is not configured. Set OPENCODE_API_KEY in .env and restart the server.');
    this.name = 'AssistantUnavailableError';
  }
}


function buildHistoryForModel(
  messages: AssistantMessageDocument[],
): LlmMessage[] {
  const usable: AssistantMessageDocument[] = [];

  // Only send complete user -> assistant exchanges. Failed turns remain visible
  // in the UI, but are excluded from the model's working context.
  for (let index = 0; index < messages.length; index += 1) {
    const current = messages[index];
    if (!current || current.role !== 'user') continue;
    const next = messages[index + 1];
    if (next && next.role === 'assistant' && !next.error) {
      usable.push(current, next);
      index += 1;
    }
  }

  return usable.slice(-MAX_CONTEXT_MESSAGES).map((message) => ({
    role: message.role,
    content: message.content.slice(0, MAX_MESSAGE_CHARS),
  }));
}

function buildErrorReply(error: unknown, actions: AssistantAction[]): string {
  let reason = 'I hit an internal error while processing that.';

  if (error instanceof LlmError) {
    if (error.status === 401 || error.status === 403) {
      reason =
        'The OpenCode API key was rejected. Check `OPENCODE_API_KEY` and restart the server.';
    } else if (error.status === 429) {
      reason = 'The model gateway is rate limiting requests. Try again in a moment.';
    } else if (error.status === 504) {
      reason = 'The model request timed out before it returned a result.';
    } else if (error.status === 400) {
      reason =
        'The model rejected the request. Check `OPENCODE_MODEL` and `OPENCODE_BASE_URL` in `.env`.';
    } else {
      reason = 'I could not reach the model. Check the API configuration and try again.';
    }
  }

  const actionNote =
    actions.length > 0
      ? `\n\nSome actions did complete: ${actions.map((action) => action.label).join(', ')}.`
      : '';

  return `⚠️ ${reason}${actionNote}`;
}

async function runModelLoop(
  config: AssistantConfig,
  messages: LlmMessage[],
  actions: AssistantAction[],
): Promise<string> {
  const seenCalls = new Set<string>();

  for (let step = 0; step < MAX_STEPS; step += 1) {
    const completion = await createChatCompletion(config, messages, ASSISTANT_TOOLS);

    const toolCalls = completion.toolCalls.map((call, index) => ({
      ...call,
      id: call.id || `call_${step}_${index}_${Date.now().toString(36)}`,
    }));

    if (toolCalls.length === 0) {
      return completion.content?.trim() ?? '';
    }

    messages.push({
      role: 'assistant',
      content: completion.content ?? '',
      tool_calls: toolCalls,
    });

    for (const call of toolCalls) {
      const signature = `${call.function.name}:${call.function.arguments}`;
      let result: Awaited<ReturnType<typeof executeTool>>;

      if (seenCalls.has(signature)) {
        result = {
          data: {
            ok: false,
            error: 'Duplicate tool call ignored. Use the previous result.',
          },
        };
      } else {
        seenCalls.add(signature);
        result = await executeTool(call.function.name, call.function.arguments);
        if (result.action) actions.push(result.action);
      }

      const serialized = JSON.stringify(result.data);
      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content:
          serialized.length > 14_000
            ? `${serialized.slice(0, 14_000)}… [truncated]`
            : serialized,
      });
    }
  }

  return 'I completed several actions but reached my step limit. Ask me to continue and I’ll pick up from here.';
}

/** Run one assistant turn end-to-end. */
export async function runAssistant(
  rawMessage: string,
  options: { conversationId?: string; projectId?: string } = {},
): Promise<AssistantChatResponse> {
  const config = getAssistantConfig();
  if (!config) throw new AssistantUnavailableError();

  const message = rawMessage.trim();
  if (message.length < 1 || message.length > 8_000) {
    throw new Error('Message must be between 1 and 8,000 characters.');
  }

  const { conversation, project } = await resolveConversation({
    conversationId: options.conversationId,
    projectId: options.projectId,
    firstMessage: message,
  });

  const [historyDocs, goals, dashboard, memoryIndex] = await Promise.all([
    AssistantMessageModel.find({ conversationId: conversation._id })
      .sort({ createdAt: -1 })
      .limit(60)
      .exec(),
    listGoals(),
    getDashboard(),
    getMemoryIndex(24),
  ]);

  historyDocs.reverse();

  const userMessage = await AssistantMessageModel.create({
    conversationId: conversation._id,
    role: 'user',
    content: message,
    actions: [],
    error: false,
  });

  const systemPrompt = buildSystemPrompt({
    goals,
    dashboard,
    memoryIndex,
    projectName: project.name,
    now: new Date(),
  });

  const modelMessages: LlmMessage[] = [
    { role: 'system', content: systemPrompt },
    ...buildHistoryForModel(historyDocs),
    { role: 'user', content: message },
  ];

  let content = '';
  const actions: AssistantAction[] = [];
  let error = false;

  try {
    content = await runModelLoop(config, modelMessages, actions);
  } catch (modelError) {
    error = true;
    console.error('[assistant] Model loop failed:', modelError);
    content = buildErrorReply(modelError, actions);
  }

  if (!content.trim()) {
    content =
      actions.length > 0
        ? `Done. I completed ${actions.length} action${actions.length === 1 ? '' : 's'} and updated the record.`
        : 'I’m here. Tell me what you did, what you’re thinking, or what you want to remember.';
  }

  const assistantMessage = await AssistantMessageModel.create({
    conversationId: conversation._id,
    role: 'assistant',
    content,
    actions,
    error,
  });

  const conversationSummary = await touchConversation(conversation, content);

  return {
    conversationId: conversation._id.toString(),
    projectId: project._id.toString(),
    userMessage: toChatMessageDTO(userMessage),
    message: toChatMessageDTO(assistantMessage),
    conversation: conversationSummary,
  };
}

