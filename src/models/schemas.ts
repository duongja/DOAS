import {
  Schema,
  model,
  type HydratedDocument,
  type Types,
} from 'mongoose';
import type {
  AlignmentType,
  ImpactBand,
  TacticalCode,
  TacticalSeverity,
} from '../core/types';
import type { GoalDTO, LogDTO } from '../shared/types';

/* ————————————————————————————————————————————————
   Goal
———————————————————————————————————————————————— */

export interface GoalRecord {
  title: string;
  movableObject: string;
  immovableWallBehaviors: string[];
  createdAt: Date;
  updatedAt: Date;
}

export type GoalDocument = HydratedDocument<GoalRecord>;

export const GoalSchema = new Schema<GoalRecord>(
  {
    title: {
      type: String,
      required: [true, 'Goal title is required.'],
      trim: true,
      minlength: [2, 'Goal title must be at least 2 characters.'],
      maxlength: [120, 'Goal title cannot exceed 120 characters.'],
    },
    movableObject: {
      type: String,
      required: [true, 'Movable object is required.'],
      trim: true,
      minlength: [2, 'Movable object must be at least 2 characters.'],
      maxlength: [200, 'Movable object cannot exceed 200 characters.'],
    },
    immovableWallBehaviors: {
      type: [String],
      default: [],
      validate: {
        validator: (values: string[]) =>
          values.every((value) => value.trim().length > 0 && value.length <= 160),
        message: 'Each immovable wall behavior must be 1–160 characters.',
      },
    },
  },
  {
    timestamps: true,
    versionKey: false,
    toJSON: { virtuals: false },
  },
);

GoalSchema.index({ createdAt: -1 });
GoalSchema.index({ title: 1 });

export const GoalModel = model<GoalRecord>('Goal', GoalSchema);

export function toGoalDTO(goal: GoalDocument): GoalDTO {
  return {
    id: goal._id.toString(),
    title: goal.title,
    movableObject: goal.movableObject,
    immovableWallBehaviors: [...goal.immovableWallBehaviors],
    createdAt: goal.createdAt.toISOString(),
    updatedAt: goal.updatedAt.toISOString(),
  };
}

/* ————————————————————————————————————————————————
   Log — only the server can write evaluation fields
———————————————————————————————————————————————— */

export interface LogRecord {
  goalId: Types.ObjectId;
  /** Snapshot so the journal stays readable if a goal is archived. */
  goalTitle: string;
  description: string;
  duration: number;
  effort: number;
  progress: boolean;

  // Evaluated by the TypeScript logic engine, never trusted from the client.
  calculatedAlignment: number;
  calculatedImpact: number;
  strategicFeedback: string;
  alignmentType: AlignmentType;
  alignmentRationale: string;
  impactBand: ImpactBand;
  tacticalCode: TacticalCode;
  tacticalHeadline: string;
  severity: TacticalSeverity;
  directives: string[];
  burnoutWarning: boolean;
  formula: string;

  timestamp: Date;
}

export type LogDocument = HydratedDocument<LogRecord>;

export const LogSchema = new Schema<LogRecord>(
  {
    goalId: {
      type: Schema.Types.ObjectId,
      ref: 'Goal',
      required: [true, 'goalId is required.'],
    },
    goalTitle: { type: String, required: true, trim: true },
    description: {
      type: String,
      required: [true, 'Task description is required.'],
      trim: true,
      minlength: [3, 'Task description must be at least 3 characters.'],
      maxlength: [1000, 'Task description cannot exceed 1000 characters.'],
    },
    duration: {
      type: Number,
      required: true,
      min: [0, 'Duration cannot be negative.'],
      max: [1440, 'Duration cannot exceed 24 hours in one debrief.'],
    },
    effort: {
      type: Number,
      required: true,
      min: [1, 'Effort must be at least 1.'],
      max: [10, 'Effort cannot exceed 10.'],
      validate: {
        validator: Number.isInteger,
        message: 'Effort must be an integer between 1 and 10.',
      },
    },
    progress: { type: Boolean, required: true },

    calculatedAlignment: {
      type: Number,
      required: true,
      min: -1,
      max: 1,
    },
    calculatedImpact: {
      type: Number,
      required: true,
      min: -10,
      max: 10,
    },
    strategicFeedback: { type: String, required: true },
    alignmentType: {
      type: String,
      required: true,
      enum: ['direct', 'wall', 'neutral', 'counter'],
    },
    alignmentRationale: { type: String, required: true },
    impactBand: {
      type: String,
      required: true,
      enum: ['counter', 'zero', 'low', 'moderate', 'high', 'exceptional'],
    },
    tacticalCode: { type: String, required: true },
    tacticalHeadline: { type: String, required: true },
    severity: {
      type: String,
      required: true,
      enum: ['success', 'info', 'warning', 'critical'],
    },
    directives: { type: [String], default: [] },
    burnoutWarning: { type: Boolean, default: false },
    formula: { type: String, required: true },

    timestamp: { type: Date, default: Date.now },
  },
  {
    versionKey: false,
    toJSON: { virtuals: false },
  },
);

LogSchema.index({ timestamp: -1 });
LogSchema.index({ goalId: 1, timestamp: -1 });

export const LogModel = model<LogRecord>('Log', LogSchema);

export function toLogDTO(log: LogDocument): LogDTO {
  return {
    id: log._id.toString(),
    goalId: log.goalId.toString(),
    goalTitle: log.goalTitle,
    description: log.description,
    duration: log.duration,
    effort: log.effort,
    progress: log.progress,
    calculatedAlignment: log.calculatedAlignment,
    calculatedImpact: log.calculatedImpact,
    strategicFeedback: log.strategicFeedback,
    timestamp: log.timestamp.toISOString(),
    alignmentType: log.alignmentType,
    alignmentRationale: log.alignmentRationale,
    impactBand: log.impactBand,
    tacticalCode: log.tacticalCode,
    tacticalHeadline: log.tacticalHeadline,
    severity: log.severity,
    directives: [...log.directives],
    burnoutWarning: log.burnoutWarning,
    formula: log.formula,
  };
}
