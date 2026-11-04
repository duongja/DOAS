import { describe, expect, it } from 'vitest';
import { auditDailyLog } from './audit';
import { resolveAlignment } from './alignment';
import { detectBurnout, calculateImpact } from './impact';
import { resolveProgress } from './progress';
import { summarizeAudits } from './summary';
import { phraseMatches, tokenize } from './text';
import type { DailyLog, Goal } from './types';

const goal: Goal = {
  id: 'goal_field_manual',
  title: 'Ship the field manual',
  movableObject: {
    metric: 'Manuscript words drafted',
    unit: 'words',
    current: 12_000,
    target: 60_000,
    dailyTarget: 1_000,
  },
  wallBehaviors: [
    { id: 'wall_inbox', label: 'Inbox zero', matchTerms: ['inbox', 'email', 'emails', 'slack'] },
    { id: 'wall_tools', label: 'Tool shopping', matchTerms: ['new app', 'notion template'] },
  ],
  highLeverageActions: [
    { id: 'lever_draft', label: 'Draft the next section', matchTerms: ['draft', 'write', 'chapter'] },
    { id: 'lever_ship', label: 'Ship a field note', matchTerms: ['publish', 'ship'] },
  ],
  counterProductiveTerms: ['doomscroll', 'procrastinate', 'rage scroll'],
  createdAt: '2026-01-01T00:00:00.000Z',
};

let logSequence = 0;

function makeLog(overrides: Partial<DailyLog> = {}): DailyLog {
  logSequence += 1;
  return {
    id: `log_${logSequence}`,
    goalId: goal.id,
    date: '2026-11-03',
    taskDescription: 'Drafted 1,200 words on the manuscript',
    tags: [],
    durationMinutes: 60,
    effort: 5,
    progress: { type: 'metric', delta: 1_000 },
    alignmentSelection: 'auto',
    createdAt: '2026-11-03T18:00:00.000Z',
    ...overrides,
  };
}

describe('text matching', () => {
  it('matches whole phrases and light inflections', () => {
    const haystack = tokenize('I am researching emails and drafting chapters');
    expect(phraseMatches(haystack, 'research')).toBe(true);
    expect(phraseMatches(haystack, 'email')).toBe(true);
    expect(phraseMatches(haystack, 'draft')).toBe(true);
    expect(phraseMatches(haystack, 'chapter')).toBe(true);
    expect(phraseMatches(haystack, 'art')).toBe(false);
  });
});

describe('alignment engine', () => {
  it('drops to 0.2 when an immovable wall behavior is matched', () => {
    const log = makeLog({ taskDescription: 'Cleaned the inbox for two hours', tags: [] });
    const result = resolveAlignment(goal, log);

    expect(result.type).toBe('wall');
    expect(result.cosTheta).toBe(0.2);
    expect(result.evidence.wall?.pattern.label).toBe('Inbox zero');
  });

  it('matches wall behaviors from tags even when the description is vague', () => {
    const log = makeLog({ taskDescription: 'Cleaned things up for a while', tags: ['inbox'] });
    expect(resolveAlignment(goal, log).cosTheta).toBe(0.2);
  });

  it('locks to 1.0 for a high-leverage action', () => {
    const log = makeLog({ taskDescription: 'Drafted the next section', tags: [] });
    const result = resolveAlignment(goal, log);

    expect(result.type).toBe('direct');
    expect(result.cosTheta).toBe(1);
    expect(result.evidence.leverage?.pattern.label).toBe('Draft the next section');
  });

  it('locks to 1.0 when the task directly references the movable object', () => {
    const noActionsGoal: Goal = { ...goal, highLeverageActions: [] };
    const log = makeLog({ taskDescription: 'Added 800 manuscript words today', tags: [] });
    expect(resolveAlignment(noActionsGoal, log).cosTheta).toBe(1);
  });

  it('lets a wall take precedence over a simultaneous leverage match', () => {
    const log = makeLog({ taskDescription: 'Drafted an email about the manuscript', tags: [] });
    expect(resolveAlignment(goal, log).type).toBe('wall');
  });

  it('lets a counter-productive signal override a wall match', () => {
    const log = makeLog({ taskDescription: 'Doomscrolled email for an hour', tags: [] });
    expect(resolveAlignment(goal, log).type).toBe('counter');
    expect(resolveAlignment(goal, log).cosTheta).toBe(-1);
  });

  it('uses neutral 0.0 when nothing is detected', () => {
    const log = makeLog({ taskDescription: 'Attended an unrelated status meeting', tags: [] });
    const result = resolveAlignment(goal, log);

    expect(result.type).toBe('neutral');
    expect(result.cosTheta).toBe(0);
  });

  it('honors an explicit operator override', () => {
    const log = makeLog({ taskDescription: 'Drafted the next section', alignmentSelection: 'wall' });
    const result = resolveAlignment(goal, log);

    expect(result.type).toBe('wall');
    expect(result.cosTheta).toBe(0.2);
    expect(result.source).toBe('operator');
  });
});

describe('progress and impact', () => {
  it('scales a metric delta against the daily target', () => {
    const log = makeLog({ progress: { type: 'metric', delta: 500 } });
    const progress = resolveProgress(goal, log.progress);
    expect(progress.factor).toBe(0.5);
  });

  it('caps over-delivery at 1.0', () => {
    const log = makeLog({ progress: { type: 'metric', delta: 5_000 } });
    expect(resolveProgress(goal, log.progress).factor).toBe(1);
  });

  it('treats regression as zero useful displacement', () => {
    const log = makeLog({ progress: { type: 'metric', delta: -250 } });
    const progress = resolveProgress(goal, log.progress);
    expect(progress.factor).toBe(0);
    expect(progress.label).toContain('Regression');
  });

  it('computes Impact = Effort × Progress × Alignment', () => {
    expect(calculateImpact(8, 0.5, 1)).toBe(4);
    expect(calculateImpact(8, 0.5, 0.2)).toBe(0.8);
    expect(calculateImpact(6, 1, -1)).toBe(-6);
  });

  it('flags burnout only for high effort with no displacement', () => {
    expect(detectBurnout(8, 0)).toBe(true);
    expect(detectBurnout(10, 0)).toBe(true);
    expect(detectBurnout(7, 0)).toBe(false);
    expect(detectBurnout(8, 0.1)).toBe(false);
  });

  it('rejects invalid effort and metric targets', () => {
    expect(() => auditDailyLog(goal, makeLog({ effort: 0 }))).toThrow(RangeError);
    expect(() => auditDailyLog(goal, makeLog({ effort: 11 }))).toThrow(RangeError);
    const brokenGoal: Goal = {
      ...goal,
      movableObject: { ...goal.movableObject, dailyTarget: 0 },
    };
    expect(() =>
      auditDailyLog(brokenGoal, makeLog({ progress: { type: 'metric', delta: 100 } })),
    ).toThrow(RangeError);
  });
});

describe('audit payload and tactical responses', () => {
  it('emits the exact strategic alert for high effort + low alignment', () => {
    const audit = auditDailyLog(
      goal,
      makeLog({
        taskDescription: 'Cleaned the inbox all afternoon',
        effort: 9,
        progress: { type: 'binary', completed: false },
      }),
    );

    expect(audit.cosTheta).toBe(0.2);
    expect(audit.impact).toBe(0);
    expect(audit.burnoutWarning).toBe(true);
    expect(audit.tactical.code).toBe('STRATEGIC_ALERT');
    expect(audit.tactical.message).toBe(
      '⚠️ Strategic Alert: High effort, low displacement. You are pushing an immovable wall. Realign your vector immediately.',
    );
  });

  it('emits the exact mission success string for high alignment + high progress', () => {
    const audit = auditDailyLog(
      goal,
      makeLog({ effort: 8, progress: { type: 'metric', delta: 1_500 } }),
    );

    expect(audit.impact).toBe(8);
    expect(audit.impactBand).toBe('exceptional');
    expect(audit.tactical.code).toBe('MISSION_SUCCESS');
    expect(audit.tactical.message).toBe(
      '⚡ Mission Successful: Optimal energy transfer achieved. Vector is holding target direction.',
    );
  });

  it('emits the exact counter-productive abort string for negative alignment', () => {
    const audit = auditDailyLog(
      goal,
      makeLog({
        taskDescription: 'Doomscrolled for two hours instead of writing',
        effort: 5,
        progress: { type: 'binary', completed: true },
      }),
    );

    expect(audit.cosTheta).toBe(-1);
    expect(audit.impact).toBe(-5);
    expect(audit.impactBand).toBe('counter');
    expect(audit.tactical.code).toBe('COUNTER_PRODUCTIVE');
    expect(audit.tactical.message).toBe(
      '🛑 Counter-Productive Vector: Abort current action. You are actively moving away from base objectives.',
    );
  });

  it('raises a burnout warning when a direct task fails to move the target', () => {
    const audit = auditDailyLog(
      goal,
      makeLog({
        taskDescription: 'Drafted the next section',
        effort: 9,
        progress: { type: 'binary', completed: false },
      }),
    );

    expect(audit.alignment.type).toBe('direct');
    expect(audit.burnoutWarning).toBe(true);
    expect(audit.burnoutNote).not.toBeNull();
    expect(audit.tactical.code).toBe('BURNOUT_WARNING');
  });

  it('renders the calculation in the payload', () => {
    const audit = auditDailyLog(
      goal,
      makeLog({ effort: 8, progress: { type: 'metric', delta: 500 } }),
    );
    expect(audit.formula).toBe('8.0 × 0.50 × 1.00 = 4.00');
  });

  it('distinguishes wall drift from orthogonal motion when progress is positive', () => {
    const orthogonal = auditDailyLog(
      goal,
      makeLog({
        taskDescription: 'Attended an unrelated status meeting',
        effort: 4,
        progress: { type: 'binary', completed: true },
      }),
    );
    expect(orthogonal.alignment.type).toBe('neutral');
    expect(orthogonal.tactical.code).toBe('ORTHOGONAL_MOTION');

    const drift = auditDailyLog(
      goal,
      makeLog({
        taskDescription: 'Cleaned the inbox',
        effort: 4,
        progress: { type: 'binary', completed: true },
      }),
    );
    expect(drift.alignment.type).toBe('wall');
    expect(drift.tactical.code).toBe('DIRECTIONAL_DRIFT');
  });

  it('summarizes a set of audits', () => {
    const audits = [
      auditDailyLog(goal, makeLog({ date: '2026-11-01', effort: 8 })),
      auditDailyLog(
        goal,
        makeLog({
          date: '2026-11-01',
          effort: 8,
          taskDescription: 'Cleaned the inbox',
          progress: { type: 'binary', completed: false },
        }),
      ),
      auditDailyLog(goal, makeLog({ date: '2026-11-02', effort: 6, progress: { type: 'metric', delta: 500 } })),
    ];

    const summary = summarizeAudits(audits);
    expect(summary.logCount).toBe(3);
    expect(summary.totalImpact).toBe(11);
    expect(summary.averageAlignment).toBe(0.73);
    expect(summary.burnoutCount).toBe(1);
    expect(summary.activeDays).toBe(2);
    expect(summary.byDate).toHaveLength(2);
  });
});
