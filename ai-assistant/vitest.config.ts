import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.spec.ts'],
    environment: 'node',
    // Integration retrieval test needs live DB + OpenAI; unit tests do not.
    testTimeout: 60_000,
  },
});
