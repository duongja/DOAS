import { roundTo } from './math';
import type { AuditResult, AuditSummary, DaySummary } from './types';

/** Aggregate a set of audit results for dashboards and trend charts. */
export function summarizeAudits(audits: readonly AuditResult[]): AuditSummary {
  if (audits.length === 0) {
    return {
      logCount: 0,
      totalImpact: 0,
      totalEffort: 0,
      averageAlignment: 0,
      displacementRate: 0,
      burnoutCount: 0,
      missionCount: 0,
      activeDays: 0,
      byDate: [],
    };
  }

  const byDateMap = new Map<string, { impact: number; effort: number; logs: number; burnouts: number }>();

  let totalImpact = 0;
  let totalEffort = 0;
  let totalAlignment = 0;
  let displaced = 0;
  let burnoutCount = 0;
  let missionCount = 0;

  for (const audit of audits) {
    totalImpact += audit.impact;
    totalEffort += audit.effort;
    totalAlignment += audit.cosTheta;
    if (audit.progress.factor > 0) displaced += 1;
    if (audit.burnoutWarning) burnoutCount += 1;
    if (audit.tactical.code === 'MISSION_SUCCESS') missionCount += 1;

    const day = byDateMap.get(audit.date) ?? { impact: 0, effort: 0, logs: 0, burnouts: 0 };
    day.impact += audit.impact;
    day.effort += audit.effort;
    day.logs += 1;
    if (audit.burnoutWarning) day.burnouts += 1;
    byDateMap.set(audit.date, day);
  }

  const byDate: DaySummary[] = [...byDateMap.entries()]
    .map(([date, day]) => ({
      date,
      impact: roundTo(day.impact, 2),
      effort: day.effort,
      logs: day.logs,
      burnouts: day.burnouts,
    }))
    .sort((left, right) => left.date.localeCompare(right.date));

  return {
    logCount: audits.length,
    totalImpact: roundTo(totalImpact, 2),
    totalEffort,
    averageAlignment: roundTo(totalAlignment / audits.length, 2),
    displacementRate: roundTo(displaced / audits.length, 2),
    burnoutCount,
    missionCount,
    activeDays: byDateMap.size,
    byDate,
  };
}
