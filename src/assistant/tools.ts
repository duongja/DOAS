import { Types } from 'mongoose';
import { formatImpact } from '../lib/format';
import {
  DeliverableServiceError,
  createDeliverable,
  listDeliverables,
  updateDeliverable,
} from '../services/deliverable-service';
import {
  MissionServiceError,
  createGoal,
  fileDeployment,
  getDashboard,
  listGoals,
  searchLogs,
} from '../services/mission-service';
import {
  MemoryServiceError,
  captureSource,
  getMemoryHealth,
  getMemoryPage,
  getSource,
  listMemoryPages,
  listSources,
  searchMemory,
  upsertMemoryPage,
} from '../services/memory-service';
import type { AssistantAction } from '../shared/assistant';
import type { UpdateDeliverableRequest } from '../shared/types';
import type { LlmToolDefinition } from './llm';

export interface ToolExecutionResult {
  data: Record<string, unknown>;
  action?: AssistantAction;
}

type ToolName =
  | 'list_goals'
  | 'create_goal'
  | 'log_debrief'
  | 'plan_deliverable'
  | 'list_deliverables'
  | 'complete_deliverable'
  | 'update_deliverable'
  | 'get_dashboard'
  | 'search_logs'
  | 'save_memory'
  | 'search_memory'
  | 'read_memory_page'
  | 'list_memory_pages'
  | 'capture_source'
  | 'list_sources'
  | 'read_source'
  | 'memory_health';

class ToolInputError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(issues.join(' '));
    this.name = 'ToolInputError';
    this.issues = issues;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseArguments(raw: unknown): Record<string, unknown> {
  if (raw === undefined || raw === null || raw === '') return {};
  if (isRecord(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      const parsed: unknown = JSON.parse(raw);
      return isRecord(parsed) ? parsed : {};
    } catch {
      throw new ToolInputError(['Tool arguments must be valid JSON.']);
    }
  }
  throw new ToolInputError(['Tool arguments must be a JSON object.']);
}

function requiredString(
  args: Record<string, unknown>,
  key: string,
  min: number,
  max: number,
): string {
  const value = args[key];
  if (typeof value !== 'string') {
    throw new ToolInputError([`${key} must be a string.`]);
  }
  const trimmed = value.trim();
  if (trimmed.length < min || trimmed.length > max) {
    throw new ToolInputError([`${key} must be ${min}–${max} characters.`]);
  }
  return trimmed;
}

function optionalString(
  args: Record<string, unknown>,
  key: string,
  max: number,
): string | undefined {
  const value = args[key];
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') {
    throw new ToolInputError([`${key} must be a string.`]);
  }
  const trimmed = value.trim();
  if (trimmed.length > max) {
    throw new ToolInputError([`${key} cannot exceed ${max} characters.`]);
  }
  return trimmed || undefined;
}

function requiredNumber(
  args: Record<string, unknown>,
  key: string,
  min: number,
  max: number,
): number {
  const raw = args[key];
  const value = typeof raw === 'string' ? Number(raw) : raw;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new ToolInputError([`${key} must be a number between ${min} and ${max}.`]);
  }
  return value;
}

function requiredInteger(
  args: Record<string, unknown>,
  key: string,
  min: number,
  max: number,
): number {
  const value = requiredNumber(args, key, min, max);
  return Math.round(value);
}

function requiredBoolean(args: Record<string, unknown>, key: string): boolean {
  const value = args[key];
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new ToolInputError([`${key} must be a boolean.`]);
}

function optionalStringArray(
  args: Record<string, unknown>,
  key: string,
  maxItems: number,
): string[] {
  const value = args[key];
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new ToolInputError([`${key} must be an array of strings.`]);
  }
  const items = value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (items.length !== value.length) {
    throw new ToolInputError([`${key} must contain only strings.`]);
  }
  if (items.length > maxItems) {
    throw new ToolInputError([`${key} cannot contain more than ${maxItems} items.`]);
  }
  return [...new Set(items)];
}

function optionalLimit(args: Record<string, unknown>, fallback: number, max = 50): number {
  const raw = args.limit;
  if (raw === undefined || raw === null) return fallback;
  const value = typeof raw === 'string' ? Number(raw) : raw;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ToolInputError(['limit must be a number.']);
  }
  return Math.min(Math.max(Math.round(value), 1), max);
}

export const ASSISTANT_TOOLS: LlmToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'list_goals',
      description:
        'List the user’s objectives with IDs, movable metrics, and wall behaviors. Call this before logging if you are not certain which goal fits.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_goal',
      description:
        'Create a new strategic objective. Use only when the user clearly wants a new goal. A goal needs a title, one exact movable metric, and optional immovable wall behaviors.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Short objective title.' },
          movableObject: {
            type: 'string',
            description: 'The exact target metric that should move, e.g. “Manuscript words drafted”.',
          },
          immovableWallBehaviors: {
            type: 'array',
            items: { type: 'string' },
            description:
              'Busywork patterns that feel productive but do not move the metric, e.g. “Inbox zero”.',
          },
        },
        required: ['title', 'movableObject'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'log_debrief',
      description:
        'File a completed work block. Raw inputs only. The server computes alignment, impact, burnout, and strategic feedback. Use this whenever the user reports what they did.',
      parameters: {
        type: 'object',
        properties: {
          goalId: { type: 'string', description: 'ID of the objective from list_goals or context.' },
          description: {
            type: 'string',
            description: 'What the user actually did. Be specific about the action.',
          },
          duration: { type: 'number', description: 'Minutes spent, 0–1440.' },
          effort: { type: 'integer', description: 'Energy/force on a 1–10 scale.', minimum: 1, maximum: 10 },
          progress: {
            type: 'boolean',
            description: 'True only if the objective’s target metric measurably moved.',
          },
        },
        required: ['goalId', 'description', 'duration', 'effort', 'progress'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_dashboard',
      description:
        'Read cumulative impact, active alerts, burnout flags, displacement rate, and daily metrics.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_logs',
      description:
        'Search or list recent debriefs. Use for questions about history, patterns, or what was logged.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Optional text to match.' },
          goalId: { type: 'string', description: 'Optional objective ID filter.' },
          limit: { type: 'integer', description: '1–50, default 15.' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'plan_deliverable',
      description:
        'Add a dated outcome to the user’s plan/sprint. Use this when the user asks to plan today, this week, this month, or a specific date. plannedDate must be YYYY-MM-DD.',
      parameters: {
        type: 'object',
        properties: {
          goalId: { type: 'string', description: 'Objective ID from list_goals or context.' },
          title: { type: 'string', description: 'The concrete outcome to deliver.' },
          plannedDate: { type: 'string', description: 'Local calendar date, YYYY-MM-DD.' },
          details: { type: 'string', description: 'Optional notes or definition of done.' },
        },
        required: ['goalId', 'title', 'plannedDate'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_deliverables',
      description:
        'List planned and delivered outcomes, optionally filtered by date range and objective. Use before answering what is planned for today, this week, or this month.',
      parameters: {
        type: 'object',
        properties: {
          from: { type: 'string', description: 'Optional start date, YYYY-MM-DD.' },
          to: { type: 'string', description: 'Optional end date, YYYY-MM-DD.' },
          goalId: { type: 'string', description: 'Optional objective ID.' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'complete_deliverable',
      description: 'Mark a planned deliverable as delivered.',
      parameters: {
        type: 'object',
        properties: {
          deliverableId: { type: 'string', description: 'ID from list_deliverables.' },
        },
        required: ['deliverableId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_deliverable',
      description:
        'Reschedule, rename, edit details, or change the status of a deliverable. Use complete_deliverable for the normal completion flow.',
      parameters: {
        type: 'object',
        properties: {
          deliverableId: { type: 'string', description: 'Deliverable ID.' },
          title: { type: 'string' },
          details: { type: 'string' },
          plannedDate: { type: 'string', description: 'YYYY-MM-DD.' },
          status: { type: 'string', enum: ['planned', 'delivered'] },
        },
        required: ['deliverableId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'save_memory',
      description:
        'Create or update a durable markdown page in the user’s second brain. Use for ideas, decisions, plans, summaries, research, and filed answers. Pass slug when updating an existing page.',
      parameters: {
        type: 'object',
        properties: {
          slug: {
            type: 'string',
            description: 'Kebab-case page identifier. Omit to derive it from the title.',
          },
          title: { type: 'string', description: 'Page title.' },
          summary: { type: 'string', description: 'One or two sentence summary for the memory index.' },
          markdown: { type: 'string', description: 'The full markdown page body.' },
          tags: { type: 'array', items: { type: 'string' }, description: 'Topic tags.' },
          links: {
            type: 'array',
            items: { type: 'string' },
            description: 'Slugs of related pages. Use for wikilinks/backlinks.',
          },
          sourceIds: {
            type: 'array',
            items: { type: 'string' },
            description: 'IDs returned by capture_source.',
          },
        },
        required: ['title', 'markdown'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_memory',
      description:
        'Search the second brain by keyword. Call before answering questions about past context, decisions, plans, or earlier research.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Keyword or phrase to find.' },
          limit: { type: 'integer', description: '1–30, default 8.' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_memory_page',
      description: 'Read a full markdown memory page by slug, including backlinks.',
      parameters: {
        type: 'object',
        properties: {
          slug: { type: 'string', description: 'Page slug.' },
        },
        required: ['slug'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_memory_pages',
      description: 'List recently updated memory pages with summaries.',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'integer', description: '1–100, default 30.' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'capture_source',
      description:
        'Store raw source material in the second brain before distilling it into a wiki page. Use for pasted articles, notes, transcripts, or links.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Source title.' },
          markdown: { type: 'string', description: 'Raw source content as markdown or plain text.' },
          url: { type: 'string', description: 'Optional original URL.' },
          tags: { type: 'array', items: { type: 'string' }, description: 'Topic tags.' },
        },
        required: ['title', 'markdown'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_sources',
      description: 'List recently captured raw sources, with IDs, titles, URLs, and tags.',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'integer', description: '1–50, default 20.' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_source',
      description:
        'Read the raw text of a captured source by ID. Use when verifying or revisiting original material.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Source ID from capture_source or list_sources.' },
        },
        required: ['id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'memory_health',
      description:
        'Run a lightweight health check on the second brain: totals, orphan pages, and pages missing summaries.',
      parameters: { type: 'object', properties: {} },
    },
  },
];

function success(data: Record<string, unknown>, action?: AssistantAction): ToolExecutionResult {
  return { data: { ok: true, ...data }, action };
}

async function runTool(
  name: ToolName,
  args: Record<string, unknown>,
): Promise<ToolExecutionResult> {
  switch (name) {
    case 'list_goals': {
      const goals = await listGoals();
      return success({ count: goals.length, goals });
    }

    case 'create_goal': {
      const title = requiredString(args, 'title', 2, 120);
      const movableObject = requiredString(args, 'movableObject', 2, 200);
      const immovableWallBehaviors = optionalStringArray(args, 'immovableWallBehaviors', 50);
      const goal = await createGoal({ title, movableObject, immovableWallBehaviors });
      return success({ goal }, {
        tool: 'create_goal',
        label: 'Objective created',
        detail: goal.title,
      });
    }

    case 'log_debrief': {
      const goalId = requiredString(args, 'goalId', 1, 100);
      if (!Types.ObjectId.isValid(goalId)) {
        throw new ToolInputError(['goalId must be a valid MongoDB ObjectId.']);
      }
      const description = requiredString(args, 'description', 3, 1000);
      const duration = requiredNumber(args, 'duration', 0, 1440);
      const effort = requiredInteger(args, 'effort', 1, 10);
      const progress = requiredBoolean(args, 'progress');
      const log = await fileDeployment({ goalId, description, duration, effort, progress });
      return success(
        {
          log: {
            id: log.id,
            goalId: log.goalId,
            goalTitle: log.goalTitle,
            calculatedAlignment: log.calculatedAlignment,
            calculatedImpact: log.calculatedImpact,
            alignmentType: log.alignmentType,
            impactBand: log.impactBand,
            progress: log.progress,
            strategicFeedback: log.strategicFeedback,
            tacticalHeadline: log.tacticalHeadline,
            burnoutWarning: log.burnoutWarning,
            formula: log.formula,
            timestamp: log.timestamp,
          },
        },
        {
          tool: 'log_debrief',
          label: 'Debrief filed',
          detail: `${formatImpact(log.calculatedImpact)} impact · ${log.goalTitle}`,
        },
      );
    }

    case 'plan_deliverable': {
      const goalId = requiredString(args, 'goalId', 1, 100);
      if (!Types.ObjectId.isValid(goalId)) {
        throw new ToolInputError(['goalId must be a valid MongoDB ObjectId.']);
      }
      const title = requiredString(args, 'title', 1, 160);
      const plannedDate = requiredString(args, 'plannedDate', 10, 10);
      const details = optionalString(args, 'details', 1000);
      const deliverable = await createDeliverable({
        goalId,
        title,
        plannedDate,
        details,
      });
      return success({ deliverable }, {
        tool: 'plan_deliverable',
        label: 'Deliverable planned',
        detail: `${deliverable.title} · ${deliverable.plannedDate}`,
      });
    }

    case 'list_deliverables': {
      const from = optionalString(args, 'from', 10);
      const to = optionalString(args, 'to', 10);
      const goalId = optionalString(args, 'goalId', 100);
      const deliverables = await listDeliverables({ from, to, goalId });
      return success({ count: deliverables.length, deliverables });
    }

    case 'complete_deliverable': {
      const deliverableId = requiredString(args, 'deliverableId', 1, 100);
      const deliverable = await updateDeliverable(deliverableId, {
        status: 'delivered',
      });
      return success({ deliverable }, {
        tool: 'complete_deliverable',
        label: 'Deliverable completed',
        detail: deliverable.title,
      });
    }

    case 'update_deliverable': {
      const deliverableId = requiredString(args, 'deliverableId', 1, 100);
      const patch: UpdateDeliverableRequest = {};
      const title = optionalString(args, 'title', 160);
      const details = optionalString(args, 'details', 1000);
      const plannedDate = optionalString(args, 'plannedDate', 10);
      const status = args.status;

      if (title !== undefined) patch.title = title;
      if (details !== undefined) patch.details = details;
      if (plannedDate !== undefined) patch.plannedDate = plannedDate;
      if (status === 'planned' || status === 'delivered') patch.status = status;

      if (Object.keys(patch).length === 0) {
        throw new ToolInputError(['Provide at least one field to update.']);
      }

      const deliverable = await updateDeliverable(deliverableId, patch);
      return success({ deliverable }, {
        tool: 'update_deliverable',
        label: 'Deliverable updated',
        detail: `${deliverable.title} · ${deliverable.plannedDate}`,
      });
    }

    case 'get_dashboard': {
      const dashboard = await getDashboard();
      return success({ dashboard });
    }

    case 'search_logs': {
      const query = optionalString(args, 'query', 200);
      const goalId = optionalString(args, 'goalId', 100);
      if (goalId && !Types.ObjectId.isValid(goalId)) {
        throw new ToolInputError(['goalId must be a valid MongoDB ObjectId.']);
      }
      const limit = optionalLimit(args, 15);
      const logs = await searchLogs(query, goalId, limit);
      return success({ count: logs.length, logs });
    }

    case 'save_memory': {
      const title = requiredString(args, 'title', 2, 160);
      const markdown = requiredString(args, 'markdown', 1, 100_000);
      const slug = optionalString(args, 'slug', 90);
      const summary = optionalString(args, 'summary', 600);
      const tags = optionalStringArray(args, 'tags', 20);
      const links = optionalStringArray(args, 'links', 50);
      const sourceIds = optionalStringArray(args, 'sourceIds', 20);
      const page = await upsertMemoryPage({
        title,
        markdown,
        slug,
        summary,
        tags,
        links,
        sourceIds,
      });
      return success(
        {
          page: {
            slug: page.slug,
            title: page.title,
            summary: page.summary,
            tags: page.tags,
            links: page.links,
            backlinks: page.backlinks,
            updatedAt: page.updatedAt,
          },
        },
        { tool: 'save_memory', label: 'Memory saved', detail: page.title },
      );
    }

    case 'search_memory': {
      const query = requiredString(args, 'query', 1, 200);
      const limit = optionalLimit(args, 8, 30);
      const pages = await searchMemory(query, limit);
      return success({ count: pages.length, pages });
    }

    case 'read_memory_page': {
      const slug = requiredString(args, 'slug', 1, 90);
      const page = await getMemoryPage(slug);
      if (!page) {
        return { data: { ok: false, error: `Memory page “${slug}” was not found.` } };
      }
      const markdown =
        page.markdown.length > 24_000
          ? `${page.markdown.slice(0, 24_000)}\n\n[Page truncated at 24,000 characters.]`
          : page.markdown;
      return success({ page: { ...page, markdown } });
    }

    case 'list_memory_pages': {
      const limit = optionalLimit(args, 30, 100);
      const pages = await listMemoryPages(limit);
      return success({ count: pages.length, pages });
    }

    case 'capture_source': {
      const title = requiredString(args, 'title', 2, 200);
      const markdown = requiredString(args, 'markdown', 1, 80_000);
      const url = optionalString(args, 'url', 2000);
      const tags = optionalStringArray(args, 'tags', 20);
      const source = await captureSource({ title, markdown, url, tags });
      return success({ source }, {
        tool: 'capture_source',
        label: 'Source captured',
        detail: source.title,
      });
    }

    case 'list_sources': {
      const limit = optionalLimit(args, 20, 50);
      const sources = await listSources(limit);
      return success({ count: sources.length, sources });
    }

    case 'read_source': {
      const id = requiredString(args, 'id', 1, 100);
      const source = await getSource(id);
      if (!source) {
        return { data: { ok: false, error: 'Source was not found.' } };
      }
      const markdown =
        source.markdown.length > 24_000
          ? `${source.markdown.slice(0, 24_000)}\n\n[Source truncated at 24,000 characters.]`
          : source.markdown;
      return success({ source: { ...source, markdown } });
    }

    case 'memory_health': {
      const health = await getMemoryHealth();
      return success({ health });
    }

    default:
      return { data: { ok: false, error: `Unknown tool: ${String(name)}` } };
  }
}

export async function executeTool(
  name: string,
  rawArguments: unknown,
): Promise<ToolExecutionResult> {
  const knownTools: readonly ToolName[] = [
    'list_goals',
    'create_goal',
    'log_debrief',
    'plan_deliverable',
    'list_deliverables',
    'complete_deliverable',
    'update_deliverable',
    'get_dashboard',
    'search_logs',
    'save_memory',
    'search_memory',
    'read_memory_page',
    'list_memory_pages',
    'capture_source',
    'list_sources',
    'read_source',
    'memory_health',
  ];

  if (!knownTools.includes(name as ToolName)) {
    return { data: { ok: false, error: `Unknown tool: ${name}` } };
  }

  try {
    const args = parseArguments(rawArguments);
    return await runTool(name as ToolName, args);
  } catch (error) {
    if (error instanceof ToolInputError) {
      return { data: { ok: false, error: error.message } };
    }
    if (error instanceof MissionServiceError || error instanceof MemoryServiceError) {
      return { data: { ok: false, error: error.message } };
    }
    if (error instanceof DeliverableServiceError) {
      return { data: { ok: false, error: error.message } };
    }
    console.error(`[assistant:tool:${name}]`, error);
    return { data: { ok: false, error: 'Tool execution failed.' } };
  }
}
