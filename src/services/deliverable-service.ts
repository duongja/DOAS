import { Types } from 'mongoose';
import { DeliverableModel, toDeliverableDTO } from '../models/deliverable';
import { GoalModel } from '../models/schemas';
import type {
  CreateDeliverableRequest,
  DeliverableDTO,
  UpdateDeliverableRequest,
} from '../shared/types';

export class DeliverableServiceError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = 'DeliverableServiceError';
    this.status = status;
  }
}

export function isValidPlannedDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  return (
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
  );
}

function cleanTitle(value: string): string {
  const title = value.trim();
  if (title.length < 1 || title.length > 160) {
    throw new DeliverableServiceError('Deliverable title must be 1–160 characters.');
  }
  return title;
}

function cleanDetails(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const details = value.trim();
  if (details.length > 1000) {
    throw new DeliverableServiceError('Details cannot exceed 1,000 characters.');
  }
  return details;
}

function cleanDate(value: string): string {
  const date = value.trim();
  if (!isValidPlannedDate(date)) {
    throw new DeliverableServiceError('plannedDate must be a valid YYYY-MM-DD date.');
  }
  return date;
}

export async function listDeliverables(filter: {
  from?: string;
  to?: string;
  goalId?: string;
} = {}): Promise<DeliverableDTO[]> {
  const query: Record<string, unknown> = {};

  if (filter.goalId) {
    if (!Types.ObjectId.isValid(filter.goalId)) {
      throw new DeliverableServiceError('Invalid goalId.');
    }
    query.goalId = new Types.ObjectId(filter.goalId);
  }

  if (filter.from || filter.to) {
    const range: Record<string, string> = {};
    if (filter.from) range.$gte = cleanDate(filter.from);
    if (filter.to) range.$lte = cleanDate(filter.to);
    query.plannedDate = range;
  }

  const deliverables = await DeliverableModel.find(query)
    .sort({ plannedDate: 1, createdAt: 1 })
    .exec();

  return deliverables.map(toDeliverableDTO);
}

export async function createDeliverable(
  input: CreateDeliverableRequest,
): Promise<DeliverableDTO> {
  if (!Types.ObjectId.isValid(input.goalId)) {
    throw new DeliverableServiceError('Invalid goalId.');
  }

  const goal = await GoalModel.findById(input.goalId).exec();
  if (!goal) throw new DeliverableServiceError('Objective not found.', 404);

  const deliverable = await DeliverableModel.create({
    goalId: goal._id,
    goalTitle: goal.title,
    title: cleanTitle(input.title),
    details: cleanDetails(input.details) ?? '',
    plannedDate: cleanDate(input.plannedDate),
    status: 'planned',
    deliveredAt: null,
  });

  return toDeliverableDTO(deliverable);
}

export async function updateDeliverable(
  deliverableId: string,
  patch: UpdateDeliverableRequest,
): Promise<DeliverableDTO> {
  if (!Types.ObjectId.isValid(deliverableId)) {
    throw new DeliverableServiceError('Invalid deliverable ID.');
  }

  const deliverable = await DeliverableModel.findById(deliverableId).exec();
  if (!deliverable) throw new DeliverableServiceError('Deliverable not found.', 404);

  let changed = false;

  if (patch.title !== undefined) {
    deliverable.title = cleanTitle(patch.title);
    changed = true;
  }
  if (patch.details !== undefined) {
    deliverable.details = cleanDetails(patch.details) ?? '';
    changed = true;
  }
  if (patch.plannedDate !== undefined) {
    deliverable.plannedDate = cleanDate(patch.plannedDate);
    changed = true;
  }
  if (patch.status !== undefined) {
    if (patch.status !== 'planned' && patch.status !== 'delivered') {
      throw new DeliverableServiceError('status must be planned or delivered.');
    }
    if (patch.status !== deliverable.status) {
      deliverable.status = patch.status;
      deliverable.deliveredAt = patch.status === 'delivered' ? new Date() : null;
      changed = true;
    }
  }

  if (!changed) {
    throw new DeliverableServiceError('No deliverable fields were provided.');
  }

  await deliverable.save();
  return toDeliverableDTO(deliverable);
}

export async function deleteDeliverable(deliverableId: string): Promise<void> {
  if (!Types.ObjectId.isValid(deliverableId)) {
    throw new DeliverableServiceError('Invalid deliverable ID.');
  }
  const result = await DeliverableModel.deleteOne({ _id: deliverableId }).exec();
  if (result.deletedCount === 0) {
    throw new DeliverableServiceError('Deliverable not found.', 404);
  }
}
