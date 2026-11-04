import 'dotenv/config';
import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import mongoose, { Types } from 'mongoose';
import { existsSync } from 'node:fs';
import path from 'node:path';
import {
  AssistantUnavailableError,
  runAssistant,
} from './assistant/agent';
import { getAssistantStatus } from './assistant/config';
import {
  ConversationServiceError,
  createConversation,
  createProject,
  deleteConversation,
  ensureDefaultProjectAndMigrate,
  getAssistantHistory,
  listProjects,
  renameConversation,
} from './services/conversation-service';
import {
  DeliverableServiceError,
  createDeliverable,
  deleteDeliverable,
  listDeliverables,
  updateDeliverable,
} from './services/deliverable-service';
import {
  MemoryServiceError,
  getMemoryHealth,
  getMemoryPage,
  listMemoryPages,
  searchMemory,
} from './services/memory-service';
import {
  MissionServiceError,
  createGoal,
  fileDeployment,
  getDashboard,
  listGoals,
  listLogs,
} from './services/mission-service';
import type {
  AssistantChatResponse,
  AssistantHistoryResponse,
  AssistantStatusDTO,
  ConversationSummaryDTO,
  CreateConversationRequest,
  CreateProjectRequest,
  MemoryListResponse,
  ProjectDTO,
  UpdateConversationRequest,
} from './shared/assistant';
import type {
  ApiErrorResponse,
  CreateDeliverableRequest,
  CreateGoalRequest,
  CreateLogRequest,
  DeliverableDTO,
  GoalDTO,
  LogDTO,
  UpdateDeliverableRequest,
} from './shared/types';

const PORT = Number(process.env.PORT ?? 4000);
const HOST = process.env.HOST?.trim() || '127.0.0.1';
const MONGODB_URI =
  process.env.MONGODB_URI?.trim() || 'mongodb://127.0.0.1:27017/diaries_of_a_soldier';
const NODE_ENV = process.env.NODE_ENV ?? 'development';
const CORS_ORIGINS = (process.env.CORS_ORIGIN ?? 'http://localhost:5173,http://127.0.0.1:5173')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

let databaseReady: Promise<void> | null = null;

mongoose.connection.on('error', (error: unknown) => {
  console.error('[db] MongoDB error:', error);
});

/**
 * Connect once per process and reuse the connection across local requests and
 * Vercel Fluid invocations. The legacy migration runs only after a fresh
 * connection.
 */
export async function ensureDatabase(): Promise<void> {
  if (mongoose.connection.readyState === 1) return;

  if (!databaseReady) {
    mongoose.set('strictQuery', true);
    databaseReady = mongoose
      .connect(MONGODB_URI, {
        serverSelectionTimeoutMS: 10_000,
        maxPoolSize: 10,
      })
      .then(async () => {
        console.info(`[db] Connected to MongoDB: ${mongoose.connection.name}`);
        await ensureDefaultProjectAndMigrate();
      })
      .catch((error: unknown) => {
        databaseReady = null;
        throw error;
      });
  }

  await databaseReady;

  if (Number(mongoose.connection.readyState) !== 1) {
    databaseReady = null;
    throw new Error('MongoDB connection is not ready.');
  }
}

const app = express();

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(
  cors((request, callback) => {
    const origin = request.header('origin');
    let sameOrigin = false;

    if (origin) {
      try {
        sameOrigin = new URL(origin).host === request.get('host');
      } catch {
        sameOrigin = false;
      }
    }

    const allowed =
      !origin ||
      sameOrigin ||
      CORS_ORIGINS.includes('*') ||
      CORS_ORIGINS.includes(origin);

    callback(null, {
      origin: allowed,
      methods: ['GET', 'POST', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Accept'],
      credentials: false,
      maxAge: 86_400,
    });
  }),
);
app.use(express.json({ limit: '1mb' }));

if (NODE_ENV !== 'test') {
  app.use((request, response, next) => {
    if (!request.originalUrl.startsWith('/api')) {
      next();
      return;
    }

    const startedAt = Date.now();
    response.on('finish', () => {
      console.info(
        `[api] ${request.method} ${request.originalUrl} ${response.statusCode} ${Date.now() - startedAt}ms`,
      );
    });
    next();
  });
}

/* ————————————————————————————————————————————————
   Validation
———————————————————————————————————————————————— */

type ValidationResult<T> = { ok: true; value: T } | { ok: false; details: string[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseCreateGoal(body: unknown): ValidationResult<CreateGoalRequest> {
  if (!isRecord(body)) return { ok: false, details: ['Request body must be a JSON object.'] };

  const details: string[] = [];
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  const movableObject =
    typeof body.movableObject === 'string' ? body.movableObject.trim() : '';

  if (title.length < 2) details.push('title must be at least 2 characters.');
  if (title.length > 120) details.push('title cannot exceed 120 characters.');
  if (movableObject.length < 2) details.push('movableObject must be at least 2 characters.');
  if (movableObject.length > 200) details.push('movableObject cannot exceed 200 characters.');

  const walls: string[] = [];
  if (body.immovableWallBehaviors !== undefined) {
    if (!Array.isArray(body.immovableWallBehaviors)) {
      details.push('immovableWallBehaviors must be an array of strings.');
    } else {
      for (const entry of body.immovableWallBehaviors) {
        if (typeof entry !== 'string' || entry.trim().length === 0) {
          details.push('Each immovable wall behavior must be a non-empty string.');
          continue;
        }
        if (entry.trim().length > 160) {
          details.push('Each immovable wall behavior must be 160 characters or fewer.');
          continue;
        }
        walls.push(entry.trim());
      }
    }
  }

  if (walls.length > 50) details.push('A maximum of 50 wall behaviors is supported.');
  if (details.length > 0) return { ok: false, details };

  return {
    ok: true,
    value: {
      title,
      movableObject,
      immovableWallBehaviors: [...new Set(walls)],
    },
  };
}

function parseCreateLog(body: unknown): ValidationResult<CreateLogRequest> {
  if (!isRecord(body)) return { ok: false, details: ['Request body must be a JSON object.'] };

  const details: string[] = [];
  const goalId = typeof body.goalId === 'string' ? body.goalId.trim() : '';
  const description = typeof body.description === 'string' ? body.description.trim() : '';
  const duration = body.duration;
  const effort = body.effort;
  const progress = body.progress;

  if (!Types.ObjectId.isValid(goalId)) details.push('goalId must be a valid MongoDB ObjectId.');
  if (description.length < 3) details.push('description must be at least 3 characters.');
  if (description.length > 1000) details.push('description cannot exceed 1000 characters.');

  if (typeof duration !== 'number' || !Number.isFinite(duration)) {
    details.push('duration must be a number.');
  } else if (duration < 0 || duration > 1440) {
    details.push('duration must be between 0 and 1440 minutes.');
  }

  if (typeof effort !== 'number' || !Number.isInteger(effort)) {
    details.push('effort must be an integer.');
  } else if (effort < 1 || effort > 10) {
    details.push('effort must be between 1 and 10.');
  }

  if (typeof progress !== 'boolean') details.push('progress must be a boolean.');

  if (details.length > 0) return { ok: false, details };

  return {
    ok: true,
    value: {
      goalId,
      description,
      duration: duration as number,
      effort: effort as number,
      progress: progress as boolean,
    },
  };
}

function sendValidationError(response: Response, details: string[]): void {
  const payload: ApiErrorResponse = { error: 'Validation failed.', details };
  response.status(400).json(payload);
}

/* ————————————————————————————————————————————————
   Routes
———————————————————————————————————————————————— */

type AsyncHandler = (
  request: Request,
  response: Response,
  next: NextFunction,
) => Promise<void>;

function asyncHandler(handler: AsyncHandler) {
  return (request: Request, response: Response, next: NextFunction): void => {
    Promise.resolve(handler(request, response, next)).catch(next);
  };
}

app.get('/api/health', (_request: Request, response: Response) => {
  response.json({
    status: 'ok',
    database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    environment: NODE_ENV,
    timestamp: new Date().toISOString(),
  });
});

app.post(
  '/api/goals',
  asyncHandler(async (request: Request, response: Response) => {
    const parsed = parseCreateGoal(request.body);
    if (!parsed.ok) {
      sendValidationError(response, parsed.details);
      return;
    }

    const payload: GoalDTO = await createGoal(parsed.value);
    response.status(201).json(payload);
  }),
);

app.get(
  '/api/goals',
  asyncHandler(async (_request: Request, response: Response) => {
    const payload: GoalDTO[] = await listGoals();
    response.json(payload);
  }),
);

app.post(
  '/api/logs',
  asyncHandler(async (request: Request, response: Response) => {
    const parsed = parseCreateLog(request.body);
    if (!parsed.ok) {
      sendValidationError(response, parsed.details);
      return;
    }

    // The client sends raw deployment inputs only. Alignment, impact, burnout,
    // and tactical feedback are computed in the mission service.
    const payload: LogDTO = await fileDeployment(parsed.value);
    response.status(201).json(payload);
  }),
);

app.get(
  '/api/logs',
  asyncHandler(async (_request: Request, response: Response) => {
    const payload: LogDTO[] = await listLogs();
    response.json(payload);
  }),
);

app.get(
  '/api/deliverables',
  asyncHandler(async (request: Request, response: Response) => {
    const from = typeof request.query.from === 'string' ? request.query.from : undefined;
    const to = typeof request.query.to === 'string' ? request.query.to : undefined;
    const goalId = typeof request.query.goalId === 'string' ? request.query.goalId : undefined;
    const payload: DeliverableDTO[] = await listDeliverables({ from, to, goalId });
    response.json(payload);
  }),
);

app.post(
  '/api/deliverables',
  asyncHandler(async (request: Request, response: Response) => {
    const body = request.body as Partial<CreateDeliverableRequest> | null;
    const goalId = typeof body?.goalId === 'string' ? body.goalId.trim() : '';
    const title = typeof body?.title === 'string' ? body.title.trim() : '';
    const plannedDate =
      typeof body?.plannedDate === 'string' ? body.plannedDate.trim() : '';
    const details = typeof body?.details === 'string' ? body.details : '';

    if (!goalId || !title || !plannedDate) {
      sendValidationError(response, ['goalId, title, and plannedDate are required.']);
      return;
    }

    const payload: DeliverableDTO = await createDeliverable({
      goalId,
      title,
      plannedDate,
      details,
    });
    response.status(201).json(payload);
  }),
);

app.patch(
  '/api/deliverables/:id',
  asyncHandler(async (request: Request, response: Response) => {
    const body = request.body as Partial<UpdateDeliverableRequest> | null;
    const patch: UpdateDeliverableRequest = {};

    if (typeof body?.title === 'string') patch.title = body.title;
    if (typeof body?.details === 'string') patch.details = body.details;
    if (typeof body?.plannedDate === 'string') patch.plannedDate = body.plannedDate;
    if (body?.status === 'planned' || body?.status === 'delivered') {
      patch.status = body.status;
    }

    if (Object.keys(patch).length === 0) {
      sendValidationError(response, ['Provide at least one field to update.']);
      return;
    }

    const payload: DeliverableDTO = await updateDeliverable(
      String(request.params.id ?? ''),
      patch,
    );
    response.json(payload);
  }),
);

app.delete(
  '/api/deliverables/:id',
  asyncHandler(async (request: Request, response: Response) => {
    await deleteDeliverable(String(request.params.id ?? ''));
    response.json({ ok: true });
  }),
);

app.get(
  '/api/dashboard',
  asyncHandler(async (_request: Request, response: Response) => {
    const payload = await getDashboard();
    response.json(payload);
  }),
);

app.get('/api/assistant/status', (_request: Request, response: Response) => {
  const status: AssistantStatusDTO = getAssistantStatus();
  response.json(status);
});

app.get(
  '/api/assistant/history',
  asyncHandler(async (request: Request, response: Response) => {
    const rawLimit = typeof request.query.limit === 'string' ? Number(request.query.limit) : 50;
    const limit = Number.isFinite(rawLimit) ? rawLimit : 50;
    const conversationId =
      typeof request.query.conversationId === 'string'
        ? request.query.conversationId.trim()
        : undefined;
    const payload: AssistantHistoryResponse = await getAssistantHistory(conversationId, limit);
    response.json(payload);
  }),
);

app.get(
  '/api/projects',
  asyncHandler(async (_request: Request, response: Response) => {
    const payload: ProjectDTO[] = await listProjects();
    response.json(payload);
  }),
);

app.post(
  '/api/projects',
  asyncHandler(async (request: Request, response: Response) => {
    const body = request.body as Partial<CreateProjectRequest> | null;
    const name = typeof body?.name === 'string' ? body.name.trim() : '';
    if (name.length < 1 || name.length > 80) {
      sendValidationError(response, ['name must be 1–80 characters.']);
      return;
    }
    const payload: ProjectDTO = await createProject(name);
    response.status(201).json(payload);
  }),
);

app.post(
  '/api/conversations',
  asyncHandler(async (request: Request, response: Response) => {
    const body = request.body as Partial<CreateConversationRequest> | null;
    const projectId = typeof body?.projectId === 'string' ? body.projectId.trim() : '';
    const title = typeof body?.title === 'string' ? body.title.trim() : 'New chat';
    if (!projectId) {
      sendValidationError(response, ['projectId is required.']);
      return;
    }
    const payload: ConversationSummaryDTO = await createConversation(projectId, title);
    response.status(201).json(payload);
  }),
);

app.patch(
  '/api/conversations/:id',
  asyncHandler(async (request: Request, response: Response) => {
    const body = request.body as Partial<UpdateConversationRequest> | null;
    const title = typeof body?.title === 'string' ? body.title.trim() : '';
    const payload: ConversationSummaryDTO = await renameConversation(
      String(request.params.id ?? ''),
      title,
    );
    response.json(payload);
  }),
);

app.delete(
  '/api/conversations/:id',
  asyncHandler(async (request: Request, response: Response) => {
    const payload = await deleteConversation(String(request.params.id ?? ''));
    response.json({ ok: true, ...payload });
  }),
);

app.post(
  '/api/assistant/chat',
  asyncHandler(async (request: Request, response: Response) => {
    const body = request.body as {
      message?: unknown;
      conversationId?: unknown;
      projectId?: unknown;
    } | null;
    const message = typeof body?.message === 'string' ? body.message.trim() : '';
    const conversationId =
      typeof body?.conversationId === 'string' && body.conversationId.trim()
        ? body.conversationId.trim()
        : undefined;
    const projectId =
      typeof body?.projectId === 'string' && body.projectId.trim()
        ? body.projectId.trim()
        : undefined;

    if (message.length < 1 || message.length > 8_000) {
      sendValidationError(response, ['message must be between 1 and 8,000 characters.']);
      return;
    }

    const status = getAssistantStatus();
    if (!status.configured) {
      const payload: ApiErrorResponse = {
        error: 'Assistant is not configured.',
        details: [
          'Set OPENCODE_API_KEY in .env, then restart the API server.',
          'Optional: OPENCODE_MODEL, OPENCODE_BASE_URL.',
        ],
      };
      response.status(503).json(payload);
      return;
    }

    const payload: AssistantChatResponse = await runAssistant(message, {
      conversationId,
      projectId,
    });
    response.json(payload);
  }),
);

app.get(
  '/api/brain/pages',
  asyncHandler(async (request: Request, response: Response) => {
    const query = typeof request.query.q === 'string' ? request.query.q : undefined;
    const rawLimit = typeof request.query.limit === 'string' ? Number(request.query.limit) : 50;
    const limit = Number.isFinite(rawLimit) ? rawLimit : 50;
    const pages = query ? await searchMemory(query, limit) : await listMemoryPages(limit);
    const payload: MemoryListResponse = { pages, total: pages.length };
    response.json(payload);
  }),
);

app.get(
  '/api/brain/health',
  asyncHandler(async (_request: Request, response: Response) => {
    const health = await getMemoryHealth();
    response.json(health);
  }),
);

app.get(
  '/api/brain/pages/:slug',
  asyncHandler(async (request: Request, response: Response) => {
    const slug = String(request.params.slug ?? '');
    const page = await getMemoryPage(slug);
    if (!page) {
      response.status(404).json({ error: 'Memory page not found.' } satisfies ApiErrorResponse);
      return;
    }
    response.json(page);
  }),
);

app.use('/api', (_request, response) => {
  response.status(404).json({ error: 'API route not found.' } satisfies ApiErrorResponse);
});

/* ————————————————————————————————————————————————
   Static client (production build)
———————————————————————————————————————————————— */

const clientDist = path.resolve(process.cwd(), 'dist/client');
if (!process.env.VERCEL && existsSync(path.join(clientDist, 'index.html'))) {
  app.use(express.static(clientDist));
  app.get(/.*/, (_request, response) => {
    response.sendFile(path.join(clientDist, 'index.html'));
  });
}

/* ————————————————————————————————————————————————
   Error handling
———————————————————————————————————————————————— */

app.use((error: unknown, _request: Request, response: Response, next: NextFunction) => {
  if (response.headersSent) {
    next(error);
    return;
  }

  if (error instanceof MissionServiceError) {
    const payload: ApiErrorResponse = { error: error.message };
    response.status(error.status).json(payload);
    return;
  }

  if (error instanceof MemoryServiceError) {
    const payload: ApiErrorResponse = { error: error.message };
    response.status(error.status).json(payload);
    return;
  }

  if (error instanceof DeliverableServiceError) {
    const payload: ApiErrorResponse = { error: error.message };
    response.status(error.status).json(payload);
    return;
  }

  if (error instanceof ConversationServiceError) {
    const payload: ApiErrorResponse = { error: error.message };
    response.status(error.status).json(payload);
    return;
  }

  if (error instanceof AssistantUnavailableError) {
    const payload: ApiErrorResponse = { error: error.message };
    response.status(503).json(payload);
    return;
  }

  if (error instanceof mongoose.Error.ValidationError) {
    const details = Object.values(error.errors).map((entry) => entry.message);
    sendValidationError(response, details);
    return;
  }

  if (error instanceof mongoose.Error.CastError) {
    sendValidationError(response, [`Invalid ${error.path}: ${String(error.value)}`]);
    return;
  }

  if (error instanceof SyntaxError && 'status' in error && error.status === 400) {
    const payload: ApiErrorResponse = { error: 'Malformed JSON body.' };
    response.status(400).json(payload);
    return;
  }

  console.error('[api] Unhandled error:', error);
  const payload: ApiErrorResponse = { error: 'Internal server error.' };
  response.status(500).json(payload);
});

/* ————————————————————————————————————————————————
   Startup / shutdown
———————————————————————————————————————————————— */

export async function startServer(): Promise<void> {
  await ensureDatabase();

  const server = app.listen(PORT, HOST, () => {
    console.info(`[api] Listening on http://${HOST}:${PORT} (${NODE_ENV})`);
  });

  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.info(`[api] ${signal} received. Closing HTTP server...`);

    server.close(() => {
      void mongoose
        .disconnect()
        .catch((error: unknown) => console.error('[db] Disconnect failed:', error))
        .finally(() => process.exit(0));
    });

    setTimeout(() => {
      console.error('[api] Forced shutdown after timeout.');
      process.exit(1);
    }, 10_000).unref();
  };

  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
}

if (process.env.NODE_ENV !== 'test' && !process.env.VERCEL) {
  startServer().catch((error: unknown) => {
    console.error('[api] Fatal startup error:', error);
    process.exit(1);
  });
}

export { app };
