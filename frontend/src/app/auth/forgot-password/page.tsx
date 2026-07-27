'use client';

import { useCallback, useState } from 'react';
import Link from 'next/link';
import { ApiError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setError(null);
      setIsSubmitting(true);

      try {
        const res = await fetch('/api/auth/forgot-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email }),
        });

        if (!res.ok) {
          const body = await res.json().catch(() => ({ message: res.statusText }));
          throw new ApiError(
            res.status,
            (body as { message?: string }).message ?? res.statusText,
          );
        }

        setDone(true);
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
    [email],
  );

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">
            Reset your password
          </h1>
          <p className="mt-2 text-sm text-gray-600">
            Enter your email and we&apos;ll send a reset link if an account exists.
          </p>
        </div>

        {done ? (
          <div className="space-y-4">
            <div className="rounded-lg bg-green-50 px-4 py-3 text-sm text-green-800">
              If an account with that email exists, a reset link has been sent.
            </div>
            <Link
              href="/auth/login"
              className="block text-center text-sm font-medium text-brand-600 hover:text-brand-700"
            >
              Back to sign in
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <Input
              label="Email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
              autoComplete="email"
            />

            {error && (
              <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
                {error}
              </div>
            )}

            <Button type="submit" isLoading={isSubmitting} className="w-full">
              Send reset link
            </Button>

            <Link
              href="/auth/login"
              className="block text-center text-sm font-medium text-brand-600 hover:text-brand-700"
            >
              Back to sign in
            </Link>
          </form>
        )}
      </div>
    </div>
  );
}
