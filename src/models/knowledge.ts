import { Schema, model, Types, type HydratedDocument } from 'mongoose';
import type {
  AssistantAction,
  AssistantRole,
  ChatMessageDTO,
  ConversationSummaryDTO,
  MemoryPageSummary,
} from '../shared/assistant';

/* ————————————————————————————————————————————————
   Knowledge page — the compiled wiki
———————————————————————————————————————————————— */

export interface KnowledgePageRecord {
  slug: string;
  title: string;
  summary: string;
  markdown: string;
  tags: string[];
  links: string[];
  sourceIds: Types.ObjectId[];
  createdAt: Date;
  updatedAt: Date;
}

export type KnowledgePageDocument = HydratedDocument<KnowledgePageRecord>;

export const KnowledgePageSchema = new Schema<KnowledgePageRecord>(
  {
    slug: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
      match: /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    },
    title: { type: String, required: true, trim: true, maxlength: 160 },
    summary: { type: String, default: '', trim: true, maxlength: 600 },
    markdown: { type: String, required: true, maxlength: 100_000 },
    tags: { type: [String], default: [], index: true },
    links: { type: [String], default: [], index: true },
    sourceIds: { type: [Schema.Types.ObjectId], ref: 'KnowledgeSource', default: [] },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

KnowledgePageSchema.index({ updatedAt: -1 });
KnowledgePageSchema.index({ title: 1 });
KnowledgePageSchema.index({ title: 'text', summary: 'text', markdown: 'text', tags: 'text' });

export const KnowledgePageModel = model<KnowledgePageRecord>(
  'KnowledgePage',
  KnowledgePageSchema,
);

export function toMemorySummary(page: KnowledgePageDocument): MemoryPageSummary {
  return {
    slug: page.slug,
    title: page.title,
    summary: page.summary,
    tags: [...page.tags],
    links: [...page.links],
    updatedAt: page.updatedAt.toISOString(),
  };
}

/* ————————————————————————————————————————————————
   Raw source — the ingestion layer
———————————————————————————————————————————————— */

export interface KnowledgeSourceRecord {
  title: string;
  url: string;
  markdown: string;
  tags: string[];
  createdAt: Date;
  updatedAt: Date;
}

export type KnowledgeSourceDocument = HydratedDocument<KnowledgeSourceRecord>;

export const KnowledgeSourceSchema = new Schema<KnowledgeSourceRecord>(
  {
    title: { type: String, required: true, trim: true, maxlength: 200 },
    url: { type: String, default: '', trim: true, maxlength: 2000 },
    markdown: { type: String, required: true, maxlength: 500_000 },
    tags: { type: [String], default: [], index: true },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

KnowledgeSourceSchema.index({ createdAt: -1 });

export const KnowledgeSourceModel = model<KnowledgeSourceRecord>(
  'KnowledgeSource',
  KnowledgeSourceSchema,
);

/* ————————————————————————————————————————————————
   Projects + conversations
———————————————————————————————————————————————— */

export interface ProjectRecord {
  name: string;
  createdAt: Date;
  updatedAt: Date;
}

export type ProjectDocument = HydratedDocument<ProjectRecord>;

export const ProjectSchema = new Schema<ProjectRecord>(
  {
    name: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      minlength: 1,
      maxlength: 80,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

ProjectSchema.index({ updatedAt: -1 });

export const ProjectModel = model<ProjectRecord>('Project', ProjectSchema);

export interface ConversationRecord {
  /** Internal unique identifier retained for compatibility with existing data. */
  key: string;
  projectId: Types.ObjectId;
  title: string;
  preview: string;
  lastMessageAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export type ConversationDocument = HydratedDocument<ConversationRecord>;

export const ConversationSchema = new Schema<ConversationRecord>(
  {
    key: {
      type: String,
      required: true,
      unique: true,
      default: () => new Types.ObjectId().toString(),
    },
    projectId: {
      type: Schema.Types.ObjectId,
      ref: 'Project',
      required: true,
      index: true,
    },
    title: { type: String, default: 'New chat', trim: true, maxlength: 120 },
    preview: { type: String, default: '', trim: true, maxlength: 240 },
    lastMessageAt: { type: Date, default: Date.now },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

ConversationSchema.index({ projectId: 1, lastMessageAt: -1 });
ConversationSchema.index({ lastMessageAt: -1 });

export const ConversationModel = model<ConversationRecord>('Conversation', ConversationSchema);

export function toConversationSummary(
  conversation: ConversationDocument,
): ConversationSummaryDTO {
  return {
    id: conversation._id.toString(),
    projectId: conversation.projectId.toString(),
    title: conversation.title,
    preview: conversation.preview,
    lastMessageAt: conversation.lastMessageAt.toISOString(),
    updatedAt: conversation.updatedAt.toISOString(),
  };
}

export interface AssistantMessageRecord {
  conversationId: Types.ObjectId;
  role: AssistantRole;
  content: string;
  actions: AssistantAction[];
  error: boolean;
  createdAt: Date;
}

export type AssistantMessageDocument = HydratedDocument<AssistantMessageRecord>;

const AssistantActionSchema = new Schema<AssistantAction>(
  {
    tool: { type: String, required: true },
    label: { type: String, required: true },
    detail: { type: String, default: '' },
  },
  { _id: false },
);

export const AssistantMessageSchema = new Schema<AssistantMessageRecord>(
  {
    conversationId: {
      type: Schema.Types.ObjectId,
      ref: 'Conversation',
      required: true,
    },
    role: { type: String, required: true, enum: ['user', 'assistant'] },
    content: { type: String, required: true, maxlength: 20_000 },
    actions: { type: [AssistantActionSchema], default: [] },
    error: { type: Boolean, default: false },
  },
  {
    versionKey: false,
    timestamps: { createdAt: true, updatedAt: false },
  },
);

AssistantMessageSchema.index({ conversationId: 1, createdAt: 1 });
AssistantMessageSchema.index({ conversationId: 1, createdAt: -1 });

export const AssistantMessageModel = model<AssistantMessageRecord>(
  'AssistantMessage',
  AssistantMessageSchema,
);

export function toChatMessageDTO(message: AssistantMessageDocument): ChatMessageDTO {
  return {
    id: message._id.toString(),
    role: message.role,
    content: message.content,
    actions: message.actions.map((action) => ({
      tool: action.tool,
      label: action.label,
      detail: action.detail,
    })),
    error: message.error,
    createdAt: message.createdAt.toISOString(),
  };
}
