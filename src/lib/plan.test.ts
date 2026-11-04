import { describe, expect, it } from 'vitest';
import { formatRangeLabel, getDayHeader, getPlanRange, inPlanRange } from './plan';

describe('sprint plan periods', () => {
  const tuesday = new Date(2026, 10, 3, 12, 0, 0);

  it('builds a Monday-to-Sunday week', () => {
    const range = getPlanRange('week', tuesday);
    expect(range.start).toBe('2026-11-02');
    expect(range.end).toBe('2026-11-08');
    expect(range.days).toHaveLength(7);
    expect(range.days[0]).toBe('2026-11-02');
    expect(range.days[6]).toBe('2026-11-08');
  });

  it('builds the full current month', () => {
    const range = getPlanRange('month', tuesday);
    expect(range.start).toBe('2026-11-01');
    expect(range.end).toBe('2026-11-30');
    expect(range.days).toHaveLength(30);
  });

  it('treats today as a single-day range', () => {
    const range = getPlanRange('today', tuesday);
    expect(range).toEqual({
      start: '2026-11-03',
      end: '2026-11-03',
      days: ['2026-11-03'],
    });
    expect(inPlanRange('2026-11-03', range)).toBe(true);
    expect(inPlanRange('2026-11-04', range)).toBe(false);
  });

  it('formats day headers and ranges', () => {
    expect(getDayHeader('2026-11-03')).toEqual({
      weekday: 'Tue',
      day: '3',
      month: 'Nov',
    });
    expect(formatRangeLabel('week', getPlanRange('week', tuesday))).toBe(
      '2–8 Nov 2026',
    );
    expect(formatRangeLabel('month', getPlanRange('month', tuesday))).toBe(
      'November 2026',
    );
  });
});
