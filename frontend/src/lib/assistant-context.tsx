'use client';

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { AssistantProposal } from '@/types/api';

type AppliedListener = (proposal: AssistantProposal) => void;

interface AssistantContextValue {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
  /** Subscribe to successful Apply; returns unsubscribe. */
  subscribeApplied: (cb: AppliedListener) => () => void;
  notifyApplied: (proposal: AssistantProposal) => void;
}

const AssistantContext = createContext<AssistantContextValue | null>(null);

export const useAssistant = (): AssistantContextValue => {
  const ctx = useContext(AssistantContext);
  if (!ctx) {
    throw new Error('useAssistant must be used within AssistantProvider');
  }
  return ctx;
};

/** Safe hook when the provider may be absent (e.g. unit tests of chat alone). */
export const useOptionalAssistant = (): AssistantContextValue | null =>
  useContext(AssistantContext);

interface AssistantProviderProps {
  children: ReactNode;
}

export const AssistantProvider: React.FC<AssistantProviderProps> = ({
  children,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const listenersRef = useRef(new Set<AppliedListener>());

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);
  const toggle = useCallback(() => setIsOpen((v) => !v), []);

  const subscribeApplied = useCallback((cb: AppliedListener) => {
    listenersRef.current.add(cb);
    return () => {
      listenersRef.current.delete(cb);
    };
  }, []);

  const notifyApplied = useCallback((proposal: AssistantProposal) => {
    for (const cb of listenersRef.current) {
      cb(proposal);
    }
  }, []);

  const value = useMemo(
    () => ({
      isOpen,
      open,
      close,
      toggle,
      subscribeApplied,
      notifyApplied,
    }),
    [isOpen, open, close, toggle, subscribeApplied, notifyApplied],
  );

  return (
    <AssistantContext.Provider value={value}>
      {children}
    </AssistantContext.Provider>
  );
};
