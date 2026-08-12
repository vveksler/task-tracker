import { describe, expect, it } from 'vitest';
import {
  effectiveQuestionForGuards,
  formatConversationHistory,
  isLikelyFollowUp,
  isShortConfirmation,
  retrievalQuery,
} from './history.js';

describe('conversation history helpers', () => {
  it('detects English short confirmations (fallback)', () => {
    expect(isShortConfirmation('yes')).toBe(true);
    expect(isShortConfirmation('OK')).toBe(true);
    expect(isShortConfirmation('go ahead')).toBe(true);
    expect(isShortConfirmation('yes, but only TODO')).toBe(false);
  });

  it('treats short replies as follow-ups without a word list', () => {
    expect(isLikelyFollowUp('давай')).toBe(true);
    expect(isLikelyFollowUp('сделай')).toBe(true);
    expect(isLikelyFollowUp('yes')).toBe(true);
    expect(isLikelyFollowUp('assign Vadim to all Auth tasks please')).toBe(
      false,
    );
  });

  it('folds prior user ask for short follow-ups', () => {
    const history = [
      { role: 'user', content: 'assign Vadim to all tasks' },
      {
        role: 'assistant',
        content: 'Shall I assign Vadim to all 5 tasks?',
      },
    ];
    expect(effectiveQuestionForGuards('давай', history)).toBe(
      'assign Vadim to all tasks\nдавай',
    );
    expect(effectiveQuestionForGuards('yes', history, true)).toBe(
      'assign Vadim to all tasks\nyes',
    );
  });

  it('always enriches retrieval query with recent user turns', () => {
    const history = [
      { role: 'user', content: 'assign Vadim to all Auth tasks' },
      { role: 'assistant', content: 'Confirm?' },
    ];
    const q = retrievalQuery('давай', history);
    expect(q).toContain('assign Vadim');
    expect(q).toContain('давай');

    const first = retrievalQuery('what is blocked?', []);
    expect(first).toBe('what is blocked?');
  });

  it('formats conversation history', () => {
    const block = formatConversationHistory([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
    ]);
    expect(block).toContain('<conversation_history>');
    expect(block).toContain('User: hi');
    expect(block).toContain('Assistant: hello');
  });
});
