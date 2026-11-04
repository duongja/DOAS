/**
 * Diaries of a Soldier — domain model
 * ------------------------------------
 * The app translates the physics work equation:
 *
 *     W = F · d · cos(θ)
 *
 * into a productivity framework:
 *
 *     Impact = Effort · Progress · Alignment
 *
 * This file is intentionally free of React and browser APIs. The engine can be
 * imported by a web client, a CLI, a server, or a test runner unchanged.
 */

/** The four ways an action can relate to an objective. */
export type AlignmentType = 'direct' | 'wall' | 'neutral' | 'counter';

/** A log can auto-detect alignment, or the operator can override it. */
export type AlignmentSelection = 'auto' | AlignmentType;

/**
 * Progress is displacement toward the target.
 *
 * - `binary`: the target metric moved or it did not.
 * - `metric`: a raw delta is scaled against the goal's daily target.
 *
 * Note: progress is a magnitude in [0, 1]. Direction is carried entirely by
 * cos(θ); this prevents two negatives (regression × counter-alignment) from
 * producing a nonsensical positive impact.
 */
export type ProgressInput =
  | { readonly type: 'binary'; readonly completed: boolean }
  | { readonly type: 'metric'; readonly delta: number };

/** The exact target metric that a goal is trying to move. */
export interface MovableObject {
  /** Human-readable metric name, e.g. "Manuscript words drafted". */
  readonly metric: string;
  /** Unit of the metric, e.g. "words", "km", "calls". */
  readonly unit: string;
  /** Current value of the metric. */
  readonly current: number;
  /** Desired value of the metric. */
  readonly target: number;
  /** Displacement expected from one focused session; used to scale metric deltas. */
  readonly dailyTarget: number;
}

/**
 * A recognizable behavior. Wall behaviors are low-leverage actions that *feel*
 * like work; high-leverage actions are the ones that move the target.
 */
export interface BehaviorPattern {
  readonly id: string;
  readonly label: string;
  /** Phrases/tags matched against the task description. The label is also matched. */
  readonly matchTerms: readonly string[];
}

/** A single objective: a movable object plus its walls and leverage actions. */
export interface Goal {
  readonly id: string;
  readonly title: string;
  readonly movableObject: MovableObject;
  readonly wallBehaviors: readonly BehaviorPattern[];
  readonly highLeverageActions: readonly BehaviorPattern[];
  /** Strong signals that an action is actively moving away from the objective. */
  readonly counterProductiveTerms: readonly string[];
  readonly createdAt: string;
}

/** A daily debrief entry. */
export interface DailyLog {
  readonly id: string;
  readonly goalId: string;
  /** Local calendar date, `YYYY-MM-DD`. */
  readonly date: string;
  readonly taskDescription: string;
  readonly tags: readonly string[];
  readonly durationMinutes: number;
  /** Raw force input, integer 1–10. */
  readonly effort: number;
  readonly progress: ProgressInput;
  readonly alignmentSelection: AlignmentSelection;
  readonly createdAt: string;
}

export interface MatchedPattern {
  readonly pattern: BehaviorPattern;
  readonly terms: readonly string[];
}

export interface AlignmentEvidence {
  readonly wall: MatchedPattern | null;
  readonly leverage: MatchedPattern | null;
  readonly counterTerm: string | null;
  /** Significant tokens from the movable-object metric found in the task. */
  readonly movableTerms: readonly string[];
}

export interface AlignmentResult {
  readonly type: AlignmentType;
  readonly cosTheta: number;
  readonly source: 'auto' | 'operator';
  readonly evidence: AlignmentEvidence;
  /** Human-readable explanation of why this coefficient was chosen. */
  readonly rationale: string;
}

export interface ProgressResult {
  readonly factor: number;
  readonly kind: 'binary' | 'metric';
  readonly rawDelta: number | null;
  readonly targetDelta: number | null;
  readonly completed: boolean | null;
  readonly isZero: boolean;
  readonly label: string;
}

export type ImpactBand =
  | 'counter'
  | 'zero'
  | 'low'
  | 'moderate'
  | 'high'
  | 'exceptional';

export type TacticalSeverity = 'success' | 'info' | 'warning' | 'critical';

export type TacticalCode =
  | 'COUNTER_PRODUCTIVE'
  | 'STRATEGIC_ALERT'
  | 'BURNOUT_WARNING'
  | 'MISSION_SUCCESS'
  | 'TARGET_STRUCK'
  | 'VECTOR_LOCKED'
  | 'ORTHOGONAL_MOTION'
  | 'DIRECTIONAL_DRIFT'
  | 'RECOVERY'
  | 'NO_DISPLACEMENT'
  | 'DEBRIEF_LOGGED';

export interface TacticalResponse {
  readonly code: TacticalCode;
  readonly severity: TacticalSeverity;
  readonly headline: string;
  /** The primary strategic evaluation. */
  readonly message: string;
  /** Concrete next actions, in priority order. */
  readonly directives: readonly string[];
}

/** The complete output payload for one day's audit. */
export interface AuditResult {
  readonly logId: string;
  readonly goalId: string;
  readonly date: string;
  readonly effort: number;
  readonly progress: ProgressResult;
  readonly alignment: AlignmentResult;
  readonly cosTheta: number;
  /** Effort × progressFactor × cosTheta, rounded to two decimals. */
  readonly impact: number;
  readonly impactBand: ImpactBand;
  readonly burnoutWarning: boolean;
  readonly burnoutNote: string | null;
  readonly tactical: TacticalResponse;
  /** Rendered calculation for the UI, e.g. "8 × 0.67 × 0.20 = 1.07". */
  readonly formula: string;
}

export interface DaySummary {
  readonly date: string;
  readonly impact: number;
  readonly effort: number;
  readonly logs: number;
  readonly burnouts: number;
}

export interface AuditSummary {
  readonly logCount: number;
  readonly totalImpact: number;
  readonly totalEffort: number;
  readonly averageAlignment: number;
  readonly displacementRate: number;
  readonly burnoutCount: number;
  readonly missionCount: number;
  readonly activeDays: number;
  readonly byDate: readonly DaySummary[];
}
