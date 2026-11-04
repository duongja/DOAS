import { Schema, model, type HydratedDocument, type Types } from 'mongoose';
import type { DeliverableDTO, DeliverableStatus } from '../shared/types';

export interface DeliverableRecord {
  goalId: Types.ObjectId;
  /** Snapshot so the plan stays readable if a goal is archived. */
  goalTitle: string;
  title: string;
  details: string;
  /** Local calendar date, YYYY-MM-DD. */
  plannedDate: string;
  status: DeliverableStatus;
  deliveredAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export type DeliverableDocument = HydratedDocument<DeliverableRecord>;

export const DeliverableSchema = new Schema<DeliverableRecord>(
  {
    goalId: {
      type: Schema.Types.ObjectId,
      ref: 'Goal',
      required: true,
      index: true,
    },
    goalTitle: { type: String, required: true, trim: true, maxlength: 160 },
    title: { type: String, required: true, trim: true, minlength: 1, maxlength: 160 },
    details: { type: String, default: '', trim: true, maxlength: 1000 },
    plannedDate: {
      type: String,
      required: true,
      match: /^\d{4}-\d{2}-\d{2}$/,
      index: true,
    },
    status: {
      type: String,
      required: true,
      enum: ['planned', 'delivered'],
      default: 'planned',
    },
    deliveredAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

DeliverableSchema.index({ plannedDate: 1, createdAt: 1 });
DeliverableSchema.index({ status: 1, plannedDate: 1 });
DeliverableSchema.index({ goalId: 1, plannedDate: 1 });

export const DeliverableModel = model<DeliverableRecord>(
  'Deliverable',
  DeliverableSchema,
);

export function toDeliverableDTO(deliverable: DeliverableDocument): DeliverableDTO {
  return {
    id: deliverable._id.toString(),
    goalId: deliverable.goalId.toString(),
    goalTitle: deliverable.goalTitle,
    title: deliverable.title,
    details: deliverable.details,
    plannedDate: deliverable.plannedDate,
    status: deliverable.status,
    deliveredAt: deliverable.deliveredAt?.toISOString() ?? null,
    createdAt: deliverable.createdAt.toISOString(),
    updatedAt: deliverable.updatedAt.toISOString(),
  };
}
