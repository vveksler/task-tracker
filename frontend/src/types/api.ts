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
  /** Operator-controlled cost gate for the RAG assistant. */
  aiAssistantEnabled?: boolean;
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

// ── AI assistant proposals (suggest + confirm) ──

export interface BulkUpdateTasksFilter {
  titleContains?: string;
  descriptionContains?: string;
  assigneeNameContains?: string;
  statusIn?: TaskStatus[];
  projectId?: string;
  projectName?: string;
}

export interface BulkUpdateTasksPatch {
  status?: TaskStatus;
  title?: string;
  description?: string;
  assigneeId?: string;
}

export type AssistantProposal =
  | {
      type: 'update_task';
      summary: string;
      taskId: string;
      patch: {
        title?: string;
        description?: string;
        status?: TaskStatus;
        assigneeId?: string | null;
      };
    }
  | {
      type: 'create_task';
      summary: string;
      projectId: string;
      title: string;
      description?: string;
      status?: TaskStatus;
      assigneeId?: string;
    }
  | {
      type: 'create_project';
      summary: string;
      name: string;
    }
  | {
      type: 'bulk_update_tasks';
      summary: string;
      filter: BulkUpdateTasksFilter;
      patch: BulkUpdateTasksPatch;
    }
  | {
      type: 'bulk_delete_tasks';
      summary: string;
      filter: BulkUpdateTasksFilter;
    }
  | {
      type: 'dedupe_projects';
      summary: string;
      name?: string;
      keep: 'oldest' | 'newest';
    }
  | {
      type: 'delete_project';
      summary: string;
      projectId: string;
    }
  | {
      type: 'navigate_to_project';
      summary: string;
      projectId: string;
    };

export type AssistantSseEvent =
  | { kind: 'token'; text: string }
  | { kind: 'actions'; proposals: AssistantProposal[] };

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
