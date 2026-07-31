import { registerAs } from '@nestjs/config';

export const appConfig = registerAs('app', () => ({
  port: parseInt(process.env['PORT'] ?? '3001', 10),
  nodeEnv: process.env['NODE_ENV'] ?? 'development',
  frontendOrigin: process.env['FRONTEND_ORIGIN'] ?? 'http://localhost:3000',
}));

export const jwtConfig = registerAs('jwt', () => ({
  accessSecret: process.env['JWT_ACCESS_SECRET'] ?? '',
  accessExpiresIn: process.env['JWT_ACCESS_EXPIRES_IN'] ?? '15m',
  refreshSecret: process.env['JWT_REFRESH_SECRET'] ?? '',
  refreshExpiresIn: process.env['JWT_REFRESH_EXPIRES_IN'] ?? '7d',
}));

export const googleConfig = registerAs('google', () => ({
  clientId: process.env['GOOGLE_CLIENT_ID'] ?? '',
  clientSecret: process.env['GOOGLE_CLIENT_SECRET'] ?? '',
  // Must match the Next BFF callback URL registered in Google Cloud Console.
  callbackUrl:
    process.env['GOOGLE_CALLBACK_URL'] ??
    'http://localhost:3000/api/auth/google/callback',
}));

export const mailConfig = registerAs('mail', () => ({
  host: process.env['MAIL_HOST'] ?? '',
  port: parseInt(process.env['MAIL_PORT'] ?? '587', 10),
  user: process.env['MAIL_USER'] ?? '',
  pass: process.env['MAIL_PASS'] ?? '',
  from: process.env['MAIL_FROM'] ?? 'Task Tracker <noreply@localhost>',
  // Prefer HTTPS API on Railway (Hobby blocks outbound SMTP ports).
  resendApiKey: process.env['RESEND_API_KEY'] ?? '',
}));

export const redisConfig = registerAs('redis', () => ({
  url: process.env['REDIS_URL'] ?? '',
}));

// Internal URL of the Python RAG microservice (never exposed via Ingress).
export const assistantConfig = registerAs('assistant', () => ({
  url: process.env['AI_ASSISTANT_URL'] ?? 'http://localhost:8000',
}));

export type AppConfig = ReturnType<typeof appConfig>;
export type JwtConfig = ReturnType<typeof jwtConfig>;
export type GoogleConfig = ReturnType<typeof googleConfig>;
export type MailConfig = ReturnType<typeof mailConfig>;
export type RedisConfig = ReturnType<typeof redisConfig>;
export type AssistantConfig = ReturnType<typeof assistantConfig>;
