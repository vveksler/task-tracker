'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ApiError, setAccessToken } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

function VerifyEmailContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const { setSessionUser } = useAuth();

  const [status, setStatus] = useState<'loading' | 'error' | 'idle'>(
    token ? 'loading' : 'idle',
  );
  const [error, setError] = useState<string | null>(
    token ? null : 'Missing verification token. Open the link from your email.',
  );
  const [resendEmail, setResendEmail] = useState('');
  const [resendDone, setResendDone] = useState(false);
  const [resendLoading, setResendLoading] = useState(false);

  useEffect(() => {
    if (!token) return;

    let cancelled = false;

    (async () => {
      try {
        const res = await fetch('/api/auth/verify-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        });

        const body = await res.json().catch(() => ({ message: res.statusText }));

        if (!res.ok) {
          throw new ApiError(
            res.status,
            (body as { message?: string }).message ?? res.statusText,
          );
        }

        const data = body as {
          accessToken: string;
          user: { id: string; email: string; name: string };
        };

        if (cancelled) return;

        setAccessToken(data.accessToken);
        setSessionUser(data.user);
        router.replace('/workspaces');
      } catch (err) {
        if (cancelled) return;
        setStatus('error');
        setError(
          err instanceof ApiError
            ? err.message
            : 'Something went wrong. Please try again.',
        );
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [token, router, setSessionUser]);

  const handleResend = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setError(null);
      setResendDone(false);
      setResendLoading(true);

      try {
        const res = await fetch('/api/auth/resend-verification', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: resendEmail }),
        });

        if (!res.ok) {
          const body = await res.json().catch(() => ({ message: res.statusText }));
          throw new ApiError(
            res.status,
            (body as { message?: string }).message ?? res.statusText,
          );
        }

        setResendDone(true);
      } catch (err) {
        if (err instanceof ApiError) {
          setError(err.message);
        } else {
          setError('Something went wrong. Please try again.');
        }
      } finally {
        setResendLoading(false);
      }
    },
    [resendEmail],
  );

  if (status === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <p className="text-sm text-gray-600">Confirming your email…</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">
            Email confirmation
          </h1>
          <p className="mt-2 text-sm text-gray-600">
            The link may have expired. Request a new confirmation email below.
          </p>
        </div>

        {error && (
          <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {resendDone ? (
          <div className="rounded-lg bg-green-50 px-4 py-3 text-sm text-green-800">
            If an unverified account with that email exists, a confirmation link
            has been sent.
          </div>
        ) : (
          <form onSubmit={handleResend} className="space-y-4">
            <Input
              label="Email"
              type="email"
              value={resendEmail}
              onChange={(e) => setResendEmail(e.target.value)}
              placeholder="you@example.com"
              required
              autoComplete="email"
            />
            <Button type="submit" isLoading={resendLoading} className="w-full">
              Resend confirmation
            </Button>
          </form>
        )}

        <Link
          href="/auth/login"
          className="block text-center text-sm font-medium text-brand-600 hover:text-brand-700"
        >
          Back to sign in
        </Link>
      </div>
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center text-sm text-gray-500">
          Loading…
        </div>
      }
    >
      <VerifyEmailContent />
    </Suspense>
  );
}
