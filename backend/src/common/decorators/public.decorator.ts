import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Mark a route as public — bypasses the global JwtAuthGuard.
 * Without this decorator, every route requires a valid Bearer token.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
