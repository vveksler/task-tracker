/**
 * WorkspaceProvider / useWorkspace tests — verifies role computation
 * for different user types: admin, member, owner.
 */

import { render, screen, waitFor } from '@testing-library/react';
import type { Workspace } from '@/types/api';

const mockApiFetch = jest.fn();
jest.mock('@/lib/api-client', () => ({
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
}));

const mockUseAuth = jest.fn();
jest.mock('@/lib/auth-context', () => ({
  useAuth: () => mockUseAuth(),
}));

import { WorkspaceProvider, useWorkspace } from './workspace-context';

const adminUser = { id: 'user-admin', email: 'admin@test.com', name: 'Admin' };
const memberUser = { id: 'user-member', email: 'member@test.com', name: 'Member' };
const outsiderUser = { id: 'user-outsider', email: 'outsider@test.com', name: 'Outsider' };

const workspace: Workspace = {
  id: 'ws-1',
  name: 'Test Workspace',
  ownerId: 'user-admin',
  createdAt: '2026-01-01T00:00:00.000Z',
  members: [
    {
      userId: 'user-admin',
      role: 'ADMIN',
      joinedAt: '2026-01-01T00:00:00.000Z',
      user: adminUser,
    },
    {
      userId: 'user-member',
      role: 'MEMBER',
      joinedAt: '2026-01-02T00:00:00.000Z',
      user: memberUser,
    },
  ],
};

const RoleDisplay = () => {
  const { myRole, isOwner, isAdmin, isLoading } = useWorkspace();
  if (isLoading) return <div data-testid="loading">Loading</div>;
  return (
    <div>
      <span data-testid="role">{myRole ?? 'none'}</span>
      <span data-testid="owner">{String(isOwner)}</span>
      <span data-testid="admin">{String(isAdmin)}</span>
    </div>
  );
};

const renderWithProvider = () =>
  render(
    <WorkspaceProvider workspaceId="ws-1">
      <RoleDisplay />
    </WorkspaceProvider>,
  );

describe('WorkspaceProvider', () => {
  beforeEach(() => {
    mockApiFetch.mockReset();
    mockApiFetch.mockResolvedValue(workspace);
  });

  it('should show ADMIN role and isOwner=true for workspace owner', async () => {
    mockUseAuth.mockReturnValue({ user: adminUser, isLoading: false });

    renderWithProvider();

    await waitFor(() => {
      expect(screen.getByTestId('role').textContent).toBe('ADMIN');
    });
    expect(screen.getByTestId('owner').textContent).toBe('true');
    expect(screen.getByTestId('admin').textContent).toBe('true');
  });

  it('should show MEMBER role and isOwner=false for regular member', async () => {
    mockUseAuth.mockReturnValue({ user: memberUser, isLoading: false });

    renderWithProvider();

    await waitFor(() => {
      expect(screen.getByTestId('role').textContent).toBe('MEMBER');
    });
    expect(screen.getByTestId('owner').textContent).toBe('false');
    expect(screen.getByTestId('admin').textContent).toBe('false');
  });

  it('should show no role for a user not in workspace members', async () => {
    mockUseAuth.mockReturnValue({ user: outsiderUser, isLoading: false });

    renderWithProvider();

    await waitFor(() => {
      expect(screen.getByTestId('role').textContent).toBe('none');
    });
    expect(screen.getByTestId('owner').textContent).toBe('false');
    expect(screen.getByTestId('admin').textContent).toBe('false');
  });

  it('should show loading while fetching workspace', () => {
    mockApiFetch.mockReturnValue(new Promise(() => {})); // never resolves
    mockUseAuth.mockReturnValue({ user: adminUser, isLoading: false });

    renderWithProvider();

    expect(screen.getByTestId('loading')).toBeTruthy();
  });

  it('should throw when useWorkspace is used outside provider', () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<RoleDisplay />)).toThrow(
      'useWorkspace must be used within WorkspaceProvider',
    );
    spy.mockRestore();
  });
});
