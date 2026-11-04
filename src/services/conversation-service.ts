import { Types } from 'mongoose';
import {
  AssistantMessageModel,
  ConversationModel,
  ProjectModel,
  toChatMessageDTO,
  toConversationSummary,
  type ConversationDocument,
  type ProjectDocument,
} from '../models/knowledge';
import type {
  AssistantHistoryResponse,
  ConversationSummaryDTO,
  ProjectDTO,
} from '../shared/assistant';

export class ConversationServiceError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = 'ConversationServiceError';
    this.status = status;
  }
}

export interface ResolvedConversation {
  conversation: ConversationDocument;
  project: ProjectDocument;
}

export function titleFromMessage(message: string): string {
  const normalized = message.replace(/\s+/g, ' ').trim();
  if (!normalized) return 'New chat';
  return normalized.length > 58 ? `${normalized.slice(0, 57).trimEnd()}…` : normalized;
}

function previewFromMessage(message: string): string {
  return message.replace(/\s+/g, ' ').trim().slice(0, 180);
}

function toProjectDTO(
  project: ProjectDocument,
  conversations: ConversationSummaryDTO[],
): ProjectDTO {
  return {
    id: project._id.toString(),
    name: project.name,
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
    conversations,
  };
}

async function touchProject(projectId: Types.ObjectId): Promise<void> {
  await ProjectModel.updateOne({ _id: projectId }, { $set: { updatedAt: new Date() } }).exec();
}

/**
 * One-time upgrade path from the original single-thread app:
 * - ensure a "General" project exists
 * - move the legacy conversation into it
 * - derive a title/preview from its messages
 */
export async function ensureDefaultProjectAndMigrate(): Promise<ProjectDocument> {
  let general = await ProjectModel.findOne({ name: 'General' }).exec();
  if (!general) {
    try {
      general = await ProjectModel.create({ name: 'General' });
    } catch {
      general = await ProjectModel.findOne({ name: 'General' }).exec();
      if (!general) throw new ConversationServiceError('Could not create the default project.', 500);
    }
  }

  const orphans = await ConversationModel.find({ projectId: { $exists: false } }).exec();
  for (const conversation of orphans) {
    conversation.projectId = general._id;
    const [first, latest] = await Promise.all([
      AssistantMessageModel.findOne({ conversationId: conversation._id, role: 'user' })
        .sort({ createdAt: 1 })
        .exec(),
      AssistantMessageModel.findOne({ conversationId: conversation._id })
        .sort({ createdAt: -1 })
        .exec(),
    ]);

    const existingTitle = conversation.title?.trim();
    conversation.title =
      existingTitle && existingTitle !== 'Primary thread'
        ? existingTitle
        : first
          ? titleFromMessage(first.content)
          : 'Imported conversation';
    conversation.preview = latest ? previewFromMessage(latest.content) : conversation.preview || '';
    conversation.lastMessageAt =
      latest?.createdAt ?? conversation.updatedAt ?? conversation.createdAt ?? new Date();
    await conversation.save();
  }

  return general;
}

export async function getDefaultProject(): Promise<ProjectDocument> {
  const general = await ProjectModel.findOne({ name: 'General' }).exec();
  return general ?? ensureDefaultProjectAndMigrate();
}

export async function listProjects(): Promise<ProjectDTO[]> {
  let projects = await ProjectModel.find().sort({ updatedAt: -1 }).exec();
  if (projects.length === 0) {
    await ensureDefaultProjectAndMigrate();
    projects = await ProjectModel.find().sort({ updatedAt: -1 }).exec();
  }

  const conversations = await ConversationModel.find()
    .sort({ lastMessageAt: -1 })
    .exec();

  const grouped = new Map<string, ConversationSummaryDTO[]>();
  for (const conversation of conversations) {
    const key = conversation.projectId?.toString();
    if (!key) continue;
    const list = grouped.get(key) ?? [];
    list.push(toConversationSummary(conversation));
    grouped.set(key, list);
  }

  return projects.map((project) =>
    toProjectDTO(project, grouped.get(project._id.toString()) ?? []),
  );
}

export async function createProject(name: string): Promise<ProjectDTO> {
  const trimmed = name.trim();
  if (trimmed.length < 1 || trimmed.length > 80) {
    throw new ConversationServiceError('Project name must be 1–80 characters.');
  }

  try {
    const project = await ProjectModel.create({ name: trimmed });
    return toProjectDTO(project, []);
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 11000) {
      throw new ConversationServiceError('A project with that name already exists.', 409);
    }
    throw error;
  }
}

export async function createConversation(
  projectId: string,
  title = 'New chat',
): Promise<ConversationSummaryDTO> {
  if (!Types.ObjectId.isValid(projectId)) {
    throw new ConversationServiceError('Invalid projectId.');
  }
  const project = await ProjectModel.findById(projectId).exec();
  if (!project) throw new ConversationServiceError('Project not found.', 404);

  const cleanTitle = title.trim().slice(0, 120) || 'New chat';
  const conversation = await ConversationModel.create({
    projectId: project._id,
    title: cleanTitle,
    preview: '',
    lastMessageAt: new Date(),
  });
  await touchProject(project._id);

  return toConversationSummary(conversation);
}

export async function resolveConversation(input: {
  conversationId?: string;
  projectId?: string;
  firstMessage: string;
}): Promise<ResolvedConversation> {
  if (input.conversationId) {
    if (!Types.ObjectId.isValid(input.conversationId)) {
      throw new ConversationServiceError('Invalid conversationId.');
    }
    const conversation = await ConversationModel.findById(input.conversationId).exec();
    if (!conversation) throw new ConversationServiceError('Conversation not found.', 404);
    const project = await ProjectModel.findById(conversation.projectId).exec();
    if (!project) throw new ConversationServiceError('Project not found.', 404);
    return { conversation, project };
  }

  let project: ProjectDocument | null = null;
  if (input.projectId) {
    if (!Types.ObjectId.isValid(input.projectId)) {
      throw new ConversationServiceError('Invalid projectId.');
    }
    project = await ProjectModel.findById(input.projectId).exec();
    if (!project) throw new ConversationServiceError('Project not found.', 404);
  }
  project ??= await getDefaultProject();

  const conversation = await ConversationModel.create({
    projectId: project._id,
    title: titleFromMessage(input.firstMessage),
    preview: previewFromMessage(input.firstMessage),
    lastMessageAt: new Date(),
  });
  await touchProject(project._id);

  return { conversation, project };
}

export async function touchConversation(
  conversation: ConversationDocument,
  assistantContent: string,
): Promise<ConversationSummaryDTO> {
  conversation.lastMessageAt = new Date();
  conversation.preview = previewFromMessage(assistantContent);
  if (!conversation.title.trim() || conversation.title === 'New chat') {
    const firstUser = await AssistantMessageModel.findOne({
      conversationId: conversation._id,
      role: 'user',
    })
      .sort({ createdAt: 1 })
      .exec();
    if (firstUser) conversation.title = titleFromMessage(firstUser.content);
  }
  await conversation.save();
  await touchProject(conversation.projectId);
  return toConversationSummary(conversation);
}

export async function getAssistantHistory(
  conversationId?: string,
  limit = 50,
): Promise<AssistantHistoryResponse> {
  let conversation: ConversationDocument | null = null;

  if (conversationId) {
    if (!Types.ObjectId.isValid(conversationId)) {
      throw new ConversationServiceError('Invalid conversationId.');
    }
    conversation = await ConversationModel.findById(conversationId).exec();
    if (!conversation) throw new ConversationServiceError('Conversation not found.', 404);
  } else {
    conversation = await ConversationModel.findOne().sort({ lastMessageAt: -1 }).exec();
  }

  if (!conversation) {
    return { conversationId: null, conversation: null, messages: [] };
  }

  const messages = await AssistantMessageModel.find({ conversationId: conversation._id })
    .sort({ createdAt: -1 })
    .limit(Math.min(Math.max(limit, 1), 100))
    .exec();
  messages.reverse();

  return {
    conversationId: conversation._id.toString(),
    conversation: toConversationSummary(conversation),
    messages: messages.map(toChatMessageDTO),
  };
}

export async function renameConversation(
  conversationId: string,
  title: string,
): Promise<ConversationSummaryDTO> {
  if (!Types.ObjectId.isValid(conversationId)) {
    throw new ConversationServiceError('Invalid conversationId.');
  }
  const cleanTitle = title.trim();
  if (cleanTitle.length < 1 || cleanTitle.length > 120) {
    throw new ConversationServiceError('Chat title must be 1–120 characters.');
  }

  const conversation = await ConversationModel.findById(conversationId).exec();
  if (!conversation) throw new ConversationServiceError('Conversation not found.', 404);

  conversation.title = cleanTitle;
  await conversation.save();
  await touchProject(conversation.projectId);
  return toConversationSummary(conversation);
}

export async function deleteConversation(
  conversationId: string,
): Promise<{ conversationId: string; projectId: string }> {
  if (!Types.ObjectId.isValid(conversationId)) {
    throw new ConversationServiceError('Invalid conversationId.');
  }
  const conversation = await ConversationModel.findById(conversationId).exec();
  if (!conversation) throw new ConversationServiceError('Conversation not found.', 404);

  await AssistantMessageModel.deleteMany({ conversationId: conversation._id }).exec();
  await conversation.deleteOne();
  await touchProject(conversation.projectId);

  return {
    conversationId: conversation._id.toString(),
    projectId: conversation.projectId.toString(),
  };
}
