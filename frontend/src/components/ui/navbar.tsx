'use client';

import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import { Button } from './button';

export const Navbar: React.FC = () => {
  const { user, logout } = useAuth();

  if (!user) return null;

  return (
    <nav className="sticky top-0 z-30 border-b border-gray-200 bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/80">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-3 py-3 sm:px-4">
        <Link
          href="/workspaces"
          className="shrink-0 text-base font-bold text-gray-900 sm:text-lg"
        >
          Task Tracker
        </Link>

        <div className="flex min-w-0 items-center gap-2 sm:gap-4">
          <span className="truncate text-sm text-gray-600" title={user.name}>
            {user.name}
          </span>
          <Button variant="ghost" size="sm" onClick={logout} className="shrink-0">
            Sign out
          </Button>
        </div>
      </div>
    </nav>
  );
};
