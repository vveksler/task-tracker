import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { JwtPayload } from '../types/jwt-payload';

/**
 * Rate limit keyed by who is acting, not by client IP.
 *
 * Why not IP: auth calls reach Nest through the Next.js BFF, so every login
 * arrives from the frontend server's address — an IP limit would throttle all
 * users together. Trusting a forwarded IP header from the BFF would be
 * spoofable without a second shared secret.
 *
 * - Authenticated routes → JWT `sub` (bounds LLM spend per user).
 * - Public auth routes → normalized `email` from the body (bounds password
 *   guessing and mail spam per account). Trade-off: someone can burn a
 *   victim's login quota for the window; windows are kept short for that.
 * - Otherwise → IP fallback.
 *
 * Storage is in-memory per pod, so with N backend replicas the effective
 * limit is up to N× the configured value.
 *
 * Applied per-route with @UseGuards + @Throttle, not globally.
 */
@Injectable()
export class KeyedThrottlerGuard extends ThrottlerGuard {
  protected override getTracker(req: Record<string, unknown>): Promise<string> {
    const user = req['user'] as JwtPayload | undefined;
    if (user?.sub) return Promise.resolve(`user:${user.sub}`);

    const body = req['body'] as Record<string, unknown> | undefined;
    const email = body?.['email'];
    if (typeof email === 'string' && email.trim()) {
      return Promise.resolve(`email:${email.trim().toLowerCase()}`);
    }

    return Promise.resolve(`ip:${String(req['ip'] ?? 'unknown')}`);
  }
}
