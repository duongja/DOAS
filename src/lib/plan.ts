import { formatDateShort, parseLocalDate, toLocalDateString } from './date';

export type PlanPeriod = 'today' | 'week' | 'month';
export type PlanView = PlanPeriod | 'history';

export interface PlanRange {
  start: string;
  end: string;
  days: string[];
}

function localDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function getPlanRange(period: PlanPeriod, now: Date = new Date()): PlanRange {
  const today = localDay(now);

  if (period === 'today') {
    const iso = toLocalDateString(today);
    return { start: iso, end: iso, days: [iso] };
  }

  if (period === 'week') {
    const start = new Date(today);
    // Monday start.
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
    const days = Array.from({ length: 7 }, (_, index) => {
      const date = new Date(start);
      date.setDate(date.getDate() + index);
      return toLocalDateString(date);
    });
    return {
      start: days[0] ?? toLocalDateString(start),
      end: days[6] ?? toLocalDateString(start),
      days,
    };
  }

  const first = new Date(today.getFullYear(), today.getMonth(), 1);
  const last = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  const days: string[] = [];
  for (let day = 1; day <= last.getDate(); day += 1) {
    days.push(toLocalDateString(new Date(today.getFullYear(), today.getMonth(), day)));
  }

  return {
    start: days[0] ?? toLocalDateString(first),
    end: days[days.length - 1] ?? toLocalDateString(last),
    days,
  };
}

export function formatLongDate(date: Date = new Date()): string {
  return date.toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
}

export function formatMonthLabel(date: Date = new Date()): string {
  return date.toLocaleDateString('en-GB', {
    month: 'long',
    year: 'numeric',
  });
}

export function formatRangeLabel(period: PlanPeriod, range: PlanRange): string {
  if (period === 'today') return formatLongDate(parseLocalDate(range.start));

  if (period === 'week') {
    const start = parseLocalDate(range.start);
    const end = parseLocalDate(range.end);
    const sameMonth = start.getMonth() === end.getMonth();
    if (sameMonth) {
      const month = end.toLocaleDateString('en-GB', { month: 'short' });
      return `${start.getDate()}–${end.getDate()} ${month} ${end.getFullYear()}`;
    }
    return `${formatDateShort(range.start)} – ${formatDateShort(range.end)} ${end.getFullYear()}`;
  }

  return formatMonthLabel(parseLocalDate(range.start));
}

export interface DayHeader {
  weekday: string;
  day: string;
  month: string;
}

export function getDayHeader(iso: string): DayHeader {
  const date = parseLocalDate(iso);
  return {
    weekday: date.toLocaleDateString('en-GB', { weekday: 'short' }),
    day: String(date.getDate()),
    month: date.toLocaleDateString('en-GB', { month: 'short' }),
  };
}

export function isToday(iso: string, now: Date = new Date()): boolean {
  return iso === toLocalDateString(now);
}

export function inPlanRange(plannedDate: string, range: PlanRange): boolean {
  return plannedDate >= range.start && plannedDate <= range.end;
}
