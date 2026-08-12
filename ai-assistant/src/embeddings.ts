/**
 * Turns text into a vector. Used for indexing tasks and embedding questions.
 */

import { OpenAIEmbeddings } from '@langchain/openai';
import { getConfig } from './config.js';

let embeddings: OpenAIEmbeddings | null = null;

function getEmbeddings(): OpenAIEmbeddings {
  if (embeddings) return embeddings;
  const cfg = getConfig();
  embeddings = new OpenAIEmbeddings({
    apiKey: cfg.openaiApiKey,
    model: cfg.embeddingModel,
    dimensions: cfg.embeddingDimensions,
  });
  return embeddings;
}

export async function embedText(text: string): Promise<number[]> {
  // Truncate defensively — embedding models have a token limit.
  const truncated = text.slice(0, 8000);
  const vector = await getEmbeddings().embedQuery(truncated);
  return vector;
}

/** Format as pgvector literal string for ::vector casts. */
export function embeddingLiteral(embedding: number[]): string {
  return `[${embedding.join(',')}]`;
}
