import { ALIGNMENT_COEFFICIENTS, ALIGNMENT_META } from './constants';
import {
  matchPatterns,
  matchTermList,
  phraseMatches,
  significantTokens,
  tokenize,
  uniqueTokens,
} from './text';
import type {
  AlignmentEvidence,
  AlignmentResult,
  AlignmentType,
  DailyLog,
  Goal,
} from './types';

/**
 * DETECTION PRECEDENCE (auto mode)
 * --------------------------------
 * 1. Counter-productive signal      -> cos θ = -1.0
 * 2. Immovable wall behavior        -> cos θ =  0.2
 * 3. High-leverage action or
 *    movable-object reference       -> cos θ =  1.0
 * 4. Nothing detected               -> cos θ =  0.0
 *
 * Counter-productive wins because it is an active "abort" signal. Wall wins
 * over leverage because a task can mention the target metric while still being
 * busywork (e.g. "reorganizing the manuscript folder"). This conservative
 * order prevents busywork from being promoted to full alignment.
 */

const TYPE_LABEL: Readonly<Record<AlignmentType, string>> = {
  direct: 'Direct vector',
  wall: 'Immovable wall',
  neutral: 'Neutral / orthogonal',
  counter: 'Counter-productive',
};

export function alignmentCoefficient(type: AlignmentType): number {
  return ALIGNMENT_COEFFICIENTS[type];
}

function formatCoefficient(value: number): string {
  return value.toFixed(1);
}

/**
 * Resolve cos(θ) for a log.
 *
 * An operator override always wins; otherwise the description + tags are
 * scanned against the goal's wall behaviors, leverage actions, movable object,
 * and counter-productive terms.
 */
export function resolveAlignment(goal: Goal, log: DailyLog): AlignmentResult {
  const haystack = tokenize([log.taskDescription, ...log.tags].join(' '));

  const wallMatches = matchPatterns(haystack, goal.wallBehaviors);
  const leverageMatches = matchPatterns(haystack, goal.highLeverageActions);
  const counterMatches = matchTermList(haystack, goal.counterProductiveTerms);

  const movableCandidates = uniqueTokens(
    significantTokens(`${goal.movableObject.metric} ${goal.movableObject.unit}`),
  );
  const movableTerms = movableCandidates.filter((term) => phraseMatches(haystack, term));

  const evidence: AlignmentEvidence = {
    wall: wallMatches[0] ?? null,
    leverage: leverageMatches[0] ?? null,
    counterTerm: counterMatches[0] ?? null,
    movableTerms,
  };

  // Operator override: the human can correct the classifier.
  if (log.alignmentSelection !== 'auto') {
    const type = log.alignmentSelection;
    const cosTheta = alignmentCoefficient(type);

    return {
      type,
      cosTheta,
      source: 'operator',
      evidence,
      rationale: `Operator override: ${TYPE_LABEL[type]}. cos θ fixed at ${formatCoefficient(cosTheta)}.`,
    };
  }

  // 1. Active counter-productive signal.
  if (evidence.counterTerm !== null) {
    return {
      type: 'counter',
      cosTheta: ALIGNMENT_COEFFICIENTS.counter,
      source: 'auto',
      evidence,
      rationale: `Counter-productive term "${evidence.counterTerm}" matched. cos θ = ${formatCoefficient(ALIGNMENT_COEFFICIENTS.counter)}.`,
    };
  }

  // 2. Immovable wall behavior.
  if (evidence.wall !== null) {
    const blockedLeverage =
      evidence.leverage !== null
        ? ` Wall takes precedence over the high-leverage match "${evidence.leverage.pattern.label}".`
        : '';
    return {
      type: 'wall',
      cosTheta: ALIGNMENT_COEFFICIENTS.wall,
      source: 'auto',
      evidence,
      rationale: `Wall behavior "${evidence.wall.pattern.label}" matched [${evidence.wall.terms.join(', ')}]. cos θ = ${formatCoefficient(ALIGNMENT_COEFFICIENTS.wall)}.${blockedLeverage}`,
    };
  }

  // 3. Direct leverage.
  if (evidence.leverage !== null) {
    return {
      type: 'direct',
      cosTheta: ALIGNMENT_COEFFICIENTS.direct,
      source: 'auto',
      evidence,
      rationale: `High-leverage action "${evidence.leverage.pattern.label}" matched [${evidence.leverage.terms.join(', ')}]. cos θ = ${formatCoefficient(ALIGNMENT_COEFFICIENTS.direct)}.`,
    };
  }

  if (evidence.movableTerms.length > 0) {
    return {
      type: 'direct',
      cosTheta: ALIGNMENT_COEFFICIENTS.direct,
      source: 'auto',
      evidence,
      rationale: `Task references the movable object [${evidence.movableTerms.join(', ')}]. cos θ = ${formatCoefficient(ALIGNMENT_COEFFICIENTS.direct)}.`,
    };
  }

  // 4. No signal: force is orthogonal to the objective.
  return {
    type: 'neutral',
    cosTheta: ALIGNMENT_COEFFICIENTS.neutral,
    source: 'auto',
    evidence,
    rationale: `No wall, leverage, or counter-productive signal detected for "${goal.movableObject.metric}". cos θ = ${formatCoefficient(ALIGNMENT_COEFFICIENTS.neutral)}.`,
  };
}

/** Utility used by the UI to describe an alignment class. */
export function describeAlignment(type: AlignmentType): string {
  return ALIGNMENT_META[type].description;
}

export { ALIGNMENT_COEFFICIENTS, ALIGNMENT_META };
