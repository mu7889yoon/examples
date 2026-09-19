import { describe, expect, it } from 'vitest';
import { handle } from '../src/controller.js';
import { FakeMicroVmService, MemorySessionRepository } from '../src/fakes.js';
import type { BackendConfig } from '../src/config.js';

const config: BackendConfig = {
  tableName: 'test', microvmImageIdentifier: 'test-image', microvmPort: 8080,
  durationSeconds: 3600, tokenExpirationMinutes: 5,
};
const event = (method: string, path: string, body?: unknown) => ({
  httpMethod: method, path, body: body === undefined ? undefined : JSON.stringify(body),
  headers: {}, multiValueHeaders: {}, isBase64Encoded: false,
  requestContext: {} as never, resource: path, stageVariables: undefined,
} as never);

describe('controller', () => {
  it('starts a session without exposing MicroVM details and relays SSE', async () => {
    const sessions = new MemorySessionRepository();
    const microvms = new FakeMicroVmService();
    const upstreamRequests: Request[] = [];
    const response = await handle(event('POST', '/sessions'), {
      config, sessions, microvms,
      fetchImpl: async (input, init) => {
        upstreamRequests.push(new Request(input, init));
        return new Response('event: start\ndata: {}\n\nevent: complete\ndata: {}\n\n', { headers: { 'content-type': 'text/event-stream' } });
      },
    });
    expect(response.statusCode).toBe(201);
    const session = JSON.parse(response.body);
    expect(session.state).toBe('RUNNING');
    expect(session).not.toHaveProperty('endpoint');
    expect(session).not.toHaveProperty('microvmId');

    const stream = await handle(event('POST', `/sessions/${session.sessionId}/judge`, { topic: 'お題', answer: '回答' }), {
      config, sessions, microvms,
      fetchImpl: async (input, init) => {
        upstreamRequests.push(new Request(input, init));
        return new Response('event: start\ndata: {}\n\n', { headers: { 'content-type': 'text/event-stream' } });
      },
    });
    expect(stream.statusCode).toBe(200);
    expect(stream.headers?.['content-type']).toContain('text/event-stream');
    expect(stream.body).toContain('event: start');
    expect(upstreamRequests[0].headers.get('x-aws-proxy-auth')).toBe('fake-token');
    expect(upstreamRequests[0].headers.get('x-aws-proxy-port')).toBe('8080');
  });

  it('uses a conditional judge lock and returns 409 BUSY', async () => {
    const sessions = new MemorySessionRepository();
    const microvms = new FakeMicroVmService();
    const started = await handle(event('POST', '/sessions'), { config, sessions, microvms });
    const id = JSON.parse(started.body).sessionId;
    const lock = await sessions.acquireJudge(id, 'first');
    expect(lock.judgeLock).toBe(true);
    const result = await handle(event('POST', `/sessions/${id}/judge`, { topic: 'x', answer: 'y' }), { config, sessions, microvms });
    expect(result.statusCode).toBe(409);
    expect(result.body).toContain('BUSY');
    await sessions.releaseJudge(id, 'first');
  });
});
