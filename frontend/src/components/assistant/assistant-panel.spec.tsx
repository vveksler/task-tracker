/**
 * AssistantPanel — FAB opens/closes the slide-over.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AssistantProvider } from '@/lib/assistant-context';

jest.mock('next/navigation', () => ({
  usePathname: () => '/workspaces/ws-1',
}));

jest.mock('@/components/assistant/assistant-chat', () => ({
  AssistantChat: ({ onClose }: { onClose?: () => void }) => (
    <div>
      <span>Chat body</span>
      <button type="button" onClick={onClose}>
        Close AI Assistant
      </button>
    </div>
  ),
}));

import { AssistantPanel } from '@/components/assistant/assistant-panel';

describe('AssistantPanel', () => {
  it('opens and closes the slide-over via FAB and close control', async () => {
    const user = userEvent.setup();
    render(
      <AssistantProvider>
        <AssistantPanel workspaceId="ws-1" />
      </AssistantProvider>,
    );

    const fab = screen.getByRole('button', { name: 'AI Assistant' });
    expect(fab).toHaveAttribute('aria-expanded', 'false');

    await user.click(fab);
    expect(fab).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('dialog', { name: 'AI Assistant' })).toBeInTheDocument();
    expect(screen.getByText('Chat body')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Close AI Assistant' }));
    expect(fab).toHaveAttribute('aria-expanded', 'false');
  });
});
