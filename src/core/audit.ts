import { resolveAlignment } from './alignment';
import { assertEffort, calculateImpact, classifyImpact, detectBurnout } from './impact';
import { resolveProgress } from './progress';
import { generateTacticalResponse } from './tactical';
import type { AuditResult, DailyLog, Goal } from './types';

/**
 * The single entry point for the audit engine.
 *
 * Flow:
 *   1. Validate raw force (F).
 *   2. Normalize displacement (d) to [0, 1].
 *   3. Resolve direction cos(θ) from description + tags.
 *   4. Multiply: Impact = F · d · cos(θ).
 *   5. Flag burnout and generate the tactical response.
 */
export function auditDailyLog(goal: Goal, log: DailyLog): AuditResult {
  if (goal.id !== log.goalId) {
    throw new Error(`Log ${log.id} belongs to goal ${log.goalId}, not ${goal.id}.`);
  }

  const effort = assertEffort(log.effort);
  const progress = resolveProgress(goal, log.progress);
  const alignment = resolveAlignment(goal, log);
  const impact = calculateImpact(effort, progress.factor, alignment.cosTheta);
  const burnoutWarning = detectBurnout(effort, progress.factor);

  const tactical = generateTacticalResponse({
    effort,
    cosTheta: alignment.cosTheta,
    progressFactor: progress.factor,
    impact,
    burnoutWarning,
    alignment,
    movableMetric: goal.movableObject.metric,
  });

  return {
    logId: log.id,
    goalId: goal.id,
    date: log.date,
    effort,
    progress,
    alignment,
    cosTheta: alignment.cosTheta,
    impact,
    impactBand: classifyImpact(impact, alignment.cosTheta, progress.factor),
    burnoutWarning,
    burnoutNote: burnoutWarning
      ? `High force (${effort}/10) with no positive displacement. Reduce load and recover before repeating this pattern.`
      : null,
    tactical,
    formula: `${effort.toFixed(1)} × ${progress.factor.toFixed(2)} × ${alignment.cosTheta.toFixed(2)} = ${impact.toFixed(2)}`,
  };
}

/** Audit every log that belongs to a goal, preserving input order. */
export function auditGoalLogs(goal: Goal, logs: readonly DailyLog[]): AuditResult[] {
  return logs.filter((log) => log.goalId === goal.id).map((log) => auditDailyLog(goal, log));
}
