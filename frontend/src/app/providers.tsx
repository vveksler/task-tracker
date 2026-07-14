'use client';

import type { ReactNode } from 'react';
import { AuthProvider } from '@/lib/auth-context';

interface ProvidersProps {
  children: ReactNode;
}

export const Providers: React.FC<ProvidersProps> = ({ children }) => {
  return <AuthProvider>{children}</AuthProvider>;
};
