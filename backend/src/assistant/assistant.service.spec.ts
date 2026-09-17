import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AssistantService } from './assistant.service';
import { fetchWithRetry } from './fetch-with-retry';

jest.mock('./fetch-with-retry', () => ({ fetchWithRetry: jest.fn() }));

const mockFetch = fetchWithRetry as jest.MockedFunction<typeof fetchWithRetry>;

function makeService(internalToken: string): AssistantService {
  const config = {
    get: jest.fn((key: string) => {
      if (key === 'assistant.url') return 'http://ai:8000';
      if (key === 'assistant.internalToken') return internalToken;
      return undefined;
    }),
  } as unknown as ConfigService;
  return new AssistantService(config);
}

describe('AssistantService internal auth', () => {
  beforeEach(() => mockFetch.mockReset());

  it('sends the shared secret on /internal/embed', async () => {
    mockFetch.mockResolvedValue(new Response('{}', { status: 200 }));

    await makeService('secret-token').reindex('task-1', 'Title', null);

    expect(mockFetch).toHaveBeenCalledWith(
      'http://ai:8000/internal/embed',
      expect.objectContaining({
        headers: expect.objectContaining({
          'x-internal-token': 'secret-token',
        }),
      }),
    );
  });

  it('sends the shared secret on /internal/assistant/ask', async () => {
    mockFetch.mockResolvedValue(new Response('data: x\n\n', { status: 200 }));

    await makeService('secret-token').ask('ws-1', 'question');

    expect(mockFetch).toHaveBeenCalledWith(
      'http://ai:8000/internal/assistant/ask',
      expect.objectContaining({
        headers: expect.objectContaining({
          'x-internal-token': 'secret-token',
        }),
      }),
    );
  });

  it('refuses to call the AI service when the token is not configured', async () => {
    await expect(makeService('').ask('ws-1', 'question')).rejects.toThrow(
      ServiceUnavailableException,
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
