export interface User {
  id: string;
  email: string;
  name: string;
}

export interface AuthResponse {
  accessToken: string;
  user: User;
}

export type WorkspaceRole = 'ADMIN' | 'MEMBER';

export interface WorkspaceMember {
  userId: string;
  role: WorkspaceRole;
  joinedAt: string;
  user: { id: string; email: string; name: string };
}

export interface Workspace {
  id: string;
  name: string;
  ownerId: string;
  createdAt: string;
  updatedAt?: string;
  members?: WorkspaceMember[];
}

export interface Project {
  id: string;
  name: string;
  description: string | null;
  workspaceId: string;
  createdAt: string;
  updatedAt: string;
}

export type TaskStatus = 'TODO' | 'IN_PROGRESS' | 'IN_REVIEW' | 'DONE';

export interface Task {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  order: number;
  projectId: string;
  assigneeId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BoardSyncEvent {
  type: 'board:sync';
  projectId: string;
  tasks: Task[];
}

export interface TaskCreatedEvent {
  type: 'task:created';
  task: Task;
}

export interface TaskUpdatedEvent {
  type: 'task:updated';
  task: Task;
}

export interface TaskMovedEvent {
  type: 'task:moved';
  task: Task;
}

export interface TaskDeletedEvent {
  type: 'task:deleted';
  taskId: string;
  projectId: string;
}

// ── Analytics ──

export interface StatusBreakdown {
  status: TaskStatus;
  count: number;
}

export interface ActivityDay {
  date: string;
  created: number;
  updated: number;
}

export interface AssigneeLoad {
  assigneeId: string | null;
  assigneeName: string | null;
  assigneeEmail: string | null;
  total: number;
  todo: number;
  inProgress: number;
  inReview: number;
  done: number;
}
