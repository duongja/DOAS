import { DEFAULT_TACTICAL_THRESHOLDS, type TacticalThresholds } from './constants';
import type { AlignmentResult, TacticalCode, TacticalResponse, TacticalSeverity } from './types';

export interface TacticalContext {
  readonly effort: number;
  readonly cosTheta: number;
  readonly progressFactor: number;
  readonly impact: number;
  readonly burnoutWarning: boolean;
  readonly alignment: AlignmentResult;
  /** Used in directives so the advice names the actual objective. */
  readonly movableMetric: string;
}

function response(
  code: TacticalCode,
  severity: TacticalSeverity,
  headline: string,
  message: string,
  directives: readonly string[],
): TacticalResponse {
  return { code, severity, headline, message, directives };
}

/**
 * Translate a numeric audit into a strategic verdict.
 *
 * Branch order matters. Critical/abort signals are evaluated before positive
 * signals; a negative alignment always aborts, even if effort is high.
 *
 * The three required strings from the product spec are emitted verbatim.
 */
export function generateTacticalResponse(
  context: TacticalContext,
  thresholds: TacticalThresholds = DEFAULT_TACTICAL_THRESHOLDS,
): TacticalResponse {
  const { effort, cosTheta, progressFactor, impact, burnoutWarning, alignment, movableMetric } =
    context;
  const highEffort = effort > thresholds.highEffort;
  const lowAlignment = cosTheta <= thresholds.lowAlignment;
  const highAlignment = cosTheta >= thresholds.highAlignment;
  const highProgress = progressFactor >= thresholds.highProgress;
  const wallLabel = alignment.evidence.wall?.pattern.label;

  // 1. Negative alignment is an unconditional abort.
  if (cosTheta < 0) {
    return response(
      'COUNTER_PRODUCTIVE',
      'critical',
      'Counter-Productive Vector',
      '🛑 Counter-Productive Vector: Abort current action. You are actively moving away from base objectives.',
      [
        'Stop the action now. Do not "finish the loop" first.',
        'Remove the trigger from the environment before the next session.',
        `Run one 10-minute action that directly moves "${movableMetric}".`,
      ],
    );
  }

  // 2. High force against a wall (or orthogonal work) — the core strategic alert.
  if (highEffort && lowAlignment) {
    return response(
      'STRATEGIC_ALERT',
      'warning',
      'Strategic Alert',
      '⚠️ Strategic Alert: High effort, low displacement. You are pushing an immovable wall. Realign your vector immediately.',
      [
        wallLabel
          ? `Timebox or abandon "${wallLabel}" today.`
          : 'Stop applying force to the current action.',
        `Identify the smallest action that directly moves "${movableMetric}".`,
        'Reallocate the next 25 minutes to that action.',
      ],
    );
  }

  // 3. Exhaustion masquerading as effort.
  if (burnoutWarning) {
    return response(
      'BURNOUT_WARNING',
      'warning',
      'Burnout Warning',
      `🪫 Burnout Warning: ${effort}/10 force produced zero target displacement. Rest before reapplying force; exhaustion is not a strategy.`,
      [
        'Stand down for the remainder of this block.',
        'Recover: food, movement, sleep, or a hard stop from the screen.',
        `Re-enter with a 15-minute direct action on "${movableMetric}", not a longer grind.`,
      ],
    );
  }

  // 4. Required success state: high alignment + high progress.
  if (highAlignment && highProgress) {
    return response(
      'MISSION_SUCCESS',
      'success',
      'Mission Successful',
      '⚡ Mission Successful: Optimal energy transfer achieved. Vector is holding target direction.',
      [
        'Log the exact action pattern while it is fresh.',
        'Protect the same block on tomorrow’s schedule.',
        'Increase load only after the pattern repeats twice.',
      ],
    );
  }

  // 5. Strong numeric impact without hitting the strict success thresholds.
  if (impact >= thresholds.strongImpact) {
    return response(
      'TARGET_STRUCK',
      'success',
      'Target Struck',
      `🎯 Target Struck: ${impact.toFixed(2)} impact delivered at ${Math.round(progressFactor * 100)}% displacement. Capture what made it repeatable.`,
      [
        'Record the conditions: time, place, and first action.',
        `Repeat the same vector against "${movableMetric}" tomorrow.`,
        'Do not add new tactics while this one is working.',
      ],
    );
  }

  // 6. High alignment, some progress, but below the success bar.
  if (highAlignment && progressFactor > 0) {
    return response(
      'VECTOR_LOCKED',
      'success',
      'Vector Locked',
      '📈 Vector Locked: Displacement is real and alignment is high. Keep the same action pattern.',
      [
        `Continue the current action on "${movableMetric}".`,
        'Remove one source of friction before the next block.',
        'Log the next session immediately after it ends.',
      ],
    );
  }

  // 7. Movement, but the action is grazing a wall.
  if (progressFactor > 0 && alignment.type === 'wall') {
    return response(
      'DIRECTIONAL_DRIFT',
      'warning',
      'Directional Drift',
      '🧭 Directional Drift: The target moved, but this action is grazing an immovable wall. Trim the low-leverage edges.',
      [
        wallLabel ? `Cut "${wallLabel}" from the next block.` : 'Remove the low-leverage component.',
        'Keep only the step that directly touches the target metric.',
        'Re-audit after one focused session.',
      ],
    );
  }

  // 7b. Movement with no configured relationship to the objective.
  if (progressFactor > 0 && alignment.type === 'neutral') {
    return response(
      'ORTHOGONAL_MOTION',
      'warning',
      'Orthogonal Motion',
      '🧭 Orthogonal Motion: The metric moved, but the action is orthogonal to the objective. Treat the displacement as coincidence, then wire the task to a direct action.',
      [
        `Name the exact connection between this task and "${movableMetric}".`,
        'Attach a high-leverage action or reclassify the task.',
        'Re-run the audit before repeating it.',
      ],
    );
  }

  // 8. Low force + zero displacement is legitimate recovery, not failure.
  if (effort <= 3 && progressFactor <= 0 && cosTheta > thresholds.lowAlignment) {
    return response(
      'RECOVERY',
      'info',
      'Deliberate Recovery',
      '🛌 Deliberate Recovery: Low force, zero displacement, no wall contact. Recovery is a phase, not a failure — schedule the next strike.',
      [
        'Keep the recovery block bounded and intentional.',
        `Schedule one direct action on "${movableMetric}" within 24 hours.`,
        'Do not compensate with a double-length grind.',
      ],
    );
  }

  // 9. Force with no displacement, but not enough force to trigger burnout.
  if (progressFactor <= 0) {
    return response(
      'NO_DISPLACEMENT',
      'warning',
      'No Displacement',
      '📋 No Displacement: Force was applied without target movement. Diagnose the constraint before adding more effort.',
      [
        'Name the constraint: unclear next step, missing input, or avoidance.',
        `Shrink the next action until it visibly changes "${movableMetric}".`,
        'Timebox the next attempt to 15 minutes.',
      ],
    );
  }

  // 10. Mixed but valid day.
  return response(
    'DEBRIEF_LOGGED',
    'info',
    'Debrief Logged',
    '📋 Debrief Logged: Mixed vector. One clean high-leverage action beats an hour of noise.',
    [
      `Choose one direct action on "${movableMetric}" for tomorrow.`,
      'Prune one wall behavior from the calendar.',
      'Re-run the audit at the end of the day.',
    ],
  );
}
