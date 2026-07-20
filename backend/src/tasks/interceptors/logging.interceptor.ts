import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { Request } from 'express';

/**
 * Example interceptor demonstrating the before/after pattern.
 *
 * Interceptors wrap the route handler via RxJS Observable:
 *   BEFORE: code before next.handle()
 *   AFTER:  code inside tap() — runs after the handler returns
 *
 * Request lifecycle position:
 *   Middleware → Guards → **Interceptors (before)** → Pipes → Handler
 *   → **Interceptors (after)** → Exception Filters
 */
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger(LoggingInterceptor.name);

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<Request>();
    const method = req.method;
    const url = req.url;
    const now = Date.now();

    // ── BEFORE handler ──
    this.logger.log(`→ ${method} ${url}`);

    return next.handle().pipe(
      // ── AFTER handler ──
      tap(() => {
        const ms = Date.now() - now;
        this.logger.log(`← ${method} ${url} — ${ms}ms`);
      }),
    );
  }
}
