import { describe, expect, it } from 'vitest';
import { regexFallbackIntent } from './intent.js';

describe('regexFallbackIntent', () => {
  it('detects English all-tasks phrasing', () => {
    expect(regexFallbackIntent('move all tasks to Done')).toEqual({
      isConfirmation: false,
      wantsAllTasksInScope: true,
      statusLimited: false,
    });
  });

  it('detects English source-status limits', () => {
    expect(regexFallbackIntent('move only TODO tasks to Done')).toEqual({
      isConfirmation: false,
      wantsAllTasksInScope: false,
      statusLimited: true,
    });
  });

  it('stays neutral on non-English without LLM', () => {
    expect(regexFallbackIntent('перенеси все задачи в Done')).toEqual({
      isConfirmation: false,
      wantsAllTasksInScope: false,
      statusLimited: false,
    });
  });

  it('marks English yes as confirmation', () => {
    expect(regexFallbackIntent('yes').isConfirmation).toBe(true);
  });
});
