/**
 * ChatAnthropic wrapper: LangChain 0.3.x defaults top_p/top_k to -1 as
 * "unset", but Claude 4.6+ rejects those sentinels with 400.
 */

import { ChatAnthropic } from '@langchain/anthropic';
import { getConfig } from '../config.js';

type InvocationOptions = Parameters<ChatAnthropic['invocationParams']>[0];

export class ChatAnthropicCompat extends ChatAnthropic {
  override invocationParams(options?: InvocationOptions) {
    const params = super.invocationParams(options);
    const cleaned = { ...params } as Record<string, unknown>;
    if (cleaned['top_p'] === -1) delete cleaned['top_p'];
    if (cleaned['top_k'] === -1) delete cleaned['top_k'];
    return cleaned as ReturnType<ChatAnthropic['invocationParams']>;
  }
}

export function createChatModel(maxTokens: number): ChatAnthropic {
  const cfg = getConfig();
  return new ChatAnthropicCompat({
    apiKey: cfg.anthropicApiKey,
    model: cfg.generationModel,
    maxTokens,
  });
}
