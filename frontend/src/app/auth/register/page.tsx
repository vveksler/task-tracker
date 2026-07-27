import { Suspense } from 'react';
import { AuthForm } from '@/components/auth/auth-form';

const RegisterPage = () => (
  <Suspense fallback={<div className="flex min-h-screen items-center justify-center text-sm text-gray-500">Loading…</div>}>
    <AuthForm mode="register" />
  </Suspense>
);

export default RegisterPage;
