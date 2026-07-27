'use client';

import { Suspense, useCallback, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ApiError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token') ?? '';

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setError(null);

      if (!token) {
        setError('Missing reset token. Open the link from your email.');
        return;
      }

      if (password !== confirm) {
        setError('Passwords do not match.');
        return;
      }

      setIsSubmitting(true);

      try {
        const res = await fetch('/api/auth/reset-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token, password }),
        });

        if (!res.ok) {
          const body = await res.json().catch(() => ({ message: res.statusText }));
          throw new ApiError(
            res.status,
            (body as { message?: string }).message ?? res.statusText,
          );
        }

        router.push('/auth/login');
      } catch (err) {
        if (err instanceof ApiError) {
          setError(err.message);
        } else {
          setError('Something went wrong. Please try again.');
        }
      } finally {
        setIsSubmitting(false);
      }
    },
    [token, password, confirm, router],
  );

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">
            Choose a new password
          </h1>
          <p className="mt-2 text-sm text-gray-600">
            Enter a new password for your account.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            label="New password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            required
            minLength={8}
            autoComplete="new-password"
          />

          <Input
            label="Confirm password"
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="••••••••"
            required
            minLength={8}
            autoComplete="new-password"
          />

          {error && (
            <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}

          <Button type="submit" isLoading={isSubmitting} className="w-full">
            Update password
          </Button>

          <Link
            href="/auth/login"
            className="block text-center text-sm font-medium text-brand-600 hover:text-brand-700"
          >
            Back to sign in
          </Link>
        </form>
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center text-sm text-gray-500">
          Loading…
        </div>
      }
    >
      <ResetPasswordForm />
    </Suspense>
  );
}
