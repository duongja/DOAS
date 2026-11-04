import { ApiError, api } from './client/api';
import { logout, requireAuth } from './client/auth';
import type {
  AssistantStatusDTO,
  ChatMessageDTO,
  ConversationSummaryDTO,
  MemoryHealth,
  MemoryPageDTO,
  MemoryPageSummary,
  ProjectDTO,
} from './shared/assistant';
import { formatTime, relativeTimestamp } from './lib/date';
import { icon } from './lib/icons';

/* ————————————————————————————————————————————————
   DOM
———————————————————————————————————————————————— */

function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing required element #${id}`);
  return element as T;
}

const assistantModel = byId<HTMLSpanElement>('assistant-model');
const assistantScroll = byId<HTMLDivElement>('assistant-scroll');
const assistantEmpty = byId<HTMLDivElement>('assistant-empty');
const messageList = byId<HTMLDivElement>('message-list');
const suggestions = byId<HTMLDivElement>('suggestions');
const assistantBanner = byId<HTMLDivElement>('assistant-banner');
const chatForm = byId<HTMLFormElement>('chat-form');
const chatInput = byId<HTMLTextAreaElement>('chat-input');
const chatSend = byId<HTMLButtonElement>('chat-send');
const toast = byId<HTMLDivElement>('assistant-toast');

const chatSidebar = byId<HTMLElement>('chat-sidebar');
const newChatButton = byId<HTMLButtonElement>('new-chat-button');
const newProjectButton = byId<HTMLButtonElement>('new-project-button');
const projectCreate = byId<HTMLDivElement>('project-create');
const projectNameInput = byId<HTMLInputElement>('project-name-input');
const projectCreateSubmit = byId<HTMLButtonElement>('project-create-submit');
const projectCreateCancel = byId<HTMLButtonElement>('project-create-cancel');
const projectList = byId<HTMLDivElement>('project-list');
const sidebarFootnote = byId<HTMLSpanElement>('sidebar-footnote');
const sidebarToggle = byId<HTMLButtonElement>('sidebar-toggle');
const sidebarBackdrop = byId<HTMLDivElement>('sidebar-backdrop');
const currentProjectElement = byId<HTMLSpanElement>('current-project');
const currentChatTitleElement = byId<HTMLHeadingElement>('current-chat-title');
const logoutButton = byId<HTMLButtonElement>('logout-button');

const brainToggle = byId<HTMLButtonElement>('brain-toggle');
const brainDrawer = byId<HTMLElement>('brain-drawer');
const brainBackdrop = byId<HTMLDivElement>('brain-backdrop');
const brainClose = byId<HTMLButtonElement>('brain-close');
const brainBrowser = byId<HTMLDivElement>('brain-browser');
const brainSearchForm = byId<HTMLFormElement>('brain-search-form');
const brainSearchInput = byId<HTMLInputElement>('brain-search-input');
const brainStats = byId<HTMLDivElement>('brain-stats');
const brainList = byId<HTMLDivElement>('brain-list');
const brainPage = byId<HTMLElement>('brain-page');
const brainBack = byId<HTMLButtonElement>('brain-back');
const brainPageTitle = byId<HTMLHeadingElement>('brain-page-title');
const brainPageMeta = byId<HTMLDivElement>('brain-page-meta');
const brainPageContent = byId<HTMLDivElement>('brain-page-content');

/* ————————————————————————————————————————————————
   State
———————————————————————————————————————————————— */

let messages: ChatMessageDTO[] = [];
let configured = false;
let sending = false;
let projects: ProjectDTO[] = [];
let activeProjectId: string | null = null;
let activeConversationId: string | null = null;
let currentConversation: ConversationSummaryDTO | null = null;
const collapsedProjects = new Set<string>();
let toastTimer: number | undefined;
let brainQueryTimer: number | undefined;

const AVATAR = `<svg width="15" height="15" viewBox="0 0 48 48" fill="none" aria-hidden="true"><circle cx="24" cy="24" r="19.5" stroke="currentColor" stroke-width="1.2" opacity="0.5"/><path d="M24 7.5 27.3 20.7 40.5 24 27.3 27.3 24 40.5 20.7 27.3 7.5 24 20.7 20.7Z" fill="currentColor"/></svg>`;

/* ————————————————————————————————————————————————
   Rendering utilities
———————————————————————————————————————————————— */

const HTML_ENTITIES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => HTML_ENTITIES[character] ?? character);
}

function renderPlain(value: string): string {
  return escapeHtml(value).replace(/\n/g, '<br>');
}

function inlineMarkdown(value: string): string {
  return value
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(
      /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
      '<a href="$2" target="_blank" rel="noreferrer">$1</a>',
    );
}

function renderMarkdown(value: string): string {
  const escaped = escapeHtml(value);
  const codeBlocks: string[] = [];

  const withPlaceholders = escaped.replace(/```([\s\S]*?)```/g, (_match, code: string) => {
    const index = codeBlocks.push(code.trim()) - 1;
    return `\u0000CODE${index}\u0000`;
  });

  const lines = withPlaceholders.split(/\r?\n/);
  let html = '';
  let listType: 'ul' | 'ol' | null = null;

  const closeList = () => {
    if (listType) {
      html += `</${listType}>`;
      listType = null;
    }
  };

  const isTableSeparator = (line: string): boolean =>
    /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(line.trim());

  const splitTableRow = (line: string): string[] =>
    line
      .trim()
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split('|')
      .map((cell) => cell.trim());

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex] ?? '';
    const trimmed = line.trim();
    if (trimmed === '') {
      closeList();
      continue;
    }

    if (/^\u0000CODE\d+\u0000$/.test(trimmed)) {
      closeList();
      html += trimmed;
      continue;
    }

    // GitHub-flavoured pipe table.
    if (trimmed.includes('|') && isTableSeparator(lines[lineIndex + 1] ?? '')) {
      closeList();
      const headers = splitTableRow(trimmed);
      lineIndex += 1;
      const rows: string[][] = [];

      while (lineIndex + 1 < lines.length) {
        const next = (lines[lineIndex + 1] ?? '').trim();
        if (!next.includes('|') || next === '') break;
        rows.push(splitTableRow(next));
        lineIndex += 1;
      }

      html += `<table class="markdown-table"><thead><tr>${headers
        .map((cell) => `<th>${inlineMarkdown(cell)}</th>`)
        .join('')}</tr></thead><tbody>${rows
        .map(
          (row) =>
            `<tr>${row.map((cell) => `<td>${inlineMarkdown(cell)}</td>`).join('')}</tr>`,
        )
        .join('')}</tbody></table>`;
      continue;
    }

    if (trimmed === '---' || trimmed === '***') {
      closeList();
      html += '<hr>';
      continue;
    }

    const heading = /^(#{1,3})\s+(.*)$/.exec(trimmed);
    if (heading) {
      closeList();
      const level = Math.min((heading[1]?.length ?? 1) + 1, 4);
      html += `<h${level}>${inlineMarkdown(heading[2] ?? '')}</h${level}>`;
      continue;
    }

    const unordered = /^[-*]\s+(.*)$/.exec(trimmed);
    if (unordered) {
      if (listType !== 'ul') {
        closeList();
        html += '<ul>';
        listType = 'ul';
      }
      html += `<li>${inlineMarkdown(unordered[1] ?? '')}</li>`;
      continue;
    }

    const ordered = /^\d+[.)]\s+(.*)$/.exec(trimmed);
    if (ordered) {
      if (listType !== 'ol') {
        closeList();
        html += '<ol>';
        listType = 'ol';
      }
      html += `<li>${inlineMarkdown(ordered[1] ?? '')}</li>`;
      continue;
    }

    if (trimmed.startsWith('> ')) {
      closeList();
      html += `<blockquote>${inlineMarkdown(trimmed.slice(2))}</blockquote>`;
      continue;
    }

    closeList();
    html += `<p>${inlineMarkdown(trimmed)}</p>`;
  }

  closeList();

  return html.replace(
    /\u0000CODE(\d+)\u0000/g,
    (_match, index: string) => `<pre><code>${codeBlocks[Number(index)] ?? ''}</code></pre>`,
  );
}

function renderMessage(message: ChatMessageDTO): string {
  if (message.role === 'user') {
    return `<article class="message user" data-message-id="${escapeHtml(message.id)}">
      <div class="user-bubble">${renderPlain(message.content)}</div>
    </article>`;
  }

  const actions =
    message.actions.length > 0
      ? `<div class="actions">${message.actions
          .map(
            (action) =>
              `<span class="action-chip">${escapeHtml(action.label)}${
                action.detail ? `<b>${escapeHtml(action.detail)}</b>` : ''
              }</span>`,
          )
          .join('')}</div>`
      : '';

  return `<article class="message assistant ${message.error ? 'error' : ''}" data-message-id="${escapeHtml(message.id)}">
    <span class="assistant-avatar">${AVATAR}</span>
    <div class="assistant-message-body">
      <span class="assistant-name">Operator${message.error ? ' · error' : ''}</span>
      <div class="assistant-text">${renderMarkdown(message.content)}</div>
      ${actions}
      <span class="message-time">${escapeHtml(relativeTimestamp(message.createdAt))} · ${escapeHtml(formatTime(message.createdAt))}</span>
    </div>
  </article>`;
}

function renderMessages(): void {
  messageList.innerHTML = messages.map(renderMessage).join('');
  assistantEmpty.hidden = messages.length > 0;
  scrollToBottom();
}

function scrollToBottom(): void {
  assistantScroll.scrollTop = assistantScroll.scrollHeight;
}

function appendTyping(): void {
  const typing = document.createElement('div');
  typing.id = 'assistant-typing';
  typing.className = 'message assistant';
  typing.innerHTML = `<span class="assistant-avatar">${AVATAR}</span>
    <div class="assistant-message-body">
      <span class="assistant-name">Operator</span>
      <div class="typing" aria-label="Thinking"><span></span><span></span><span></span></div>
    </div>`;
  messageList.appendChild(typing);
  scrollToBottom();
}

function removeTyping(): void {
  document.getElementById('assistant-typing')?.remove();
}

function showBanner(message: string, tone: 'warning' | 'error' = 'warning'): void {
  assistantBanner.textContent = message;
  assistantBanner.classList.toggle('error', tone === 'error');
  assistantBanner.hidden = false;
}

function hideBanner(): void {
  assistantBanner.hidden = true;
}

function showToast(message: string): void {
  toast.textContent = message;
  toast.hidden = false;
  if (toastTimer !== undefined) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toast.hidden = true;
  }, 3200);
}

function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    return [error.message, ...error.details].filter(Boolean).join(' ');
  }
  return error instanceof Error ? error.message : 'An unexpected error occurred.';
}

/* ————————————————————————————————————————————————
   Projects + conversation sidebar
———————————————————————————————————————————————— */

function defaultProjectId(): string | null {
  return projects.find((project) => project.name === 'General')?.id ?? projects[0]?.id ?? null;
}

function findChat(
  conversationId: string,
): { project: ProjectDTO; chat: ConversationSummaryDTO } | null {
  for (const project of projects) {
    const chat = project.conversations.find(
      (conversation) => conversation.id === conversationId,
    );
    if (chat) return { project, chat };
  }
  return null;
}

function findLatestChat(): { project: ProjectDTO; chat: ConversationSummaryDTO } | null {
  for (const project of projects) {
    const chat = project.conversations[0];
    if (chat) return { project, chat };
  }
  return null;
}

function renderSidebar(): void {
  const chatCount = projects.reduce(
    (total, project) => total + project.conversations.length,
    0,
  );
  sidebarFootnote.textContent = `${projects.length} project${projects.length === 1 ? '' : 's'} · ${chatCount} chat${chatCount === 1 ? '' : 's'}`;

  if (projects.length === 0) {
    projectList.innerHTML =
      '<div class="sidebar-note">No projects yet. Create one to organize your chats.</div>';
    return;
  }

  projectList.innerHTML = projects
    .map((project) => {
      const collapsed = collapsedProjects.has(project.id);
      const activeProject = project.id === activeProjectId;
      const chats = [...project.conversations].sort((left, right) =>
        right.lastMessageAt.localeCompare(left.lastMessageAt),
      );

      const chatsMarkup =
        chats.length > 0
          ? chats
              .map((chat) => {
                const active = chat.id === activeConversationId;
                return `
                  <div class="chat-row ${active ? 'active' : ''}">
                    <button type="button" class="chat-open" data-conversation-id="${escapeHtml(chat.id)}" title="${escapeHtml(chat.title)}">
                      <span class="chat-title">${escapeHtml(chat.title)}</span>
                      <span class="chat-preview">${escapeHtml(chat.preview || 'No preview yet')}</span>
                    </button>
                    <div class="chat-actions">
                      <button type="button" data-chat-rename="${escapeHtml(chat.id)}" aria-label="Rename chat">✎</button>
                      <button type="button" class="chat-delete" data-chat-delete="${escapeHtml(chat.id)}" aria-label="Delete chat">⌫</button>
                    </div>
                  </div>`;
              })
              .join('')
          : '<div class="chat-empty-note">No chats yet</div>';

      return `
        <div class="project-group ${activeProject ? 'active-project' : ''}">
          <div class="project-head">
            <button type="button" class="project-toggle" data-project-toggle="${escapeHtml(project.id)}" aria-expanded="${!collapsed}">
              <span class="project-caret">${collapsed ? '▸' : '▾'}</span>
              <span class="project-folder">${icon('folder', 12)}</span>
              <span class="project-name">${escapeHtml(project.name)}</span>
              <span class="project-count">${project.conversations.length}</span>
            </button>
            <button type="button" class="project-new-chat" data-project-new="${escapeHtml(project.id)}" aria-label="New chat in ${escapeHtml(project.name)}">+</button>
          </div>
          ${collapsed ? '' : `<div class="project-chats">${chatsMarkup}</div>`}
        </div>`;
    })
    .join('');
}

function updateChatHeader(): void {
  const project = projects.find((entry) => entry.id === activeProjectId);
  const title = currentConversation?.title ?? 'New chat';
  currentProjectElement.textContent = project?.name ?? 'General';
  currentChatTitleElement.textContent = title;
  document.title = `${title} — Diaries of a Soldier`;
}

function openSidebar(): void {
  chatSidebar.classList.add('open');
  sidebarBackdrop.hidden = false;
}

function closeSidebar(): void {
  chatSidebar.classList.remove('open');
  sidebarBackdrop.hidden = true;
}

async function loadProjects(): Promise<void> {
  projects = await api.getProjects();

  if (activeConversationId) {
    const found = findChat(activeConversationId);
    if (found) {
      activeProjectId = found.project.id;
      currentConversation = found.chat;
    } else {
      activeConversationId = null;
      currentConversation = null;
      messages = [];
      renderMessages();
    }
  }

  if (!activeProjectId || !projects.some((project) => project.id === activeProjectId)) {
    activeProjectId = defaultProjectId();
  }

  renderSidebar();
  updateChatHeader();
}

function mergeConversation(summary: ConversationSummaryDTO): void {
  const project = projects.find((entry) => entry.id === summary.projectId);
  if (project) {
    project.conversations = [
      summary,
      ...project.conversations.filter((conversation) => conversation.id !== summary.id),
    ];
    project.updatedAt = new Date().toISOString();
  }
  activeProjectId = summary.projectId;
  activeConversationId = summary.id;
  currentConversation = summary;
  collapsedProjects.delete(summary.projectId);
  renderSidebar();
  updateChatHeader();
}

function showChatLoading(): void {
  messages = [];
  assistantEmpty.hidden = true;
  messageList.innerHTML = '<div class="chat-loading">Loading conversation…</div>';
}

async function loadConversation(conversationId: string): Promise<void> {
  showChatLoading();
  try {
    const history = await api.getAssistantHistory(80, conversationId);
    messages = history.messages;
    currentConversation = history.conversation;
    activeConversationId = history.conversationId ?? conversationId;
    if (currentConversation) {
      activeProjectId = currentConversation.projectId;
      collapsedProjects.delete(activeProjectId);
    }
    renderMessages();
    renderSidebar();
    updateChatHeader();
    closeSidebar();
    if (configured) hideBanner();
  } catch (error) {
    messages = [];
    activeConversationId = null;
    currentConversation = null;
    renderMessages();
    renderSidebar();
    updateChatHeader();
    showBanner(describeError(error), 'error');
  }
}

function startNewChat(projectId?: string | null): void {
  activeProjectId = projectId ?? activeProjectId ?? defaultProjectId();
  activeConversationId = null;
  currentConversation = null;
  messages = [];
  if (activeProjectId) collapsedProjects.delete(activeProjectId);
  renderMessages();
  renderSidebar();
  updateChatHeader();
  closeSidebar();
  if (configured) hideBanner();
  chatInput.focus();
}

function showProjectCreate(): void {
  projectCreate.hidden = false;
  projectNameInput.value = '';
  projectNameInput.focus();
}

function hideProjectCreate(): void {
  projectCreate.hidden = true;
  projectNameInput.value = '';
}

async function submitProjectCreate(): Promise<void> {
  const name = projectNameInput.value.trim();
  if (!name) {
    projectNameInput.focus();
    return;
  }

  projectCreateSubmit.disabled = true;
  try {
    const project = await api.createProject(name);
    hideProjectCreate();
    projects = [project, ...projects.filter((entry) => entry.id !== project.id)];
    collapsedProjects.delete(project.id);
    startNewChat(project.id);
    showToast('Project created.');

    try {
      await loadProjects();
    } catch (refreshError) {
      showBanner(describeError(refreshError), 'error');
    }
  } catch (error) {
    showBanner(describeError(error), 'error');
  } finally {
    projectCreateSubmit.disabled = false;
  }
}

async function renameChat(conversationId: string): Promise<void> {
  const found = findChat(conversationId);
  if (!found) return;

  const nextTitle = window.prompt('Rename chat', found.chat.title);
  if (nextTitle === null) return;
  const title = nextTitle.trim();
  if (!title) return;

  try {
    const updated = await api.renameConversation(conversationId, title);
    await loadProjects();
    if (activeConversationId === conversationId) {
      currentConversation = updated;
      updateChatHeader();
    }
  } catch (error) {
    showBanner(describeError(error), 'error');
  }
}

async function deleteChat(conversationId: string): Promise<void> {
  const found = findChat(conversationId);
  if (!found) return;
  if (!window.confirm(`Delete “${found.chat.title}”? This cannot be undone.`)) return;

  const projectId = found.project.id;
  const wasActive = activeConversationId === conversationId;

  try {
    await api.deleteConversation(conversationId);
    await loadProjects();
    if (wasActive) {
      const next = findLatestChat();
      if (next) {
        await loadConversation(next.chat.id);
      } else {
        startNewChat(projectId);
      }
    }
  } catch (error) {
    showBanner(describeError(error), 'error');
  }
}

/* ————————————————————————————————————————————————
   Composer + status
———————————————————————————————————————————————— */

function resizeComposer(): void {
  chatInput.style.height = 'auto';
  chatInput.style.height = `${Math.min(chatInput.scrollHeight, 160)}px`;
}

function setSending(next: boolean): void {
  sending = next;
  chatSend.disabled = next || !configured;
  if (!configured) {
    chatInput.placeholder = 'Add OPENCODE_API_KEY to .env to activate the assistant.';
  } else {
    chatInput.placeholder =
      "Tell me what you did, what you're thinking, or what to remember…";
  }
}

function applyStatus(nextStatus: AssistantStatusDTO): void {
  configured = nextStatus.configured;
  assistantModel.textContent = configured
    ? `${nextStatus.model} · OpenCode`
    : 'Assistant not configured';
  assistantModel.title = configured
    ? `Model: ${nextStatus.model} · Endpoint: ${nextStatus.baseUrl}`
    : 'Add OPENCODE_API_KEY to .env and restart the API server.';

  if (!configured) {
    showBanner(
      'Assistant is offline: add OPENCODE_API_KEY to .env, then restart the API server. Your mission dashboard still works.',
      'warning',
    );
  }

  setSending(sending);
}

async function loadApp(): Promise<void> {
  try {
    const [assistantStatus, projectList] = await Promise.all([
      api.getAssistantStatus(),
      api.getProjects(),
    ]);
    applyStatus(assistantStatus);
    projects = projectList;
    activeProjectId = projectList.some((project) => project.id === activeProjectId)
      ? activeProjectId
      : defaultProjectId();
    renderSidebar();
    updateChatHeader();

    const latest = findLatestChat();
    if (latest) {
      await loadConversation(latest.chat.id);
    } else {
      startNewChat(activeProjectId);
    }

    if (!assistantStatus.configured) {
      showBanner(
        'Assistant is offline: add OPENCODE_API_KEY to .env, then restart the API server. Your mission dashboard still works.',
        'warning',
      );
    } else {
      hideBanner();
    }
  } catch (error) {
    configured = false;
    assistantModel.textContent = 'API offline';
    projects = [];
    renderSidebar();
    projectList.innerHTML = '<div class="sidebar-note">Projects unavailable.</div>';
    showBanner(describeError(error), 'error');
    setSending(false);
  }
}

/* ————————————————————————————————————————————————
   Chat
———————————————————————————————————————————————— */

async function sendMessage(rawText?: string): Promise<void> {
  if (sending) return;

  const text = (rawText ?? chatInput.value).trim();
  if (!text) return;

  if (!configured) {
    showBanner(
      'Assistant is offline: add OPENCODE_API_KEY to .env, then restart the API server.',
      'warning',
    );
    return;
  }

  const tempId = `temp-${Date.now()}`;
  const optimistic: ChatMessageDTO = {
    id: tempId,
    role: 'user',
    content: text,
    actions: [],
    error: false,
    createdAt: new Date().toISOString(),
  };

  const isNewChat = !activeConversationId;

  messages.push(optimistic);
  renderMessages();
  chatInput.value = '';
  resizeComposer();
  hideBanner();
  setSending(true);
  appendTyping();

  try {
    const response = await api.sendAssistantMessage(text, {
      conversationId: activeConversationId ?? undefined,
      projectId: isNewChat ? (activeProjectId ?? undefined) : undefined,
    });

    const index = messages.findIndex((message) => message.id === tempId);
    if (index >= 0) messages[index] = response.userMessage;
    messages.push(response.message);
    mergeConversation(response.conversation);

    try {
      await loadProjects();
      hideBanner();
    } catch (refreshError) {
      showBanner(describeError(refreshError), 'error');
    }

    if (
      response.message.actions.some(
        (action) => action.tool === 'save_memory' || action.tool === 'capture_source',
      )
    ) {
      showToast('Second brain updated.');
    }
  } catch (error) {
    messages = messages.filter((message) => message.id !== tempId);
    chatInput.value = text;
    resizeComposer();
    showBanner(describeError(error), 'error');

    if (error instanceof ApiError && error.status === 503) {
      configured = false;
      assistantModel.textContent = 'Assistant not configured';
    }
  } finally {
    removeTyping();
    setSending(false);
    renderMessages();
    updateChatHeader();
    chatInput.focus();
  }
}

/* ————————————————————————————————————————————————
   Second brain drawer
———————————————————————————————————————————————— */

function renderBrainStats(health: MemoryHealth): void {
  brainStats.innerHTML = `
    <div class="brain-stat"><span>Pages</span><strong>${health.totalPages}</strong></div>
    <div class="brain-stat"><span>Sources</span><strong>${health.totalSources}</strong></div>
    <div class="brain-stat"><span>Orphans</span><strong>${health.orphanPages.length}</strong></div>`;
}

function renderBrainList(pages: MemoryPageSummary[]): void {
  if (pages.length === 0) {
    brainList.innerHTML =
      '<div class="brain-note">No pages yet. Ask me to remember something and it will appear here.</div>';
    return;
  }

  brainList.innerHTML = pages
    .map(
      (page) => `
        <button type="button" class="brain-item" data-memory-slug="${escapeHtml(page.slug)}">
          <strong>${escapeHtml(page.title)}</strong>
          <p>${escapeHtml(page.summary || 'No summary yet.')}</p>
          <span>${escapeHtml(relativeTimestamp(page.updatedAt))}${
            page.tags.length > 0 ? ` · ${page.tags.map(escapeHtml).join(' · ')}` : ''
          }</span>
        </button>`,
    )
    .join('');
}

async function loadBrainPages(query = ''): Promise<void> {
  brainList.innerHTML = '<div class="brain-note">Loading pages…</div>';
  try {
    const result = await api.getMemoryPages(query, 100);
    renderBrainList(result.pages);
  } catch (error) {
    brainList.innerHTML = `<div class="brain-note">${escapeHtml(describeError(error))}</div>`;
  }
}

async function loadBrainHealth(): Promise<void> {
  try {
    const health = await api.getMemoryHealth();
    renderBrainStats(health);
  } catch {
    brainStats.innerHTML = '';
  }
}

async function openBrain(): Promise<void> {
  brainDrawer.hidden = false;
  brainBackdrop.hidden = false;
  showBrainBrowser();
  brainSearchInput.value = '';
  brainSearchInput.focus();
  await Promise.all([loadBrainHealth(), loadBrainPages('')]);
}

function closeBrain(): void {
  brainDrawer.hidden = true;
  brainBackdrop.hidden = true;
}

function showBrainBrowser(): void {
  brainBrowser.hidden = false;
  brainPage.hidden = true;
}

async function openBrainPage(slug: string): Promise<void> {
  brainBrowser.hidden = true;
  brainPage.hidden = false;
  brainPage.scrollTop = 0;
  brainPageTitle.textContent = slug;
  brainPageMeta.innerHTML = '<span>Loading…</span>';
  brainPageContent.innerHTML = '';

  try {
    const page: MemoryPageDTO = await api.getMemoryPage(slug);
    brainPageTitle.textContent = page.title;
    brainPageMeta.innerHTML = [
      `<span>${escapeHtml(relativeTimestamp(page.updatedAt))}</span>`,
      ...page.tags.map((tag) => `<span>${escapeHtml(tag)}</span>`),
      `<span>${page.sourceIds.length} source${page.sourceIds.length === 1 ? '' : 's'}</span>`,
    ].join('');
    brainPageContent.innerHTML = renderMarkdown(page.markdown);

    if (page.backlinks.length > 0) {
      const backlinks = document.createElement('div');
      backlinks.className = 'brain-backlinks';
      backlinks.innerHTML = page.backlinks
        .map(
          (backlink) =>
            `<button type="button" data-memory-slug="${escapeHtml(backlink.slug)}">${escapeHtml(backlink.title)}</button>`,
        )
        .join('');
      brainPageContent.appendChild(backlinks);
    }
  } catch (error) {
    brainPageMeta.innerHTML = '';
    brainPageContent.innerHTML = `<p>${escapeHtml(describeError(error))}</p>`;
  }
}

/* ————————————————————————————————————————————————
   Events
———————————————————————————————————————————————— */

function bindEvents(): void {
  logoutButton.addEventListener('click', () => void logout());
  chatInput.addEventListener('input', resizeComposer);
  chatInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      chatForm.requestSubmit();
    }
  });

  chatForm.addEventListener('submit', (event) => {
    event.preventDefault();
    void sendMessage();
  });

  suggestions.addEventListener('click', (event) => {
    if (!(event.target instanceof Element)) return;
    const button = event.target.closest<HTMLButtonElement>('[data-prompt]');
    const prompt = button?.dataset.prompt;
    if (!prompt) return;
    chatInput.value = prompt;
    resizeComposer();
    chatInput.focus();
    chatForm.requestSubmit();
  });

  newChatButton.addEventListener('click', () => startNewChat(activeProjectId));
  newProjectButton.addEventListener('click', () => {
    if (projectCreate.hidden) {
      showProjectCreate();
    } else {
      hideProjectCreate();
    }
  });
  projectCreateSubmit.addEventListener('click', () => void submitProjectCreate());
  projectCreateCancel.addEventListener('click', hideProjectCreate);
  projectNameInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      void submitProjectCreate();
    } else if (event.key === 'Escape') {
      hideProjectCreate();
    }
  });

  sidebarToggle.addEventListener('click', openSidebar);
  sidebarBackdrop.addEventListener('click', closeSidebar);

  projectList.addEventListener('click', (event) => {
    if (!(event.target instanceof Element)) return;

    const renameButton = event.target.closest<HTMLButtonElement>('[data-chat-rename]');
    const renameId = renameButton?.dataset.chatRename;
    if (renameId) {
      void renameChat(renameId);
      return;
    }

    const deleteButton = event.target.closest<HTMLButtonElement>('[data-chat-delete]');
    const deleteId = deleteButton?.dataset.chatDelete;
    if (deleteId) {
      void deleteChat(deleteId);
      return;
    }

    const projectNewButton = event.target.closest<HTMLButtonElement>('[data-project-new]');
    const projectNewId = projectNewButton?.dataset.projectNew;
    if (projectNewId) {
      collapsedProjects.delete(projectNewId);
      startNewChat(projectNewId);
      return;
    }

    const projectToggle = event.target.closest<HTMLButtonElement>('[data-project-toggle]');
    const projectToggleId = projectToggle?.dataset.projectToggle;
    if (projectToggleId) {
      if (collapsedProjects.has(projectToggleId)) {
        collapsedProjects.delete(projectToggleId);
      } else {
        collapsedProjects.add(projectToggleId);
      }
      renderSidebar();
      return;
    }

    const chatButton = event.target.closest<HTMLButtonElement>('[data-conversation-id]');
    const conversationId = chatButton?.dataset.conversationId;
    if (conversationId) {
      void loadConversation(conversationId);
    }
  });

  brainToggle.addEventListener('click', () => void openBrain());
  brainClose.addEventListener('click', closeBrain);
  brainBackdrop.addEventListener('click', closeBrain);
  brainBack.addEventListener('click', showBrainBrowser);

  brainSearchForm.addEventListener('submit', (event) => {
    event.preventDefault();
    void loadBrainPages(brainSearchInput.value);
  });

  brainSearchInput.addEventListener('input', () => {
    if (brainQueryTimer !== undefined) window.clearTimeout(brainQueryTimer);
    brainQueryTimer = window.setTimeout(() => {
      void loadBrainPages(brainSearchInput.value);
    }, 280);
  });

  brainList.addEventListener('click', (event) => {
    if (!(event.target instanceof Element)) return;
    const button = event.target.closest<HTMLButtonElement>('[data-memory-slug]');
    const slug = button?.dataset.memorySlug;
    if (slug) void openBrainPage(slug);
  });

  brainPageContent.addEventListener('click', (event) => {
    if (!(event.target instanceof Element)) return;
    const button = event.target.closest<HTMLButtonElement>('[data-memory-slug]');
    const slug = button?.dataset.memorySlug;
    if (slug) void openBrainPage(slug);
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (!brainDrawer.hidden) {
      closeBrain();
      return;
    }
    if (!sidebarBackdrop.hidden) {
      closeSidebar();
      return;
    }
    if (!projectCreate.hidden) hideProjectCreate();
  });

  window.addEventListener('resize', () => {
    if (window.innerWidth > 900) closeSidebar();
  });
}

/* ————————————————————————————————————————————————
   Boot
———————————————————————————————————————————————— */

async function init(): Promise<void> {
  const session = await requireAuth();
  if (!session) return;
  resizeComposer();
  bindEvents();
  void loadApp();
}

void init();
