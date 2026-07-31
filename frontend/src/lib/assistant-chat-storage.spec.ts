/**
 * @jest-environment jsdom
 */

import {
  assistantChatStorageKey,
  clearAssistantChat,
  loadAssistantChat,
  saveAssistantChat,
} from './assistant-chat-storage';

describe('assistant-chat-storage', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('keys storage by user and workspace', () => {
    expect(assistantChatStorageKey('u1', 'ws1')).toBe(
      'tt:assistant-chat:u1:ws1',
    );
  });

  it('round-trips messages per user/workspace', () => {
    saveAssistantChat('u1', 'ws1', [
      { id: '1', role: 'user', content: 'hello' },
      { id: '2', role: 'assistant', content: 'hi' },
    ]);
    saveAssistantChat('u2', 'ws1', [
      { id: '9', role: 'user', content: 'other user' },
    ]);

    expect(loadAssistantChat('u1', 'ws1')).toEqual([
      { id: '1', role: 'user', content: 'hello' },
      { id: '2', role: 'assistant', content: 'hi' },
    ]);
    expect(loadAssistantChat('u2', 'ws1')).toEqual([
      { id: '9', role: 'user', content: 'other user' },
    ]);
    expect(loadAssistantChat('u1', 'ws2')).toEqual([]);
  });

  it('clears only the matching thread', () => {
    saveAssistantChat('u1', 'ws1', [
      { id: '1', role: 'user', content: 'a' },
    ]);
    saveAssistantChat('u1', 'ws2', [
      { id: '2', role: 'user', content: 'b' },
    ]);
    clearAssistantChat('u1', 'ws1');
    expect(loadAssistantChat('u1', 'ws1')).toEqual([]);
    expect(loadAssistantChat('u1', 'ws2')).toEqual([
      { id: '2', role: 'user', content: 'b' },
    ]);
  });

  it('normalizes applying status to pending on load', () => {
    window.localStorage.setItem(
      assistantChatStorageKey('u1', 'ws1'),
      JSON.stringify([
        {
          id: 'a1',
          role: 'assistant',
          content: 'ok',
          proposals: [
            {
              key: 'k1',
              proposal: {
                type: 'create_project',
                summary: 'X',
                name: 'X',
              },
              status: 'applying',
            },
          ],
        },
      ]),
    );
    const loaded = loadAssistantChat('u1', 'ws1');
    expect(loaded[0]?.proposals?.[0]?.status).toBe('pending');
  });

  it('accepts applying status from runtime chat and persists as pending', () => {
    saveAssistantChat('u1', 'ws1', [
      {
        id: 'a1',
        role: 'assistant',
        content: 'ok',
        proposals: [
          {
            key: 'k1',
            proposal: {
              type: 'create_project',
              summary: 'X',
              name: 'X',
            },
            status: 'applying',
          },
        ],
      },
    ]);
    expect(loadAssistantChat('u1', 'ws1')[0]?.proposals?.[0]?.status).toBe(
      'pending',
    );
  });
});
