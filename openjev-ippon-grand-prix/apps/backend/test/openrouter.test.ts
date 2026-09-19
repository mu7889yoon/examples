import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_OPENROUTER_JEV_MODEL,
  MAX_NOUL_QUESTIONS,
  OpenRouterDecisionError,
  OpenRouterJevClient,
} from '../src/openrouter.js';

const decision = (answers: Record<string, number>) => new Response(JSON.stringify({
  id: 'decision-1',
  model: DEFAULT_OPENROUTER_JEV_MODEL,
  provider: 'typesafe',
  answers: Object.fromEntries(Object.entries(answers).map(([id, noul]) => [id, { type: 'noul', noul }])),
  usage: { input_tokens: 123, output_tokens: 20, cost: 0.00001 },
}), { status: 200, headers: { 'content-type': 'application/json' } });

describe('OpenRouterJevClient', () => {
  it('sends 20 Noul questions in one Decisions request and normalizes criteria', async () => {
    const fetchImpl = vi.fn(async () => decision(Object.fromEntries(
      Array.from({ length: MAX_NOUL_QUESTIONS }, (_, index) => [`judge-${index + 1}`, index / 20]),
    )));
    const client = new OpenRouterJevClient({ apiKey: 'test-key', fetchImpl });
    const questions = Object.fromEntries(Array.from({ length: MAX_NOUL_QUESTIONS }, (_, index) => [
      `judge-${index + 1}`,
      { type: 'noul' as const, instructions: `Judge ${index + 1}`, criteria: { true: 'laughs' } },
    ]));

    const result = await client.evaluateNouls({ topic: 'お題', answer: '回答' }, questions);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const request = new Request(fetchImpl.mock.calls[0][0], fetchImpl.mock.calls[0][1]);
    expect(request.url).toBe('https://openrouter.ai/api/alpha/decisions');
    expect(request.headers.get('authorization')).toBe('Bearer test-key');
    const body = await request.json() as { model: string; questions: Record<string, { criteria: { true: string; false: string } }> };
    expect(body.model).toBe(DEFAULT_OPENROUTER_JEV_MODEL);
    expect(Object.keys(body.questions)).toHaveLength(MAX_NOUL_QUESTIONS);
    expect(body.questions['judge-1'].criteria).toEqual({ true: 'laughs', false: '' });
    expect(result.answers['judge-20'].noul).toBe(0.95);
    expect(result.usage.cost).toBe(0.00001);
  });

  it.each([429, 529])('retries OpenRouter status %i and honours Retry-After', async (status) => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response('busy', { status, headers: { 'retry-after': '0.25' } }))
      .mockResolvedValueOnce(decision({ judge: 0.8 }));
    const sleep = vi.fn(async () => undefined);
    const client = new OpenRouterJevClient({ apiKey: 'test-key', fetchImpl, sleep, maxRetries: 1 });

    await expect(client.evaluateNouls('回答', { judge: { type: 'noul', instructions: '笑った？' } })).resolves.toMatchObject({
      answers: { judge: { noul: 0.8 } },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(250);
  });

  it('fails with a clear timeout error', async () => {
    const fetchImpl: typeof fetch = async (_input, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    });
    const client = new OpenRouterJevClient({ apiKey: 'test-key', fetchImpl, timeoutMs: 10 });

    await expect(client.evaluateNouls('回答', { judge: { type: 'noul', instructions: '笑った？' } }))
      .rejects.toThrow('timed out after 10ms');
  });

  it('rejects malformed or incomplete Decisions responses', async () => {
    const client = new OpenRouterJevClient({
      apiKey: 'test-key',
      fetchImpl: async () => decision({ otherJudge: 0.8 }),
    });
    await expect(client.evaluateNouls('回答', { judge: { type: 'noul', instructions: '笑った？' } }))
      .rejects.toBeInstanceOf(OpenRouterDecisionError);
  });
});
