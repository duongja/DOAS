import { Types } from 'mongoose';
import {
  KnowledgePageModel,
  KnowledgeSourceModel,
  toMemorySummary,
  type KnowledgePageDocument,
  type KnowledgeSourceDocument,
} from '../models/knowledge';
import type {
  MemoryHealth,
  MemoryIndexEntry,
  MemoryPageDTO,
  MemoryPageSummary,
  MemorySourceDTO,
  MemorySourceSummary,
} from '../shared/assistant';

export interface MemoryPageInput {
  slug?: string;
  title: string;
  summary?: string;
  markdown: string;
  tags?: string[];
  links?: string[];
  sourceIds?: string[];
}

export interface SourceInput {
  title: string;
  markdown: string;
  url?: string;
  tags?: string[];
}

export class MemoryServiceError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = 'MemoryServiceError';
    this.status = status;
  }
}

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function slugify(value: string): string {
  const slug = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 90);

  return slug || `page-${Date.now().toString(36)}`;
}

function sanitizeSlug(value: string): string {
  const slug = value.trim().toLowerCase();
  if (!SLUG_PATTERN.test(slug)) {
    throw new MemoryServiceError(
      'Slug must use lowercase letters, numbers, and single hyphens.',
      400,
    );
  }
  return slug;
}

function sanitizeTags(tags: readonly string[] | undefined): string[] {
  if (!tags) return [];
  return [
    ...new Set(
      tags
        .map((tag) => tag.trim().toLowerCase())
        .filter((tag) => tag.length > 0 && tag.length <= 48),
    ),
  ].slice(0, 20);
}

function sanitizeLinks(links: readonly string[] | undefined, ownSlug: string): string[] {
  if (!links) return [];
  return [
    ...new Set(
      links
        .map((link) => link.trim().toLowerCase())
        .filter((link) => SLUG_PATTERN.test(link) && link !== ownSlug),
    ),
  ].slice(0, 50);
}

function sanitizeSourceIds(sourceIds: readonly string[] | undefined): Types.ObjectId[] {
  if (!sourceIds) return [];
  return [
    ...new Set(
      sourceIds.filter((sourceId) => Types.ObjectId.isValid(sourceId)).map((sourceId) => sourceId),
    ),
  ]
    .slice(0, 20)
    .map((sourceId) => new Types.ObjectId(sourceId));
}

function buildSummary(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#>*_`[\]()!-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 280);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function toMemoryPageDTO(
  page: KnowledgePageDocument,
  backlinks: MemoryPageSummary[],
): MemoryPageDTO {
  return {
    ...toMemorySummary(page),
    markdown: page.markdown,
    sourceIds: page.sourceIds.map((sourceId) => sourceId.toString()),
    backlinks,
    createdAt: page.createdAt.toISOString(),
  };
}

export async function listMemoryPages(limit = 50): Promise<MemoryPageSummary[]> {
  const pages = await KnowledgePageModel.find()
    .sort({ updatedAt: -1 })
    .limit(Math.min(Math.max(limit, 1), 100))
    .exec();
  return pages.map(toMemorySummary);
}

export async function searchMemory(
  query: string | undefined,
  limit = 10,
): Promise<MemoryPageSummary[]> {
  const trimmed = query?.trim();
  if (!trimmed) return listMemoryPages(limit);

  const pattern = new RegExp(escapeRegex(trimmed), 'i');
  const pages = await KnowledgePageModel.find({
    $or: [
      { title: pattern },
      { summary: pattern },
      { markdown: pattern },
      { tags: pattern },
      { links: pattern },
    ],
  })
    .sort({ updatedAt: -1 })
    .limit(Math.min(Math.max(limit, 1), 30))
    .exec();

  return pages.map(toMemorySummary);
}

export async function getMemoryPage(slug: string): Promise<MemoryPageDTO | null> {
  if (!SLUG_PATTERN.test(slug)) return null;
  const page = await KnowledgePageModel.findOne({ slug }).exec();
  if (!page) return null;

  const backlinkDocs = await KnowledgePageModel.find({ links: slug })
    .sort({ updatedAt: -1 })
    .limit(30)
    .exec();

  return toMemoryPageDTO(page, backlinkDocs.map(toMemorySummary));
}

export async function upsertMemoryPage(input: MemoryPageInput): Promise<MemoryPageDTO> {
  const title = input.title.trim();
  const markdown = input.markdown.trim();

  if (title.length < 2 || title.length > 160) {
    throw new MemoryServiceError('Memory title must be 2–160 characters.');
  }
  if (markdown.length < 1 || markdown.length > 100_000) {
    throw new MemoryServiceError('Memory markdown must be 1–100,000 characters.');
  }

  const slug = input.slug ? sanitizeSlug(input.slug) : slugify(title);
  const tags = sanitizeTags(input.tags);
  const links = sanitizeLinks(input.links, slug);
  const sourceIds = sanitizeSourceIds(input.sourceIds);
  const summary = (input.summary?.trim() || buildSummary(markdown)).slice(0, 600);

  await KnowledgePageModel.findOneAndUpdate(
    { slug },
    {
      $set: {
        title,
        summary,
        markdown,
        tags,
        links,
        sourceIds,
      },
      $setOnInsert: { slug },
    },
    {
      new: true,
      upsert: true,
      setDefaultsOnInsert: true,
      runValidators: true,
    },
  ).exec();

  const page = await getMemoryPage(slug);
  if (!page) throw new MemoryServiceError('Memory page could not be saved.', 500);
  return page;
}

export async function captureSource(input: SourceInput): Promise<{
  id: string;
  title: string;
  createdAt: string;
}> {
  const title = input.title.trim();
  const markdown = input.markdown.trim();

  if (title.length < 2 || title.length > 200) {
    throw new MemoryServiceError('Source title must be 2–200 characters.');
  }
  if (markdown.length < 1 || markdown.length > 500_000) {
    throw new MemoryServiceError('Source markdown must be 1–500,000 characters.');
  }

  const source: KnowledgeSourceDocument = await KnowledgeSourceModel.create({
    title,
    markdown,
    url: input.url?.trim().slice(0, 2000) ?? '',
    tags: sanitizeTags(input.tags),
  });

  return {
    id: source._id.toString(),
    title: source.title,
    createdAt: source.createdAt.toISOString(),
  };
}

export async function listSources(limit = 20): Promise<MemorySourceSummary[]> {
  const sources = await KnowledgeSourceModel.find()
    .sort({ createdAt: -1 })
    .limit(Math.min(Math.max(limit, 1), 50))
    .exec();

  return sources.map((source) => ({
    id: source._id.toString(),
    title: source.title,
    url: source.url,
    tags: [...source.tags],
    createdAt: source.createdAt.toISOString(),
  }));
}

export async function getSource(sourceId: string): Promise<MemorySourceDTO | null> {
  if (!Types.ObjectId.isValid(sourceId)) return null;
  const source = await KnowledgeSourceModel.findById(sourceId).exec();
  if (!source) return null;

  return {
    id: source._id.toString(),
    title: source.title,
    url: source.url,
    markdown: source.markdown,
    tags: [...source.tags],
    createdAt: source.createdAt.toISOString(),
  };
}

export async function getMemoryIndex(limit = 24): Promise<MemoryIndexEntry[]> {
  const pages = await KnowledgePageModel.find()
    .sort({ updatedAt: -1 })
    .limit(Math.min(Math.max(limit, 1), 40))
    .select('slug title summary tags')
    .exec();

  return pages.map((page) => ({
    slug: page.slug,
    title: page.title,
    summary: page.summary.slice(0, 220),
    tags: [...page.tags],
  }));
}

export async function getMemoryHealth(): Promise<MemoryHealth> {
  const [pages, totalSources] = await Promise.all([
    KnowledgePageModel.find().sort({ updatedAt: -1 }).exec(),
    KnowledgeSourceModel.countDocuments().exec(),
  ]);

  const inbound = new Map<string, number>();
  for (const page of pages) {
    for (const link of page.links) {
      inbound.set(link, (inbound.get(link) ?? 0) + 1);
    }
  }

  const orphanPages = pages
    .filter((page) => page.links.length === 0 && (inbound.get(page.slug) ?? 0) === 0)
    .map(toMemorySummary)
    .slice(0, 20);

  const missingSummaries = pages
    .filter((page) => page.summary.trim().length === 0)
    .map(toMemorySummary)
    .slice(0, 20);

  return {
    totalPages: pages.length,
    totalSources,
    orphanPages,
    missingSummaries,
  };
}
