'use client';

import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import { Button } from './button';

export const Navbar: React.FC = () => {
  const { user, logout } = useAuth();

  if (!user) return null;

  return (
    <nav className="border-b border-gray-200 bg-white">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
        <Link href="/workspaces" className="text-lg font-bold text-gray-900">
          Task Tracker
        </Link>

        <div className="flex items-center gap-4">
          <span className="text-sm text-gray-600">{user.name}</span>
          <Button variant="ghost" size="sm" onClick={logout}>
            Sign out
          </Button>
        </div>
      </div>
    </nav>
  );
};
