import { Schema, model, type HydratedDocument } from 'mongoose';
import type {
  DeliverableArchiveDTO,
  DeliverableArchiveReason,
  DeliverableStatus,
} from '../shared/types';

export interface DeliverableArchiveItemRecord {
  deliverableId?: string;
  goalTitle: string;
  title: string;
  details: string;
  status: DeliverableStatus;
}

export interface DeliverableArchiveRecord {
  date: string;
  items: DeliverableArchiveItemRecord[];
  capturedAt: Date;
  reason: DeliverableArchiveReason;
}

export type DeliverableArchiveDocument = HydratedDocument<DeliverableArchiveRecord>;

const DeliverableArchiveItemSchema = new Schema<DeliverableArchiveItemRecord>(
  {
    deliverableId: { type: String, default: '' },
    goalTitle: { type: String, required: true, trim: true },
    title: { type: String, required: true, trim: true },
    details: { type: String, default: '', trim: true },
    status: {
      type: String,
      required: true,
      enum: ['planned', 'delivered'],
    },
  },
  { _id: false },
);

const DeliverableArchiveSchema = new Schema<DeliverableArchiveRecord>(
  {
    date: {
      type: String,
      required: true,
      match: /^\d{4}-\d{2}-\d{2}$/,
      unique: true,
      index: true,
    },
    items: {
      type: [DeliverableArchiveItemSchema],
      default: [],
    },
    capturedAt: { type: Date, required: true },
    reason: {
      type: String,
      required: true,
      enum: ['reschedule', 'delete'],
    },
  },
  {
    timestamps: false,
    versionKey: false,
  },
);

export const DeliverableArchiveModel = model<DeliverableArchiveRecord>(
  'DeliverableArchive',
  DeliverableArchiveSchema,
);

export function toDeliverableArchiveDTO(
  archive: DeliverableArchiveDocument,
): DeliverableArchiveDTO {
  return {
    date: archive.date,
    items: archive.items.map((item) => ({
      ...(item.deliverableId ? { deliverableId: item.deliverableId } : {}),
      goalTitle: item.goalTitle,
      title: item.title,
      details: item.details,
      status: item.status,
    })),
    capturedAt: archive.capturedAt.toISOString(),
    reason: archive.reason,
  };
}
