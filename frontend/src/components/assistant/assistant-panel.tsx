'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { useAssistant } from '@/lib/assistant-context';
import { AssistantChat } from '@/components/assistant/assistant-chat';

interface AssistantPanelProps {
  workspaceId: string;
}

/**
 * Global FAB + right slide-over for the workspace AI assistant.
 * Chat stays mounted while closed so the thread survives route changes
 * within the same workspace. Hidden on the dedicated /assistant page
 * to avoid a duplicate chat UI.
 */
export const AssistantPanel: React.FC<AssistantPanelProps> = ({
  workspaceId,
}) => {
  const pathname = usePathname();
  const { isOpen, close, toggle } = useAssistant();
  const isAssistantPage = pathname?.endsWith('/assistant') ?? false;

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, close]);

  // Prevent background scroll while the sheet is open (esp. mobile).
  useEffect(() => {
    if (!isOpen || isAssistantPage) return;
    document.body.classList.add('scroll-locked');
    return () => document.body.classList.remove('scroll-locked');
  }, [isOpen, isAssistantPage]);

  if (isAssistantPage) return null;

  return (
    <>
      <button
        type="button"
        onClick={toggle}
        aria-label="AI Assistant"
        aria-expanded={isOpen}
        title="AI Assistant"
        className={
          'assistant-fab transition hover:bg-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 ' +
          (isOpen ? 'pointer-events-none opacity-0 sm:pointer-events-auto sm:opacity-100' : '')
        }
      >
        <ChatIcon />
      </button>

      <div
        aria-hidden={!isOpen}
        className={
          isOpen
            ? 'fixed inset-0 z-40 bg-black/30 transition-opacity'
            : 'pointer-events-none fixed inset-0 z-40 bg-black/0 opacity-0'
        }
        onClick={close}
      />

      <aside
        role="dialog"
        aria-modal={isOpen}
        aria-label="AI Assistant"
        className={
          'assistant-panel ' +
          (isOpen
            ? 'translate-x-0'
            : 'pointer-events-none translate-x-full')
        }
      >
        <AssistantChat
          workspaceId={workspaceId}
          variant="panel"
          onClose={close}
        />
      </aside>
    </>
  );
};

function ChatIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="currentColor"
      className="h-6 w-6"
      aria-hidden
    >
      <path
        fillRule="evenodd"
        d="M4.848 2.771A49.144 49.144 0 0 1 12 2.25c2.43 0 4.817.178 7.152.52 1.978.292 3.348 2.024 3.348 3.97v6.02c0 1.946-1.37 3.678-3.348 3.97a48.901 48.901 0 0 1-3.476.383.39.39 0 0 0-.297.15l-2.755 4.133a.75.75 0 0 1-1.248 0l-2.755-4.133a.39.39 0 0 0-.297-.15 48.9 48.9 0 0 1-3.476-.384c-1.978-.29-3.348-2.024-3.348-3.97V6.741c0-1.946 1.37-3.68 3.348-3.97ZM6.75 8.25a.75.75 0 0 1 .75-.75h9a.75.75 0 0 1 0 1.5h-9a.75.75 0 0 1-.75-.75Zm.75 2.25a.75.75 0 0 0 0 1.5H12a.75.75 0 0 0 0-1.5H7.5Z"
        clipRule="evenodd"
      />
    </svg>
  );
}
