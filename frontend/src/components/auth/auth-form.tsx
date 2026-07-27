'use client';

import { useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface AuthFormProps {
  mode: 'login' | 'register';
}

const GOOGLE_ERROR_MESSAGES: Record<string, string> = {
  google: 'Google sign-in failed. Please try again.',
  google_not_configured:
    'Google sign-in is not configured on this server.',
};

const NEEDS_VERIFICATION =
  /verify your email/i;

export const AuthForm: React.FC<AuthFormProps> = ({ mode }) => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { login, register } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [registerDone, setRegisterDone] = useState(false);
  const [needsVerification, setNeedsVerification] = useState(false);
  const [resendDone, setResendDone] = useState(false);
  const [resendLoading, setResendLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const queryError = useMemo(() => {
    const code = searchParams.get('error');
    if (!code) return null;
    return GOOGLE_ERROR_MESSAGES[code] ?? 'Authentication failed. Please try again.';
  }, [searchParams]);

  const displayError = error ?? queryError;

  const handleResend = useCallback(async () => {
    setResendLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/resend-verification', {
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
  }, [email]);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setError(null);
      setNeedsVerification(false);
      setResendDone(false);
      setIsSubmitting(true);

      try {
        if (mode === 'login') {
          await login(email, password);
          router.push('/workspaces');
        } else {
          await register(email, password, name);
          setRegisterDone(true);
        }
      } catch (err) {
        if (err instanceof ApiError) {
          setError(err.message);
          if (mode === 'login' && NEEDS_VERIFICATION.test(err.message)) {
            setNeedsVerification(true);
          }
        } else {
          setError('Something went wrong. Please try again.');
        }
      } finally {
        setIsSubmitting(false);
      }
    },
    [mode, email, password, name, login, register, router],
  );

  const isLogin = mode === 'login';

  if (!isLogin && registerDone) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <div className="w-full max-w-sm space-y-6">
          <div className="text-center">
            <h1 className="text-2xl font-bold tracking-tight text-gray-900">
              Check your email
            </h1>
            <p className="mt-2 text-sm text-gray-600">
              We sent a confirmation link to{' '}
              <span className="font-medium text-gray-900">{email}</span>. Open it
              to finish creating your account.
            </p>
          </div>
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

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">
            {isLogin ? 'Sign in to Task Tracker' : 'Create your account'}
          </h1>
          <p className="mt-2 text-sm text-gray-600">
            {isLogin ? "Don't have an account? " : 'Already have an account? '}
            <Link
              href={isLogin ? '/auth/register' : '/auth/login'}
              className="font-medium text-brand-600 hover:text-brand-700"
            >
              {isLogin ? 'Sign up' : 'Sign in'}
            </Link>
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {!isLogin && (
            <Input
              label="Name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
              required
              autoComplete="name"
            />
          )}

          <Input
            label="Email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            required
            autoComplete="email"
          />

          <Input
            label="Password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            required
            minLength={8}
            autoComplete={isLogin ? 'current-password' : 'new-password'}
          />

          {isLogin && (
            <div className="text-right">
              <Link
                href="/auth/forgot-password"
                className="text-sm font-medium text-brand-600 hover:text-brand-700"
              >
                Forgot password?
              </Link>
            </div>
          )}

          {displayError && (
            <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
              {displayError}
            </div>
          )}

          {needsVerification && (
            <div className="space-y-2">
              {resendDone ? (
                <p className="text-sm text-green-700">
                  If an unverified account exists, a new confirmation link was
                  sent.
                </p>
              ) : (
                <Button
                  type="button"
                  variant="secondary"
                  isLoading={resendLoading}
                  className="w-full"
                  onClick={handleResend}
                >
                  Resend confirmation email
                </Button>
              )}
            </div>
          )}

          <Button
            type="submit"
            isLoading={isSubmitting}
            className="w-full"
          >
            {isLogin ? 'Sign in' : 'Create account'}
          </Button>
        </form>

        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-gray-200" />
          </div>
          <div className="relative flex justify-center text-sm">
            <span className="bg-white px-2 text-gray-500">or</span>
          </div>
        </div>

        <a
          href="/api/auth/google"
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50"
        >
          Continue with Google
        </a>
      </div>
    </div>
  );
};
