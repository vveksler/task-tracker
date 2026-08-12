import { z } from 'zod';

/**
 * Typed env — read only through this module (same rule as Nest/backend).
 * Load dotenv manually only in local/dev via index.ts when .env exists.
 */
const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  OPENAI_API_KEY: z.string().min(1),
  ANTHROPIC_API_KEY: z.string().min(1),
  EMBEDDING_MODEL: z.string().default('text-embedding-3-small'),
  EMBEDDING_DIMENSIONS: z.coerce.number().default(1536),
  GENERATION_MODEL: z.string().default('claude-sonnet-4-6'),
  PORT: z.coerce.number().default(8000),
});

export type AppConfig = z.infer<typeof envSchema> & {
  databaseUrl: string;
  openaiApiKey: string;
  anthropicApiKey: string;
  embeddingModel: string;
  embeddingDimensions: number;
  generationModel: string;
  port: number;
};

let cached: AppConfig | null = null;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  if (cached) return cached;

  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ');
    throw new Error(`Invalid AI assistant config: ${detail}`);
  }

  const v = parsed.data;
  cached = {
    ...v,
    databaseUrl: v.DATABASE_URL,
    openaiApiKey: v.OPENAI_API_KEY,
    anthropicApiKey: v.ANTHROPIC_API_KEY,
    embeddingModel: v.EMBEDDING_MODEL,
    embeddingDimensions: v.EMBEDDING_DIMENSIONS,
    generationModel: v.GENERATION_MODEL,
    port: v.PORT,
  };
  return cached;
}

/** Reset for tests. */
export function resetConfigCache(): void {
  cached = null;
}

export function getConfig(): AppConfig {
  return loadConfig();
}
