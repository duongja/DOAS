import type { AlignmentType } from './types';

/**
 * Fixed coefficients for the four alignment classes.
 *
 * These are the only values the engine assigns without a manual override.
 * They are intentionally coarse: the audit is a decision aid, not a
 * pseudo-precise measurement.
 */
export const ALIGNMENT_COEFFICIENTS: Readonly<Record<AlignmentType, number>> = {
  direct: 1.0,
  wall: 0.2,
  neutral: 0.0,
  counter: -1.0,
};

export interface AlignmentMeta {
  readonly label: string;
  readonly shortLabel: string;
  readonly description: string;
}

export const ALIGNMENT_META: Readonly<Record<AlignmentType, AlignmentMeta>> = {
  direct: {
    label: 'Direct vector',
    shortLabel: 'Direct',
    description: 'The action directly moves the target metric.',
  },
  wall: {
    label: 'Immovable wall',
    shortLabel: 'Wall',
    description: 'Busywork that feels productive but does not move the metric.',
  },
  neutral: {
    label: 'Neutral / orthogonal',
    shortLabel: 'Neutral',
    description: 'Force applied at 90°: no useful displacement.',
  },
  counter: {
    label: 'Counter-productive',
    shortLabel: 'Counter',
    description: 'The action actively moves away from the objective.',
  },
};

/** Thresholds used by the tactical response generator. */
export interface TacticalThresholds {
  /** "High effort" means strictly greater than this value. */
  highEffort: number;
  /** At or below this coefficient, alignment is considered low. */
  lowAlignment: number;
  /** At or above this coefficient, alignment is considered high. */
  highAlignment: number;
  /** At or above this progress factor, displacement is considered high. */
  highProgress: number;
  /** At or above this impact, the result is a strong strike. */
  strongImpact: number;
  minEffort: number;
  maxEffort: number;
}

export const DEFAULT_TACTICAL_THRESHOLDS: TacticalThresholds = {
  highEffort: 7,
  lowAlignment: 0.2,
  highAlignment: 0.9,
  highProgress: 0.75,
  strongImpact: 6,
  minEffort: 1,
  maxEffort: 10,
};
