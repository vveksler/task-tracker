/**
 * Typed WebSocket event payloads.
 *
 * These interfaces define the shape of every event emitted by the gateway.
 * The frontend should mirror these types (manually kept in sync — there's
 * no shared package, but the shapes are intentionally simple to keep
 * drift obvious during review).
 */

export interface TaskPayload {
  id: string;
  title: string;
  description: string | null;
  status: string;
  order: number;
  projectId: string;
  assigneeId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TaskCreatedEvent {
  type: 'task:created';
  task: TaskPayload;
}

export interface TaskUpdatedEvent {
  type: 'task:updated';
  task: TaskPayload;
}

export interface TaskMovedEvent {
  type: 'task:moved';
  task: TaskPayload;
}

export interface TaskDeletedEvent {
  type: 'task:deleted';
  taskId: string;
  projectId: string;
}

export interface BoardSyncEvent {
  type: 'board:sync';
  projectId: string;
  tasks: TaskPayload[];
}

export type ServerEvent =
  | TaskCreatedEvent
  | TaskUpdatedEvent
  | TaskMovedEvent
  | TaskDeletedEvent
  | BoardSyncEvent;
