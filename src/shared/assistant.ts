import type { AlignmentType, ImpactBand } from '../core/types';

export interface AssistantAction {
  tool: string;
  label: string;
  detail?: string;
}

export type AssistantRole = 'user' | 'assistant';

export interface ChatMessageDTO {
  id: string;
  role: AssistantRole;
  content: string;
  actions: AssistantAction[];
  error: boolean;
  createdAt: string;
}

export interface AssistantStatusDTO {
  configured: boolean;
  model: string;
  baseUrl: string;
}

export interface ConversationSummaryDTO {
  id: string;
  projectId: string;
  title: string;
  preview: string;
  lastMessageAt: string;
  updatedAt: string;
}

export interface ProjectDTO {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  conversations: ConversationSummaryDTO[];
}

export interface CreateProjectRequest {
  name: string;
}

export interface CreateConversationRequest {
  projectId: string;
  title?: string;
}

export interface UpdateConversationRequest {
  title: string;
}

export interface AssistantChatRequest {
  message: string;
  conversationId?: string;
  projectId?: string;
}

export interface AssistantChatResponse {
  conversationId: string;
  projectId: string;
  userMessage: ChatMessageDTO;
  message: ChatMessageDTO;
  conversation: ConversationSummaryDTO;
}

export interface AssistantHistoryResponse {
  conversationId: string | null;
  conversation: ConversationSummaryDTO | null;
  messages: ChatMessageDTO[];
}

export interface MemoryPageSummary {
  slug: string;
  title: string;
  summary: string;
  tags: string[];
  links: string[];
  updatedAt: string;
}

export interface MemoryPageDTO extends MemoryPageSummary {
  markdown: string;
  sourceIds: string[];
  backlinks: MemoryPageSummary[];
  createdAt: string;
}

export interface MemoryListResponse {
  pages: MemoryPageSummary[];
  total: number;
}

export interface MemorySourceSummary {
  id: string;
  title: string;
  url: string;
  tags: string[];
  createdAt: string;
}

export interface MemorySourceDTO extends MemorySourceSummary {
  markdown: string;
}

export interface MemoryHealth {
  totalPages: number;
  totalSources: number;
  orphanPages: MemoryPageSummary[];
  missingSummaries: MemoryPageSummary[];
}

/** A compact memory index injected into the assistant's system context. */
export interface MemoryIndexEntry {
  slug: string;
  title: string;
  summary: string;
  tags: string[];
}

export interface DeploymentToolResult {
  id: string;
  goalId: string;
  goalTitle: string;
  description: string;
  effort: number;
  progress: boolean;
  calculatedAlignment: number;
  calculatedImpact: number;
  strategicFeedback: string;
  alignmentType: AlignmentType;
  impactBand: ImpactBand;
  burnoutWarning: boolean;
  timestamp: string;
}
