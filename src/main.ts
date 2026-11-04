import { api, ApiError } from './client/api';
import type {
  CreateDeliverableRequest,
  CreateGoalRequest,
  DeliverableDTO,
  GoalDTO,
} from './shared/types';
import { formatDate, toLocalDateString } from './lib/date';
import {
  formatLongDate,
  formatRangeLabel,
  getDayHeader,
  getPlanRange,
  inPlanRange,
  isToday,
  type PlanPeriod,
} from './lib/plan';

/* ————————————————————————————————————————————————
   DOM
———————————————————————————————————————————————— */

function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing required DOM element #${id}`);
  return element as T;
}

const consoleStatus = byId<HTMLSpanElement>('console-status');
const onlineDot = byId<HTMLSpanElement>('online-dot');
const appError = byId<HTMLDivElement>('app-error');
const appErrorMessage = byId<HTMLParagraphElement>('app-error-message');
const retryButton = byId<HTMLButtonElement>('retry-button');
const loadingState = byId<HTMLDivElement>('loading-state');
const emptyState = byId<HTMLDivElement>('empty-state');
const emptyCreateButton = byId<HTMLButtonElement>('empty-create-button');
const planView = byId<HTMLDivElement>('plan-view');
const newGoalTop = byId<HTMLButtonElement>('new-goal-top');
const newDeliverableButton = byId<HTMLButtonElement>('new-deliverable-button');
const todayLabel = byId<HTMLSpanElement>('today-label');
const planTitle = byId<HTMLHeadingElement>('plan-title');
const planSubtitle = byId<HTMLParagraphElement>('plan-subtitle');
const periodTabs = byId<HTMLDivElement>('period-tabs');
const todayCount = byId<HTMLElement>('today-count');
const weekCount = byId<HTMLElement>('week-count');
const monthCount = byId<HTMLElement>('month-count');
const planContent = byId<HTMLDivElement>('plan-content');

const deliverableModal = byId<HTMLDivElement>('deliverable-modal');
const deliverableClose = byId<HTMLButtonElement>('deliverable-close');
const deliverableForm = byId<HTMLFormElement>('deliverable-form');
const deliverableGoal = byId<HTMLSelectElement>('deliverable-goal');
const deliverableTitle = byId<HTMLInputElement>('deliverable-title');
const deliverableDate = byId<HTMLInputElement>('deliverable-date');
const deliverableDetails = byId<HTMLInputElement>('deliverable-details');
const deliverableError = byId<HTMLParagraphElement>('deliverable-error');
const deliverableSubmit = byId<HTMLButtonElement>('deliverable-submit');
const deliverableCancel = byId<HTMLButtonElement>('deliverable-cancel');

const goalModal = byId<HTMLDivElement>('goal-modal');
const goalModalClose = byId<HTMLButtonElement>('goal-modal-close');
const goalForm = byId<HTMLFormElement>('goal-form');
const goalTitle = byId<HTMLInputElement>('goal-title');
const goalMovable = byId<HTMLInputElement>('goal-movable');
const goalWalls = byId<HTMLTextAreaElement>('goal-walls');
const goalError = byId<HTMLParagraphElement>('goal-error');
const goalSubmit = byId<HTMLButtonElement>('goal-submit');
const goalCancel = byId<HTMLButtonElement>('goal-cancel');

const toast = byId<HTMLDivElement>('toast');
const toastMessage = byId<HTMLSpanElement>('toast-message');

/* ————————————————————————————————————————————————
   State
——————————————————————————————————————————————— */

interface UiState {
  goals: GoalDTO[];
  deliverables: DeliverableDTO[];
  period: PlanPeriod;
  loaded: boolean;
}

const state: UiState = {
  goals: [],
  deliverables: [],
  period: 'today',
  loaded: false,
};

const countElements: Record<PlanPeriod, HTMLElement> = {
  today: todayCount,
  week: weekCount,
  month: monthCount,
};

let toastTimer: number | undefined;

/* ————————————————————————————————————————————————
   Utilities
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

function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    return [error.message, ...error.details].filter(Boolean).join(' ');
  }
  return error instanceof Error ? error.message : 'An unexpected error occurred.';
}

function showToast(message: string): void {
  toastMessage.textContent = message;
  toast.hidden = false;
  if (toastTimer !== undefined) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toast.hidden = true;
  }, 3200);
}

function showInlineError(element: HTMLElement, message: string): void {
  element.textContent = message;
  element.hidden = false;
}

function clearInlineError(element: HTMLElement): void {
  element.textContent = '';
  element.hidden = true;
}

function setConnection(online: boolean): void {
  onlineDot.classList.toggle('online', online);
  onlineDot.classList.toggle('offline', !online);
  consoleStatus.textContent = online ? 'Connected' : 'Offline';
}

function showAppError(message: string): void {
  appErrorMessage.textContent = message;
  appError.hidden = false;
  setConnection(false);
}

function hideAppError(): void {
  appError.hidden = true;
}

function sortDeliverables(items: DeliverableDTO[]): DeliverableDTO[] {
  return [...items].sort((left, right) => {
    if (left.status !== right.status) return left.status === 'planned' ? -1 : 1;
    return left.createdAt.localeCompare(right.createdAt);
  });
}

function itemsInPeriod(period: PlanPeriod, now = new Date()): DeliverableDTO[] {
  const range = getPlanRange(period, now);
  return state.deliverables.filter((item) => inPlanRange(item.plannedDate, range));
}

/* ————————————————————————————————————————————————
   Rendering
———————————————————————————————————————————————— */

function renderTabs(now: Date): void {
  const periods: PlanPeriod[] = ['today', 'week', 'month'];

  for (const period of periods) {
    const items = itemsInPeriod(period, now);
    const delivered = items.filter((item) => item.status === 'delivered').length;
    countElements[period].textContent = `${delivered}/${items.length}`;
  }

  periodTabs.querySelectorAll<HTMLButtonElement>('[data-period]').forEach((tab) => {
    const active = tab.dataset.period === state.period;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-selected', String(active));
  });
}

function deliverableRow(item: DeliverableDTO): string {
  const delivered = item.status === 'delivered';
  const meta = item.details
    ? `${item.goalTitle} · ${item.details}`
    : item.goalTitle;

  return `
    <div class="deliverable-row ${delivered ? 'delivered' : ''}">
      <button
        type="button"
        class="deliverable-check"
        data-deliverable-toggle="${escapeHtml(item.id)}"
        aria-pressed="${delivered}"
        aria-label="${delivered ? 'Mark as planned' : 'Mark as delivered'}"
      >${delivered ? '✓' : ''}</button>
      <span class="deliverable-main">
        <span class="deliverable-title">${escapeHtml(item.title)}</span>
        <span class="deliverable-meta">${escapeHtml(meta)}</span>
      </span>
      <button
        type="button"
        class="deliverable-delete"
        data-deliverable-delete="${escapeHtml(item.id)}"
        aria-label="Delete deliverable"
      >×</button>
    </div>`;
}

function renderDay(iso: string, items: DeliverableDTO[], now: Date): string {
  const header = getDayHeader(iso);
  const today = isToday(iso, now);
  const todayIso = toLocalDateString(now);
  const canAdd = iso >= todayIso;
  const rows = items.length
    ? sortDeliverables(items).map(deliverableRow).join('')
    : `<span class="plan-none">No deliverables</span>${
        canAdd
          ? `<button type="button" class="plan-add-inline" data-add-deliverable data-date="${iso}">+ Add</button>`
          : ''
      }`;

  return `
    <div class="plan-day ${today ? 'today' : ''}">
      <div class="plan-day-head">
        <span class="plan-weekday">${header.weekday}</span>
        <strong>${header.day}</strong>
        <span class="plan-month">${header.month}</span>
        ${today ? '<em>Today</em>' : ''}
      </div>
      <div class="plan-day-body">${rows}</div>
    </div>`;
}

function emptyPlan(label: string, now: Date): string {
  return `
    <div class="plan-empty">
      <span class="eyebrow">Nothing planned</span>
      <p>No deliverables for ${label}.</p>
      <button
        type="button"
        class="secondary-button"
        data-add-deliverable
        data-date="${toLocalDateString(now)}"
      >+ Add deliverable</button>
    </div>`;
}

function renderPlan(now: Date): void {
  const range = getPlanRange(state.period, now);
  const items = state.deliverables.filter((item) => inPlanRange(item.plannedDate, range));
  const delivered = items.filter((item) => item.status === 'delivered').length;

  todayLabel.textContent = formatLongDate(now);

  if (state.period === 'today') {
    planTitle.textContent = 'Today’s plan';
    planSubtitle.textContent = `${delivered} of ${items.length} delivered`;
  } else if (state.period === 'week') {
    planTitle.textContent = 'This week';
    planSubtitle.textContent = `${formatRangeLabel('week', range)} · ${delivered} of ${items.length} delivered`;
  } else {
    planTitle.textContent = 'This month';
    planSubtitle.textContent = `${formatRangeLabel('month', range)} · ${delivered} of ${items.length} delivered`;
  }

  document.title = `${planTitle.textContent} — Diaries of a Soldier`;

  if (items.length === 0) {
    const label =
      state.period === 'today' ? 'today' : state.period === 'week' ? 'this week' : 'this month';
    planContent.innerHTML = emptyPlan(label, now);
    return;
  }

  if (state.period === 'today') {
    planContent.innerHTML = renderDay(range.start, items, now);
    return;
  }

  if (state.period === 'week') {
    planContent.innerHTML = range.days
      .map((day) =>
        renderDay(
          day,
          items.filter((item) => item.plannedDate === day),
          now,
        ),
      )
      .join('');
    return;
  }

  const dates = [...new Set(items.map((item) => item.plannedDate))].sort();
  planContent.innerHTML = dates
    .map((date) =>
      renderDay(
        date,
        items.filter((item) => item.plannedDate === date),
        now,
      ),
    )
    .join('');
}

function renderAll(): void {
  if (!state.loaded) {
    planView.hidden = true;
    emptyState.hidden = true;
    return;
  }

  if (state.goals.length === 0) {
    planView.hidden = true;
    emptyState.hidden = false;
    return;
  }

  const now = new Date();
  planView.hidden = false;
  emptyState.hidden = true;
  renderTabs(now);
  renderPlan(now);
}

/* ————————————————————————————————————————————————
   Data
———————————————————————————————————————————————— */

interface FetchedData {
  goals: GoalDTO[];
  deliverables: DeliverableDTO[];
}

async function fetchData(): Promise<FetchedData> {
  const [goals, deliverables] = await Promise.all([
    api.getGoals(),
    api.getDeliverables(),
  ]);
  return { goals, deliverables };
}

function applyData(data: FetchedData): void {
  state.goals = data.goals;
  state.deliverables = data.deliverables;
  state.loaded = true;
}

async function loadApp(): Promise<void> {
  state.loaded = false;
  loadingState.hidden = false;
  planView.hidden = true;
  emptyState.hidden = true;
  hideAppError();

  try {
    applyData(await fetchData());
    setConnection(true);
  } catch (error) {
    showAppError(describeError(error));
  } finally {
    loadingState.hidden = true;
    renderAll();
  }
}

/* ————————————————————————————————————————————————
   Deliverable modal
———————————————————————————————————————————————— */

function populateGoalSelect(): void {
  deliverableGoal.innerHTML = state.goals
    .map((goal) => `<option value="${escapeHtml(goal.id)}">${escapeHtml(goal.title)}</option>`)
    .join('');
}

function openDeliverableModal(goalId?: string, date?: string): void {
  if (state.goals.length === 0) {
    openGoalModal();
    return;
  }

  deliverableForm.reset();
  populateGoalSelect();
  deliverableGoal.value =
    goalId && state.goals.some((goal) => goal.id === goalId)
      ? goalId
      : (state.goals[0]?.id ?? '');
  const today = toLocalDateString();
  deliverableDate.min = today;
  deliverableDate.value = date && date >= today ? date : today;
  clearInlineError(deliverableError);
  deliverableModal.hidden = false;
  document.body.style.overflow = 'hidden';
  deliverableTitle.focus();
}

function closeDeliverableModal(): void {
  deliverableModal.hidden = true;
  clearInlineError(deliverableError);
  document.body.style.overflow = '';
}

function focusPeriodForDate(date: string): void {
  const now = new Date();
  if (inPlanRange(date, getPlanRange('today', now))) {
    state.period = 'today';
  } else if (inPlanRange(date, getPlanRange('week', now))) {
    state.period = 'week';
  } else if (inPlanRange(date, getPlanRange('month', now))) {
    state.period = 'month';
  } else {
    state.period = 'month';
  }
}

async function handleDeliverableSubmit(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  clearInlineError(deliverableError);

  const goalId = deliverableGoal.value;
  const title = deliverableTitle.value.trim();
  const plannedDate = deliverableDate.value;
  const details = deliverableDetails.value.trim();

  if (!goalId) {
    showInlineError(deliverableError, 'Create an objective first.');
    return;
  }
  if (!title) {
    showInlineError(deliverableError, 'Name the outcome you will deliver.');
    deliverableTitle.focus();
    return;
  }
  if (!plannedDate) {
    showInlineError(deliverableError, 'Choose a date.');
    deliverableDate.focus();
    return;
  }
  if (plannedDate < toLocalDateString()) {
    showInlineError(deliverableError, 'Choose today or a future date.');
    deliverableDate.focus();
    return;
  }

  const payload: CreateDeliverableRequest = {
    goalId,
    title,
    plannedDate,
    details,
  };

  deliverableSubmit.disabled = true;
  try {
    const created = await api.createDeliverable(payload);
    state.deliverables = [...state.deliverables, created];
    focusPeriodForDate(created.plannedDate);
    closeDeliverableModal();
    renderAll();
    showToast(`Deliverable added for ${formatDate(created.plannedDate)}.`);
  } catch (error) {
    showInlineError(deliverableError, describeError(error));
  } finally {
    deliverableSubmit.disabled = false;
  }
}

/* ————————————————————————————————————————————————
   Deliverable actions
———————————————————————————————————————————————— */

async function toggleDeliverable(deliverableId: string): Promise<void> {
  const item = state.deliverables.find((entry) => entry.id === deliverableId);
  if (!item) return;

  const nextStatus = item.status === 'delivered' ? 'planned' : 'delivered';
  const previous = state.deliverables;
  state.deliverables = state.deliverables.map((entry) =>
    entry.id === deliverableId ? { ...entry, status: nextStatus } : entry,
  );
  renderAll();

  try {
    const updated = await api.updateDeliverable(deliverableId, { status: nextStatus });
    state.deliverables = state.deliverables.map((entry) =>
      entry.id === deliverableId ? updated : entry,
    );
    renderAll();
    showToast(updated.status === 'delivered' ? 'Delivered.' : 'Moved back to planned.');
  } catch (error) {
    state.deliverables = previous;
    renderAll();
    showToast(describeError(error));
  }
}

async function deleteDeliverable(deliverableId: string): Promise<void> {
  const item = state.deliverables.find((entry) => entry.id === deliverableId);
  if (!item) return;
  if (!window.confirm(`Delete “${item.title}”?`)) return;

  try {
    await api.deleteDeliverable(deliverableId);
    state.deliverables = state.deliverables.filter((entry) => entry.id !== deliverableId);
    renderAll();
    showToast('Deliverable removed.');
  } catch (error) {
    showToast(describeError(error));
  }
}

/* ————————————————————————————————————————————————
   Goal modal
———————————————————————————————————————————————— */

function openGoalModal(): void {
  goalForm.reset();
  clearInlineError(goalError);
  goalModal.hidden = false;
  document.body.style.overflow = 'hidden';
  goalTitle.focus();
}

function closeGoalModal(): void {
  goalModal.hidden = true;
  clearInlineError(goalError);
  document.body.style.overflow = '';
}

async function handleGoalSubmit(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  clearInlineError(goalError);

  const title = goalTitle.value.trim();
  const movableObject = goalMovable.value.trim();
  const immovableWallBehaviors = goalWalls.value
    .split(/\r?\n/)
    .map((behavior) => behavior.trim())
    .filter(Boolean);

  if (title.length < 2) {
    showInlineError(goalError, 'Add a title.');
    goalTitle.focus();
    return;
  }
  if (movableObject.length < 2) {
    showInlineError(goalError, 'Name the metric that should move.');
    goalMovable.focus();
    return;
  }

  const payload: CreateGoalRequest = { title, movableObject, immovableWallBehaviors };

  goalSubmit.disabled = true;
  try {
    const created = await api.createGoal(payload);
    state.goals = [created, ...state.goals];
    state.loaded = true;
    closeGoalModal();
    renderAll();
    showToast('Objective created. Add a deliverable.');
    openDeliverableModal(created.id);
  } catch (error) {
    showInlineError(goalError, describeError(error));
  } finally {
    goalSubmit.disabled = false;
  }
}

/* ————————————————————————————————————————————————
   Events
———————————————————————————————————————————————— */

function bindEvents(): void {
  newGoalTop.addEventListener('click', openGoalModal);
  newDeliverableButton.addEventListener('click', () => openDeliverableModal());
  emptyCreateButton.addEventListener('click', openGoalModal);
  retryButton.addEventListener('click', () => void loadApp());

  deliverableClose.addEventListener('click', closeDeliverableModal);
  deliverableCancel.addEventListener('click', closeDeliverableModal);
  deliverableForm.addEventListener('submit', (event) => void handleDeliverableSubmit(event));
  deliverableModal.addEventListener('mousedown', (event) => {
    if (event.target === deliverableModal) closeDeliverableModal();
  });

  goalModalClose.addEventListener('click', closeGoalModal);
  goalCancel.addEventListener('click', closeGoalModal);
  goalForm.addEventListener('submit', (event) => void handleGoalSubmit(event));
  goalModal.addEventListener('mousedown', (event) => {
    if (event.target === goalModal) closeGoalModal();
  });

  periodTabs.addEventListener('click', (event) => {
    if (!(event.target instanceof Element)) return;
    const tab = event.target.closest<HTMLButtonElement>('[data-period]');
    const period = tab?.dataset.period;
    if (period === 'today' || period === 'week' || period === 'month') {
      state.period = period;
      renderAll();
    }
  });

  planContent.addEventListener('click', (event) => {
    if (!(event.target instanceof Element)) return;

    const toggle = event.target.closest<HTMLButtonElement>('[data-deliverable-toggle]');
    if (toggle?.dataset.deliverableToggle) {
      void toggleDeliverable(toggle.dataset.deliverableToggle);
      return;
    }

    const remove = event.target.closest<HTMLButtonElement>('[data-deliverable-delete]');
    if (remove?.dataset.deliverableDelete) {
      void deleteDeliverable(remove.dataset.deliverableDelete);
      return;
    }

    const add = event.target.closest<HTMLButtonElement>('[data-add-deliverable]');
    if (add) {
      openDeliverableModal(undefined, add.dataset.date);
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (!deliverableModal.hidden) {
      closeDeliverableModal();
    } else if (!goalModal.hidden) {
      closeGoalModal();
    }
  });
}

function init(): void {
  bindEvents();
  void loadApp();
}

init();
