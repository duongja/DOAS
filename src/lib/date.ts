function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** Local calendar date as `YYYY-MM-DD` (never UTC, to avoid off-by-one logs). */
export function toLocalDateString(date: Date = new Date()): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function parseLocalDate(iso: string): Date {
  const [year, month, day] = iso.split('-').map(Number);
  if (!year || !month || !day) return new Date();
  return new Date(year, month - 1, day, 12, 0, 0, 0);
}

export function isoDaysAgo(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return toLocalDateString(date);
}

export function formatDate(iso: string): string {
  return parseLocalDate(iso).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export function formatDateShort(iso: string): string {
  return parseLocalDate(iso).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
  });
}

export function formatWeekday(iso: string): string {
  return parseLocalDate(iso).toLocaleDateString('en-GB', { weekday: 'short' });
}

export function relativeDate(iso: string): string {
  if (iso === toLocalDateString()) return 'Today';
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  if (iso === toLocalDateString(yesterday)) return 'Yesterday';
  return formatDateShort(iso);
}

function dateFromTimestamp(timestamp: string): Date {
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

export function isoDateFromTimestamp(timestamp: string): string {
  return toLocalDateString(dateFromTimestamp(timestamp));
}

export function relativeTimestamp(timestamp: string): string {
  return relativeDate(isoDateFromTimestamp(timestamp));
}

export function timestampParts(timestamp: string): {
  day: string;
  month: string;
  weekday: string;
} {
  const date = dateFromTimestamp(timestamp);
  return {
    day: pad(date.getDate()),
    month: date.toLocaleDateString('en-GB', { month: 'short' }),
    weekday: date.toLocaleDateString('en-GB', { weekday: 'short' }),
  };
}

export function formatTime(timestamp: string): string {
  return dateFromTimestamp(timestamp).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
  });
}
