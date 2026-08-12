import { describe, expect, it } from 'vitest';
import { findMentionedProjects, statusCounts } from './workspace-context.js';

describe('statusCounts', () => {
  it('counts statuses', () => {
    const tasks = [
      { status: 'TODO' },
      { status: 'IN_PROGRESS' },
      { status: 'IN_PROGRESS' },
      { status: 'DONE' },
      { status: 'DONE' },
      { status: 'DONE' },
    ];
    expect(statusCounts(tasks)).toEqual({
      TODO: 1,
      IN_PROGRESS: 2,
      IN_REVIEW: 0,
      DONE: 3,
    });
  });
});

describe('findMentionedProjects', () => {
  const projects = [
    { id: 'p1', name: 'Auth & Security' },
    { id: 'p2', name: 'Payments' },
    { id: 'p3', name: 'Mobile App' },
  ];

  it('matches distinctive name tokens', () => {
    expect(
      findMentionedProjects('open the Auth project', projects, null),
    ).toEqual([{ id: 'p1', name: 'Auth & Security' }]);
  });

  it('skips the current project', () => {
    expect(
      findMentionedProjects('go to Auth', projects, 'p1'),
    ).toEqual([]);
  });

  it('matches full name substring', () => {
    expect(
      findMentionedProjects('list tasks in Payments', projects, 'p1'),
    ).toEqual([{ id: 'p2', name: 'Payments' }]);
  });
});
