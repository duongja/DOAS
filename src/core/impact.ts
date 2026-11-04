import { DEFAULT_TACTICAL_THRESHOLDS } from './constants';
import { roundTo } from './math';
import type { ImpactBand } from './types';

/** Validate and return a raw effort rating. Effort is an integer from 1 to 10. */
export function assertEffort(effort: number): number {
  if (
    !Number.isInteger(effort) ||
    effort < DEFAULT_TACTICAL_THRESHOLDS.minEffort ||
    effort > DEFAULT_TACTICAL_THRESHOLDS.maxEffort
  ) {
    throw new RangeError(
      `Effort must be an integer between ${DEFAULT_TACTICAL_THRESHOLDS.minEffort} and ${DEFAULT_TACTICAL_THRESHOLDS.maxEffort}. Received: ${effort}`,
    );
  }
  return effort;
}

/**
 * W = F · d · cos(θ)
 *
 * - effort (F): 1–10
 * - progressFactor (d): 0–1
 * - cosTheta: -1.0 to 1.0
 *
 * Result range: -10 to +10, rounded to two decimals.
 */
export function calculateImpact(
  effort: number,
  progressFactor: number,
  cosTheta: number,
): number {
  return roundTo(effort * progressFactor * cosTheta, 2);
}

/** A high force with no positive displacement is the signature of burnout. */
export function detectBurnout(effort: number, progressFactor: number): boolean {
  return effort > DEFAULT_TACTICAL_THRESHOLDS.highEffort && progressFactor <= 0;
}

export function classifyImpact(
  impact: number,
  cosTheta: number,
  progressFactor: number,
): ImpactBand {
  if (cosTheta < 0) return 'counter';
  if (impact <= 0 || progressFactor <= 0) return 'zero';
  if (impact < 2.5) return 'low';
  if (impact < 5) return 'moderate';
  if (impact < 8) return 'high';
  return 'exceptional';
}
