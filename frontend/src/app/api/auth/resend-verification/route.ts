import { NextRequest, NextResponse } from 'next/server';
import { BACKEND_URL } from '../cookie-config';

export async function POST(req: NextRequest) {
  const body = await req.json();

  const backendRes = await fetch(`${BACKEND_URL}/auth/resend-verification`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const data = await backendRes.json().catch(() => ({
    message: backendRes.statusText,
  }));

  return NextResponse.json(data, { status: backendRes.status });
}
