import { Types } from 'mongoose';
import { auditDailyLog } from '../core/audit';
import { significantTokens } from '../core/text';
import type { DailyLog as EngineDailyLog, Goal as EngineGoal } from '../core/types';
import {
  GoalModel,
  LogModel,
  toGoalDTO,
  toLogDTO,
  type GoalDocument,
} from '../models/schemas';
import type {
  CreateGoalRequest,
  CreateLogRequest,
  DailyMetric,
  DashboardDTO,
  GoalDTO,
  LogDTO,
} from '../shared/types';

export class MissionServiceError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = 'MissionServiceError';
    this.status = status;
  }
}

function round(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * The API stores a simple goal shape. The audit engine expects the richer
 * domain model, so we synthesize the missing fields here.
 */
export function toEngineGoal(goal: GoalDocument): EngineGoal {
  return {
    id: goal._id.toString(),
    title: goal.title,
    movableObject: {
      metric: goal.movableObject,
      unit: 'units',
      current: 0,
      target: 1,
      dailyTarget: 1,
    },
    wallBehaviors: goal.immovableWallBehaviors.map((behavior, index) => ({
      id: `wall_${index}`,
      label: behavior,
      matchTerms: [...new Set(significantTokens(behavior).filter((token) => token.length >= 4))],
    })),
    highLeverageActions: [],
    counterProductiveTerms: [],
    createdAt: goal.createdAt.toISOString(),
  };
}

export function toEngineLog(goalId: string, input: CreateLogRequest): EngineDailyLog {
  const now = new Date();
  return {
    id: 'pending',
    goalId,
    date: now.toISOString().slice(0, 10),
    taskDescription: input.description,
    tags: [],
    durationMinutes: input.duration,
    effort: input.effort,
    progress: { type: 'binary', completed: input.progress },
    alignmentSelection: 'auto',
    createdAt: now.toISOString(),
  };
}

export async function listGoals(): Promise<GoalDTO[]> {
  const goals = await GoalModel.find().sort({ createdAt: -1 }).exec();
  return goals.map(toGoalDTO);
}

export async function createGoal(input: CreateGoalRequest): Promise<GoalDTO> {
  const goal = await GoalModel.create(input);
  return toGoalDTO(goal);
}

export async function fileDeployment(input: CreateLogRequest): Promise<LogDTO> {
  const goal = await GoalModel.findById(input.goalId).exec();
  if (!goal) throw new MissionServiceError('Objective not found.', 404);

  const audit = auditDailyLog(toEngineGoal(goal), toEngineLog(goal._id.toString(), input));

  const log = await LogModel.create({
    goalId: goal._id,
    goalTitle: goal.title,
    description: input.description,
    duration: input.duration,
    effort: input.effort,
    progress: input.progress,
    calculatedAlignment: audit.cosTheta,
    calculatedImpact: audit.impact,
    strategicFeedback: audit.tactical.message,
    alignmentType: audit.alignment.type,
    alignmentRationale: audit.alignment.rationale,
    impactBand: audit.impactBand,
    tacticalCode: audit.tactical.code,
    tacticalHeadline: audit.tactical.headline,
    severity: audit.tactical.severity,
    directives: [...audit.tactical.directives],
    burnoutWarning: audit.burnoutWarning,
    formula: audit.formula,
    timestamp: new Date(),
  });

  return toLogDTO(log);
}

export async function listLogs(): Promise<LogDTO[]> {
  const logs = await LogModel.find().sort({ timestamp: -1 }).exec();
  return logs.map(toLogDTO);
}

export async function searchLogs(
  query: string | undefined,
  goalId: string | undefined,
  limit = 20,
): Promise<LogDTO[]> {
  const filter: Record<string, unknown> = {};

  if (goalId) {
    if (!Types.ObjectId.isValid(goalId)) throw new MissionServiceError('Invalid goalId.', 400);
    filter.goalId = new Types.ObjectId(goalId);
  }

  const trimmed = query?.trim();
  if (trimmed) {
    const pattern = new RegExp(trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [
      { description: pattern },
      { goalTitle: pattern },
      { strategicFeedback: pattern },
    ];
  }

  const logs = await LogModel.find(filter)
    .sort({ timestamp: -1 })
    .limit(Math.min(Math.max(limit, 1), 50))
    .exec();

  return logs.map(toLogDTO);
}

export async function getDashboard(): Promise<DashboardDTO> {
  const [totalGoals, logs] = await Promise.all([
    GoalModel.countDocuments().exec(),
    LogModel.find().sort({ timestamp: 1 }).exec(),
  ]);

  const activeCutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  let totalStrategicImpact = 0;
  let totalAlignment = 0;
  let displaced = 0;
  let burnoutFlags = 0;
  let activeAlerts = 0;
  const dailyMap = new Map<string, DailyMetric>();

  for (const log of logs) {
    totalStrategicImpact += log.calculatedImpact;
    totalAlignment += log.calculatedAlignment;
    if (log.progress) displaced += 1;
    if (log.burnoutWarning) burnoutFlags += 1;

    const isAlert = log.severity === 'warning' || log.severity === 'critical';
    if (isAlert && log.timestamp.getTime() >= activeCutoff) activeAlerts += 1;

    const date = log.timestamp.toISOString().slice(0, 10);
    const day = dailyMap.get(date) ?? { date, impact: 0, effort: 0, logs: 0, alerts: 0 };
    day.impact += log.calculatedImpact;
    day.effort += log.effort;
    day.logs += 1;
    if (isAlert) day.alerts += 1;
    dailyMap.set(date, day);
  }

  const dailyMetrics: DailyMetric[] = [...dailyMap.values()]
    .map((day) => ({ ...day, impact: round(day.impact) }))
    .sort((left, right) => left.date.localeCompare(right.date));

  return {
    totalStrategicImpact: round(totalStrategicImpact),
    activeAlerts,
    totalLogs: logs.length,
    totalGoals,
    averageAlignment: logs.length === 0 ? 0 : round(totalAlignment / logs.length),
    burnoutFlags,
    displacementRate: logs.length === 0 ? 0 : round(displaced / logs.length),
    dailyMetrics,
    generatedAt: new Date().toISOString(),
  };
}

export async function getGoal(goalId: string): Promise<GoalDTO | null> {
  if (!Types.ObjectId.isValid(goalId)) return null;
  const goal = await GoalModel.findById(goalId).exec();
  return goal ? toGoalDTO(goal) : null;
}
