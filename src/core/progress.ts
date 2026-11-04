import { clamp, roundTo } from './math';
import type { Goal, ProgressInput, ProgressResult } from './types';

const NUMBER_FORMAT = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 2,
});

function signed(value: number): string {
  return value > 0 ? `+${NUMBER_FORMAT.format(value)}` : NUMBER_FORMAT.format(value);
}

/**
 * Convert raw progress into a normalized displacement factor in [0, 1].
 *
 * Binary mode is 0 or 1. Metric mode scales the delta against the goal's
 * `dailyTarget`, capped at 1. A negative delta means the metric regressed and
 * yields 0 useful displacement; direction is represented by cos(θ), not here.
 * This avoids the double-negative problem (regression × counter-alignment
 * would otherwise produce a positive impact).
 */
export function resolveProgress(goal: Goal, progress: ProgressInput): ProgressResult {
  if (progress.type === 'binary') {
    const factor = progress.completed ? 1 : 0;
    return {
      factor,
      kind: 'binary',
      rawDelta: null,
      targetDelta: null,
      completed: progress.completed,
      isZero: factor === 0,
      label: progress.completed ? 'Target displaced' : 'No displacement',
    };
  }

  if (!Number.isFinite(progress.delta)) {
    throw new RangeError('Progress delta must be a finite number.');
  }

  const targetDelta = goal.movableObject.dailyTarget;
  if (!Number.isFinite(targetDelta) || targetDelta <= 0) {
    throw new RangeError('Goal dailyTarget must be a positive number for metric progress.');
  }

  // Negative deltas represent regression, which is zero useful displacement.
  const factor = roundTo(clamp(progress.delta / targetDelta, 0, 1), 4);
  const percent = Math.round(factor * 100);

  return {
    factor,
    kind: 'metric',
    rawDelta: progress.delta,
    targetDelta,
    completed: null,
    isZero: factor === 0,
    label:
      factor === 0 && progress.delta < 0
        ? `Regression (${signed(progress.delta)} ${goal.movableObject.unit})`
        : `${percent}% of daily target (${signed(progress.delta)} / ${NUMBER_FORMAT.format(targetDelta)} ${goal.movableObject.unit})`,
  };
}
