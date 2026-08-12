import { describe, expect, it } from 'vitest';
import { sanitizeProposals } from './sanitize-proposals.js';
import { applyScopeGuards } from './scope-guards.js';

describe('sanitizeProposals', () => {
  it('keeps allowlisted proposals', () => {
    const raw = {
      proposals: [
        {
          type: 'update_task',
          summary: 'Move SSL',
          taskId: 't1',
          patch: { status: 'IN_PROGRESS', bogus: 1 },
        },
        {
          type: 'create_task',
          summary: 'Add task',
          projectId: 'p1',
          title: 'New',
          status: 'TODO',
          assigneeId: 'user-1',
        },
        {
          type: 'create_project',
          summary: 'Billing',
          name: 'Billing',
        },
        { type: 'delete_task', summary: 'nope', taskId: 't2' },
        {
          type: 'update_task',
          summary: 'Assign Vadim',
          taskId: 't3',
          patch: { assigneeId: 'user-vadim' },
        },
        {
          type: 'update_task',
          summary: 'Unassign',
          taskId: 't4',
          patch: { assigneeId: null },
        },
      ],
    };

    expect(sanitizeProposals(raw)).toEqual([
      {
        type: 'update_task',
        summary: 'Move SSL',
        taskId: 't1',
        patch: { status: 'IN_PROGRESS' },
      },
      {
        type: 'create_task',
        summary: 'Add task',
        projectId: 'p1',
        title: 'New',
        status: 'TODO',
        assigneeId: 'user-1',
      },
      {
        type: 'create_project',
        summary: 'Billing',
        name: 'Billing',
      },
      {
        type: 'update_task',
        summary: 'Assign Vadim',
        taskId: 't3',
        patch: { assigneeId: 'user-vadim' },
      },
      {
        type: 'update_task',
        summary: 'Unassign',
        taskId: 't4',
        patch: { assigneeId: null },
      },
    ]);
  });

  it('returns empty for invalid shapes', () => {
    expect(sanitizeProposals(null)).toEqual([]);
    expect(sanitizeProposals({ proposals: 'x' })).toEqual([]);
    expect(sanitizeProposals({ proposals: [{ type: 'update_task' }] })).toEqual(
      [],
    );
  });

  it('caps at five non-create proposals', () => {
    const raw = {
      proposals: Array.from({ length: 8 }, (_, i) => ({
        type: 'navigate_to_project',
        summary: `Open ${i}`,
        projectId: `p${i}`,
      })),
    };
    expect(sanitizeProposals(raw)).toHaveLength(5);
  });

  it('rejects create bursts larger than MAX_PROPOSALS', () => {
    const raw = {
      proposals: Array.from({ length: 6 }, (_, i) => ({
        type: 'create_task',
        summary: `Task ${i}`,
        projectId: 'p1',
        title: `Task ${i}`,
      })),
    };
    expect(sanitizeProposals(raw)).toEqual([]);
  });

  it('sanitizes bulk update and dedupe', () => {
    const raw = {
      proposals: [
        {
          type: 'bulk_update_tasks',
          summary: 'Move auth tasks to IN_PROGRESS',
          filter: {
            titleContains: 'auth',
            descriptionContains: 'auth',
          },
          patch: { status: 'IN_PROGRESS' },
        },
        {
          type: 'bulk_update_tasks',
          summary: 'Assign Vadim to project tasks',
          filter: { projectId: 'p-auth' },
          patch: { assigneeId: 'user-vadim' },
        },
        {
          type: 'bulk_update_tasks',
          summary: 'Unassign project tasks',
          filter: { projectId: 'p-auth' },
          patch: { assigneeId: null },
        },
        {
          type: 'bulk_update_tasks',
          summary: 'bad empty filter',
          filter: {},
          patch: { status: 'DONE' },
        },
        {
          type: 'dedupe_projects',
          summary: 'Remove duplicate Auth projects',
          keep: 'oldest',
        },
      ],
    };
    expect(sanitizeProposals(raw)).toEqual([
      {
        type: 'bulk_update_tasks',
        summary: 'Move auth tasks to IN_PROGRESS',
        filter: {
          titleContains: 'auth',
          descriptionContains: 'auth',
        },
        patch: { status: 'IN_PROGRESS' },
      },
      {
        type: 'bulk_update_tasks',
        summary: 'Assign Vadim to project tasks',
        filter: { projectId: 'p-auth' },
        patch: { assigneeId: 'user-vadim' },
      },
      {
        type: 'bulk_update_tasks',
        summary: 'Unassign project tasks',
        filter: { projectId: 'p-auth' },
        patch: { assigneeId: null },
      },
      {
        type: 'dedupe_projects',
        summary: 'Remove duplicate Auth projects',
        keep: 'oldest',
      },
    ]);
  });

  it('sanitizes bulk delete, delete project, navigate', () => {
    const raw = {
      proposals: [
        {
          type: 'bulk_delete_tasks',
          summary: 'Delete all tasks in Auth',
          filter: { projectId: 'p-auth' },
        },
        {
          type: 'bulk_delete_tasks',
          summary: 'bad empty',
          filter: {},
        },
        {
          type: 'delete_project',
          summary: 'Delete Auth project',
          projectId: 'p-auth',
        },
        {
          type: 'navigate_to_project',
          summary: 'Open Payments',
          projectId: 'p-pay',
        },
        {
          type: 'bulk_update_tasks',
          summary: 'Done in project by name',
          filter: { projectName: 'Auth & Security' },
          patch: { status: 'DONE' },
        },
      ],
    };
    expect(sanitizeProposals(raw)).toEqual([
      {
        type: 'bulk_delete_tasks',
        summary: 'Delete all tasks in Auth',
        filter: { projectId: 'p-auth' },
      },
      {
        type: 'delete_project',
        summary: 'Delete Auth project',
        projectId: 'p-auth',
      },
      {
        type: 'navigate_to_project',
        summary: 'Open Payments',
        projectId: 'p-pay',
      },
      {
        type: 'bulk_update_tasks',
        summary: 'Done in project by name',
        filter: { projectName: 'Auth & Security' },
        patch: { status: 'DONE' },
      },
    ]);
  });

  it('allows create_task with projectName without id', () => {
    const raw = {
      proposals: [
        {
          type: 'create_project',
          summary: 'New project',
          name: 'My test project',
        },
        {
          type: 'create_task',
          summary: 'Add setup task',
          projectName: 'My test project',
          title: 'Setup project structure',
        },
      ],
    };
    const cleaned = sanitizeProposals(raw);
    expect(cleaned[0]?.['type']).toBe('create_project');
    expect(cleaned[1]).toEqual({
      type: 'create_task',
      summary: 'Add setup task',
      projectName: 'My test project',
      title: 'Setup project structure',
    });
  });

  it('sanitizes move_tasks_to_project and drops same-source-target', () => {
    const raw = {
      proposals: [
        {
          type: 'move_tasks_to_project',
          summary: 'Move Infra tasks to Auth',
          sourceProjectId: 'p-infra',
          targetProjectId: 'p-auth',
        },
        {
          type: 'move_tasks_to_project',
          summary: 'noop',
          sourceProjectId: 'p-same',
          targetProjectId: 'p-same',
        },
        {
          type: 'move_tasks_to_project',
          summary: 'target only — source from board',
          targetProjectId: 'p-auth',
        },
        {
          type: 'move_tasks_to_project',
          summary: 'Move DONE to new project',
          sourceProjectId: 'p-auth',
          targetProjectName: 'Payments2',
          statusIn: ['DONE', 'NOPE'],
        },
      ],
    };
    expect(sanitizeProposals(raw)).toEqual([
      {
        type: 'move_tasks_to_project',
        summary: 'Move Infra tasks to Auth',
        sourceProjectId: 'p-infra',
        targetProjectId: 'p-auth',
      },
      {
        type: 'move_tasks_to_project',
        summary: 'target only — source from board',
        targetProjectId: 'p-auth',
      },
      {
        type: 'move_tasks_to_project',
        summary: 'Move DONE to new project',
        sourceProjectId: 'p-auth',
        targetProjectName: 'Payments2',
        statusIn: ['DONE'],
      },
    ]);
  });

  it('rewrites create_project + bulk_delete into move by name', () => {
    const raw = {
      proposals: [
        {
          type: 'create_project',
          summary: 'Create Payments2',
          name: 'Payments2',
        },
        {
          type: 'bulk_delete_tasks',
          summary: 'Delete DONE tasks after moving to Payments2',
          filter: { projectId: 'p-auth', statusIn: ['DONE'] },
        },
      ],
    };
    expect(sanitizeProposals(raw)).toEqual([
      {
        type: 'create_project',
        summary: 'Create Payments2',
        name: 'Payments2',
      },
      {
        type: 'move_tasks_to_project',
        summary: 'Move DONE tasks after moving to Payments2',
        sourceProjectId: 'p-auth',
        targetProjectName: 'Payments2',
        statusIn: ['DONE'],
      },
    ]);
  });
});

describe('applyScopeGuards', () => {
  it('injects current project and strips status when intent wants all tasks', () => {
    const proposals = [
      {
        type: 'bulk_update_tasks',
        summary: 'Mark all TODO tasks as DONE across all projects',
        filter: { statusIn: ['TODO'] },
        patch: { status: 'DONE' },
      },
    ];
    const guarded = applyScopeGuards(
      proposals,
      {
        isConfirmation: false,
        wantsAllTasksInScope: true,
        statusLimited: false,
      },
      'proj-auth',
    );
    expect(guarded).toEqual([
      {
        type: 'bulk_update_tasks',
        summary: 'Update all tasks in the current project',
        filter: { projectId: 'proj-auth' },
        patch: { status: 'DONE' },
      },
    ]);
  });

  it('drops ambiguous workspace-wide status bulk (safety, no language)', () => {
    const proposals = [
      {
        type: 'bulk_update_tasks',
        summary: 'Mark all TODO as DONE',
        filter: { statusIn: ['TODO'] },
        patch: { status: 'DONE' },
      },
    ];
    const guarded = applyScopeGuards(
      proposals,
      {
        isConfirmation: false,
        wantsAllTasksInScope: true,
        statusLimited: false,
      },
      null,
    );
    expect(guarded).toEqual([]);
  });

  it('keeps keyword bulk on workspace', () => {
    const proposals = [
      {
        type: 'bulk_update_tasks',
        summary: 'Move auth to Done',
        filter: {
          titleContains: 'auth',
          descriptionContains: 'auth',
        },
        patch: { status: 'DONE' },
      },
    ];
    const guarded = applyScopeGuards(
      proposals,
      {
        isConfirmation: false,
        wantsAllTasksInScope: false,
        statusLimited: false,
      },
      null,
    );
    expect(guarded).toHaveLength(1);
    expect(
      (guarded[0]!['filter'] as Record<string, unknown>)['titleContains'],
    ).toBe('auth');
  });

  it('keeps statusIn when intent says statusLimited', () => {
    const proposals = [
      {
        type: 'bulk_update_tasks',
        summary: 'Move TODO to Done',
        filter: { statusIn: ['TODO'], projectId: 'proj-auth' },
        patch: { status: 'DONE' },
      },
    ];
    const guarded = applyScopeGuards(
      proposals,
      {
        isConfirmation: false,
        wantsAllTasksInScope: true,
        statusLimited: true,
      },
      'proj-auth',
    );
    expect(guarded[0]!['filter']).toEqual({
      statusIn: ['TODO'],
      projectId: 'proj-auth',
    });
  });

  it('fills move source from current project when omitted', () => {
    const proposals = [
      {
        type: 'move_tasks_to_project',
        summary: 'Move to Auth',
        targetProjectId: 'p-auth',
      },
    ];
    const guarded = applyScopeGuards(
      proposals,
      {
        isConfirmation: false,
        wantsAllTasksInScope: true,
        statusLimited: false,
      },
      'p-infra',
    );
    expect(guarded).toEqual([
      {
        type: 'move_tasks_to_project',
        summary: 'Move to Auth',
        sourceProjectId: 'p-infra',
        targetProjectId: 'p-auth',
      },
    ]);
  });

  it('keeps name-only move target for create_project binding', () => {
    const proposals = [
      {
        type: 'move_tasks_to_project',
        summary: 'Move DONE to Payments2',
        sourceProjectId: 'p-auth',
        targetProjectName: 'Payments2',
        statusIn: ['DONE'],
      },
    ];
    const guarded = applyScopeGuards(
      proposals,
      {
        isConfirmation: false,
        wantsAllTasksInScope: false,
        statusLimited: true,
      },
      'p-auth',
    );
    expect(guarded).toEqual([
      {
        type: 'move_tasks_to_project',
        summary: 'Move DONE to Payments2',
        sourceProjectId: 'p-auth',
        targetProjectName: 'Payments2',
        statusIn: ['DONE'],
      },
    ]);
  });

  it('drops move when source equals target after guard', () => {
    const proposals = [
      {
        type: 'move_tasks_to_project',
        summary: 'Move nowhere',
        sourceProjectId: 'p-auth',
        targetProjectId: 'p-auth',
      },
    ];
    const guarded = applyScopeGuards(
      proposals,
      {
        isConfirmation: false,
        wantsAllTasksInScope: true,
        statusLimited: false,
      },
      'p-auth',
    );
    expect(guarded).toEqual([]);
  });
});
