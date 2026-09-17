import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  assertInWorkspace,
  findProjectInWorkspace,
  findTaskInWorkspace,
} from './workspace-scope';

const WS = 'ws-1';

function mockClient() {
  const client = {
    project: { findUnique: jest.fn() },
    task: { findUnique: jest.fn() },
  };
  return {
    client,
    tx: client as unknown as Prisma.TransactionClient,
  };
}

describe('assertInWorkspace', () => {
  const owner = (r: { workspaceId: string }) => r.workspaceId;

  it('throws 404 when the resource does not exist', () => {
    expect(() => assertInWorkspace(null, WS, 'Task', owner)).toThrow(
      new NotFoundException('Task not found'),
    );
  });

  it('throws 403 when the resource belongs to another workspace', () => {
    expect(() =>
      assertInWorkspace({ workspaceId: 'other' }, WS, 'Project', owner),
    ).toThrow(
      new ForbiddenException('Project does not belong to this workspace'),
    );
  });

  it('passes when the resource is in the workspace', () => {
    expect(() =>
      assertInWorkspace({ workspaceId: WS }, WS, 'Project', owner),
    ).not.toThrow();
  });
});

describe('findProjectInWorkspace', () => {
  it('returns the project when it belongs to the workspace', async () => {
    const { client, tx } = mockClient();
    client.project.findUnique.mockResolvedValue({ id: 'p1', workspaceId: WS });

    await expect(findProjectInWorkspace(tx, WS, 'p1')).resolves.toEqual({
      id: 'p1',
      workspaceId: WS,
    });
    expect(client.project.findUnique).toHaveBeenCalledWith({
      where: { id: 'p1' },
      select: { id: true, workspaceId: true },
    });
  });

  it('rejects a foreign project', async () => {
    const { client, tx } = mockClient();
    client.project.findUnique.mockResolvedValue({
      id: 'p1',
      workspaceId: 'other',
    });

    await expect(findProjectInWorkspace(tx, WS, 'p1')).rejects.toThrow(
      ForbiddenException,
    );
  });
});

describe('findTaskInWorkspace', () => {
  it('flattens the owning workspaceId from the project relation', async () => {
    const { client, tx } = mockClient();
    client.task.findUnique.mockResolvedValue({
      id: 't1',
      projectId: 'p1',
      status: 'TODO',
      project: { workspaceId: WS },
    });

    await expect(findTaskInWorkspace(tx, WS, 't1')).resolves.toEqual({
      id: 't1',
      projectId: 'p1',
      status: 'TODO',
      workspaceId: WS,
    });
  });

  it('rejects a missing task and a foreign task', async () => {
    const { client, tx } = mockClient();
    client.task.findUnique.mockResolvedValueOnce(null);
    await expect(findTaskInWorkspace(tx, WS, 't1')).rejects.toThrow(
      NotFoundException,
    );

    client.task.findUnique.mockResolvedValueOnce({
      id: 't1',
      projectId: 'p1',
      status: 'TODO',
      project: { workspaceId: 'other' },
    });
    await expect(findTaskInWorkspace(tx, WS, 't1')).rejects.toThrow(
      ForbiddenException,
    );
  });
});
