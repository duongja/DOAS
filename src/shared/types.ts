import type {
  AlignmentType,
  ImpactBand,
  TacticalCode,
  TacticalSeverity,
} from '../core/types';

/** A strategic objective as returned by the API. */
export interface GoalDTO {
  id: string;
  title: string;
  /** The exact target metric, e.g. "Manuscript words drafted". */
  movableObject: string;
  /** Busywork patterns that cap alignment at 0.20. */
  immovableWallBehaviors: string[];
  createdAt: string;
  updatedAt: string;
}

/** A fully evaluated campaign log returned by the API. */
export interface LogDTO {
  id: string;
  goalId: string;
  goalTitle: string;
  description: string;
  duration: number;
  effort: number;
  progress: boolean;
  calculatedAlignment: number;
  calculatedImpact: number;
  strategicFeedback: string;
  timestamp: string;

  // Server-enriched fields used by the console UI.
  alignmentType: AlignmentType;
  alignmentRationale: string;
  impactBand: ImpactBand;
  tacticalCode: TacticalCode;
  tacticalHeadline: string;
  severity: TacticalSeverity;
  directives: string[];
  burnoutWarning: boolean;
  formula: string;
}

export interface DailyMetric {
  date: string;
  impact: number;
  effort: number;
  logs: number;
  alerts: number;
}

/** Cumulative dashboard payload. */
export interface DashboardDTO {
  totalStrategicImpact: number;
  activeAlerts: number;
  totalLogs: number;
  totalGoals: number;
  averageAlignment: number;
  burnoutFlags: number;
  displacementRate: number;
  dailyMetrics: DailyMetric[];
  generatedAt: string;
}

export interface CreateGoalRequest {
  title: string;
  movableObject: string;
  immovableWallBehaviors: string[];
}

export interface CreateLogRequest {
  goalId: string;
  description: string;
  duration: number;
  effort: number;
  progress: boolean;
}

export type DeliverableStatus = 'planned' | 'delivered';

/** A dated outcome that the user plans to deliver. */
export interface DeliverableDTO {
  id: string;
  goalId: string;
  goalTitle: string;
  title: string;
  details: string;
  /** Local calendar date, YYYY-MM-DD. */
  plannedDate: string;
  status: DeliverableStatus;
  deliveredAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateDeliverableRequest {
  goalId: string;
  title: string;
  plannedDate: string;
  details?: string;
}

export interface UpdateDeliverableRequest {
  title?: string;
  details?: string;
  plannedDate?: string;
  status?: DeliverableStatus;
}

export interface ApiErrorResponse {
  error: string;
  details?: string[];
}
