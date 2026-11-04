import type {
  ApiErrorResponse,
  CreateDeliverableRequest,
  CreateGoalRequest,
  CreateLogRequest,
  DashboardDTO,
  DeliverableDTO,
  GoalDTO,
  LogDTO,
  UpdateDeliverableRequest,
} from '../shared/types';
import type {
  AssistantChatResponse,
  AssistantHistoryResponse,
  AssistantStatusDTO,
  ConversationSummaryDTO,
  CreateProjectRequest,
  MemoryHealth,
  MemoryListResponse,
  MemoryPageDTO,
  ProjectDTO,
} from '../shared/assistant';
import { redirectToLogin } from './auth';

export class ApiError extends Error {
  readonly status: number;
  readonly details: string[];

  constructor(message: string, status: number, details: string[] = []) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;

  try {
    response = await fetch(path, {
      ...init,
      headers: {
        Accept: 'application/json',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...init.headers,
      },
    });
  } catch {
    throw new ApiError(
      'Unable to reach the API. Check that the Express server and MongoDB are running.',
      0,
    );
  }

  if (response.status === 401) {
    redirectToLogin();
    throw new ApiError('Authentication required.', 401);
  }

  const contentType = response.headers.get('content-type') ?? '';
  const payload: unknown = contentType.includes('application/json')
    ? await response.json()
    : null;

  if (!response.ok) {
    const apiError = payload as Partial<ApiErrorResponse> | null;
    const message = apiError?.error ?? `Request failed with status ${response.status}.`;
    const details = Array.isArray(apiError?.details) ? apiError.details : [];
    throw new ApiError(message, response.status, details);
  }

  return payload as T;
}

export const api = {
  getGoals(): Promise<GoalDTO[]> {
    return request<GoalDTO[]>('/api/goals');
  },

  createGoal(body: CreateGoalRequest): Promise<GoalDTO> {
    return request<GoalDTO>('/api/goals', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

  getLogs(): Promise<LogDTO[]> {
    return request<LogDTO[]>('/api/logs');
  },

  createLog(body: CreateLogRequest): Promise<LogDTO> {
    return request<LogDTO>('/api/logs', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

  getDashboard(): Promise<DashboardDTO> {
    return request<DashboardDTO>('/api/dashboard');
  },

  getDeliverables(
    filter: { from?: string; to?: string; goalId?: string } = {},
  ): Promise<DeliverableDTO[]> {
    const params = new URLSearchParams();
    if (filter.from) params.set('from', filter.from);
    if (filter.to) params.set('to', filter.to);
    if (filter.goalId) params.set('goalId', filter.goalId);
    const query = params.toString();
    return request<DeliverableDTO[]>(`/api/deliverables${query ? `?${query}` : ''}`);
  },

  createDeliverable(body: CreateDeliverableRequest): Promise<DeliverableDTO> {
    return request<DeliverableDTO>('/api/deliverables', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

  updateDeliverable(
    deliverableId: string,
    patch: UpdateDeliverableRequest,
  ): Promise<DeliverableDTO> {
    return request<DeliverableDTO>(
      `/api/deliverables/${encodeURIComponent(deliverableId)}`,
      {
        method: 'PATCH',
        body: JSON.stringify(patch),
      },
    );
  },

  deleteDeliverable(deliverableId: string): Promise<{ ok: boolean }> {
    return request<{ ok: boolean }>(
      `/api/deliverables/${encodeURIComponent(deliverableId)}`,
      { method: 'DELETE' },
    );
  },

  getAssistantStatus(): Promise<AssistantStatusDTO> {
    return request<AssistantStatusDTO>('/api/assistant/status');
  },

  getAssistantHistory(
    limit = 50,
    conversationId?: string,
  ): Promise<AssistantHistoryResponse> {
    const params = new URLSearchParams({ limit: String(limit) });
    if (conversationId) params.set('conversationId', conversationId);
    return request<AssistantHistoryResponse>(`/api/assistant/history?${params.toString()}`);
  },

  sendAssistantMessage(
    message: string,
    options: { conversationId?: string; projectId?: string } = {},
  ): Promise<AssistantChatResponse> {
    return request<AssistantChatResponse>('/api/assistant/chat', {
      method: 'POST',
      body: JSON.stringify({
        message,
        ...(options.conversationId ? { conversationId: options.conversationId } : {}),
        ...(options.projectId ? { projectId: options.projectId } : {}),
      }),
    });
  },

  getProjects(): Promise<ProjectDTO[]> {
    return request<ProjectDTO[]>('/api/projects');
  },

  createProject(name: string): Promise<ProjectDTO> {
    const body: CreateProjectRequest = { name };
    return request<ProjectDTO>('/api/projects', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

  createConversation(projectId: string, title = 'New chat'): Promise<ConversationSummaryDTO> {
    return request<ConversationSummaryDTO>('/api/conversations', {
      method: 'POST',
      body: JSON.stringify({ projectId, title }),
    });
  },

  renameConversation(conversationId: string, title: string): Promise<ConversationSummaryDTO> {
    return request<ConversationSummaryDTO>(
      `/api/conversations/${encodeURIComponent(conversationId)}`,
      {
        method: 'PATCH',
        body: JSON.stringify({ title }),
      },
    );
  },

  deleteConversation(conversationId: string): Promise<{ ok: boolean }> {
    return request<{ ok: boolean }>(
      `/api/conversations/${encodeURIComponent(conversationId)}`,
      { method: 'DELETE' },
    );
  },

  getMemoryPages(query?: string, limit = 50): Promise<MemoryListResponse> {
    const params = new URLSearchParams();
    if (query?.trim()) params.set('q', query.trim());
    params.set('limit', String(limit));
    return request<MemoryListResponse>(`/api/brain/pages?${params.toString()}`);
  },

  getMemoryPage(slug: string): Promise<MemoryPageDTO> {
    return request<MemoryPageDTO>(`/api/brain/pages/${encodeURIComponent(slug)}`);
  },

  getMemoryHealth(): Promise<MemoryHealth> {
    return request<MemoryHealth>('/api/brain/health');
  },
};
