import { randomUUID } from 'node:crypto';
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { loadConfig, type BackendConfig } from './config.js';
import { DEFAULT_OPENROUTER_JEV_MODEL, type OpenRouterNoulQuestions } from './openrouter.js';
import { AwsOpenRouterJudgeService, type OpenRouterJudgeService } from './openrouter-service.js';
import { loadJudgeDefinitions } from './judges.js';
import { ApiError, ConditionalCheckFailed, type MicroVmService, type SessionRecord, type SessionRepository, type RunMicrovmInput } from './types.js';

export interface ControllerDependencies {
  config: BackendConfig;
  sessions: SessionRepository;
  microvms: MicroVmService;
  /** Required only for the OpenRouter provider; injectable for controller tests. */
  openrouter?: OpenRouterJudgeService;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  sleep?: (milliseconds: number) => Promise<void>;
}

export function createDefaultDependencies(): ControllerDependencies {
  const config = loadConfig();
  const dependencies: ControllerDependencies = {
    config,
    sessions: new LazyDynamoSessionRepository(config.tableName),
    microvms: new LazyMicroVmService(),
  };
  // The session Lambda does not need the provider credential. Only create the
  // client when this process actually has a key (the streaming proxy does).
  if (provider(dependencies) === 'openrouter' && (config.openrouterApiKey || config.openrouterApiKeySecretArn)) {
    dependencies.openrouter = new AwsOpenRouterJudgeService({
      apiKey: config.openrouterApiKey,
      apiKeySecretArn: config.openrouterApiKeySecretArn,
      model: config.openrouterModel,
    });
  }
  return dependencies;
}

// Keep AWS SDK modules out of cold-start/test imports. They are loaded only when a
// real Lambda invocation calls the default dependencies.
class LazyDynamoSessionRepository implements SessionRepository {
  private loaded?: Promise<SessionRepository>;
  constructor(private readonly tableName: string) {}
  private load(): Promise<SessionRepository> { return this.loaded ??= import('./repository.js').then(({ DynamoSessionRepository }) => new DynamoSessionRepository(this.tableName)); }
  create(r: SessionRecord) { return this.load().then(x => x.create(r)); }
  get(id: string) { return this.load().then(x => x.get(id)); }
  update(r: SessionRecord) { return this.load().then(x => x.update(r)); }
  updateState(...args: Parameters<SessionRepository['updateState']>) { return this.load().then(x => x.updateState(...args)); }
  acquireJudge(...args: Parameters<SessionRepository['acquireJudge']>) { return this.load().then(x => x.acquireJudge(...args)); }
  releaseJudge(...args: Parameters<SessionRepository['releaseJudge']>) { return this.load().then(x => x.releaseJudge(...args)); }
}
class LazyMicroVmService implements MicroVmService {
  private loaded?: Promise<MicroVmService>;
  private load(): Promise<MicroVmService> { return this.loaded ??= import('./microvm.js').then(({ AwsMicroVmService }) => new AwsMicroVmService()); }
  run(i: RunMicrovmInput) { return this.load().then(x => x.run(i)); }
  get(id: string) { return this.load().then(x => x.get(id)); }
  terminate(id: string) { return this.load().then(x => x.terminate(id)); }
  createAuthToken(id: string, minutes: number, port?: number) { return this.load().then(x => x.createAuthToken(id, minutes, port)); }
}

const defaultDependencies = (): ControllerDependencies => createDefaultDependencies();
let dependenciesFactory: () => ControllerDependencies = defaultDependencies;

/** Test hook and Lambda bootstrap hook. It does not expose MicroVM credentials. */
export function setDependencies(factory: () => ControllerDependencies): void { dependenciesFactory = factory; }

export function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> { return handle(event); }

export async function handle(event: APIGatewayProxyEvent, deps = dependenciesFactory()): Promise<APIGatewayProxyResult> {
  const method = event.httpMethod.toUpperCase();
  const path = event.path || '';
  try {
    if (method === 'POST' && path === '/sessions') return await createSession(deps);
    const match = path.match(/^\/sessions\/([^/]+)(?:\/judge)?$/);
    if (!match) throw new ApiError(404, 'not found', 'NOT_FOUND');
    const sessionId = decodeURIComponent(match[1]);
    if (method === 'GET' && path === `/sessions/${match[1]}`) return await getSession(sessionId, deps);
    if (method === 'DELETE' && path === `/sessions/${match[1]}`) return await deleteSession(sessionId, deps);
    if (method === 'POST' && path.endsWith('/judge')) return await judge(sessionId, event, deps);
    throw new ApiError(404, 'not found', 'NOT_FOUND');
  } catch (error) {
    return errorResponse(error);
  }
}

type LambdaResponseStream = {
  setContentType?: (value: string) => void;
  write: (chunk: string | Uint8Array) => void;
  end: () => void;
};

type LambdaStreamingRuntime = {
  awslambda?: {
    streamifyResponse?: (fn: Function) => unknown;
    HttpResponseStream?: {
      from: (stream: LambdaResponseStream, metadata: { statusCode: number; headers: Record<string, string> }) => LambdaResponseStream;
    };
  };
};

const lambdaStreamingRuntime = globalThis as unknown as LambdaStreamingRuntime;

/** Lambda response-streaming entrypoint. API Gateway must be configured for response streaming. */
export const streamingHandler = typeof lambdaStreamingRuntime.awslambda?.streamifyResponse === 'function'
  && typeof lambdaStreamingRuntime.awslambda.HttpResponseStream?.from === 'function'
  ? lambdaStreamingRuntime.awslambda.streamifyResponse(async (event: APIGatewayProxyEvent, responseStream: LambdaResponseStream) => {
      // API Gateway response streaming requires the status/header metadata frame
      // before the SSE payload. HttpResponseStream writes its required delimiter.
      const output = lambdaStreamingRuntime.awslambda!.HttpResponseStream!.from(responseStream, {
        statusCode: 200,
        headers: sseHeaders(),
      });
      const deps = dependenciesFactory();
      const path = event.path || '';
      if (event.httpMethod.toUpperCase() === 'POST' && path.match(/^\/sessions\/[^/]+\/judge$/)) {
        try {
          const sessionId = decodeURIComponent(path.split('/')[2]);
          await proxyJudge(sessionId, event, deps, (chunk) => output.write(chunk));
        } catch (error) {
          console.error("Judge stream failed", { path, error });
          output.write(`event: error\ndata: ${JSON.stringify(error instanceof ApiError ? { error: error.code, message: error.message } : { error: 'INTERNAL_ERROR' })}\n\n`);
        } finally { output.end(); }
        return;
      }
      const result = await handle(event, deps);
      if (typeof result !== 'string' && result.body) output.write(result.isBase64Encoded ? Buffer.from(result.body, 'base64') : result.body);
      output.end();
    })
  : handler;

async function createSession(deps: ControllerDependencies): Promise<APIGatewayProxyResult> {
  const now = (deps.now ?? (() => new Date()))();
  const record: SessionRecord = {
    sessionId: randomUUID(), state: 'STARTING', startedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + deps.config.durationSeconds * 1000).toISOString(),
    updatedAt: now.toISOString(), modelName: provider(deps) === 'openrouter'
      ? deps.config.openrouterModel ?? DEFAULT_OPENROUTER_JEV_MODEL
      : process.env.MODEL_NAME ?? 'Qwen3-0.6B',
  };
  await deps.sessions.create(record);
  if (provider(deps) === 'openrouter') {
    const updated = await deps.sessions.updateState(record.sessionId, 'RUNNING', {}, 'STARTING');
    return json(201, publicSession(updated));
  }
  try {
    const vm = await deps.microvms.run({
      imageIdentifier: deps.config.microvmImageIdentifier, imageVersion: deps.config.microvmImageVersion,
      executionRoleArn: deps.config.microvmExecutionRoleArn,
      maximumDurationInSeconds: deps.config.durationSeconds, clientToken: record.sessionId,
      runHookPayload: JSON.stringify({ sessionId: record.sessionId }),
    });
    const state = vm.state === 'RUNNING' ? 'RUNNING' : 'STARTING';
    const updated = await deps.sessions.updateState(record.sessionId, state, { microvmId: vm.id, endpoint: vm.endpoint }, 'STARTING');
    return json(201, publicSession(updated));
  } catch (error) {
    await deps.sessions.updateState(record.sessionId, 'FAILED', { errorMessage: error instanceof Error ? error.message : 'MicroVM startup failed' }, 'STARTING').catch(() => undefined);
    throw error;
  }
}

async function getSession(sessionId: string, deps: ControllerDependencies): Promise<APIGatewayProxyResult> {
  const record = await requireSession(sessionId, deps);
  const current = provider(deps) === 'microvm' ? await refreshState(record, deps) : record;
  return json(200, publicSession(current));
}

async function refreshState(record: SessionRecord, deps: ControllerDependencies): Promise<SessionRecord> {
  if (!record.microvmId || (record.state !== 'STARTING' && record.state !== 'RUNNING')) return record;
  try {
    const vm = await deps.microvms.get(record.microvmId);
    if (vm.state === 'RUNNING' && record.state === 'STARTING') return await deps.sessions.updateState(record.sessionId, 'RUNNING', { endpoint: vm.endpoint }, 'STARTING');
    if (['TERMINATED', 'TERMINATING'].includes(vm.state)) return await deps.sessions.updateState(record.sessionId, 'ENDED', {}, record.state);
    if (vm.endpoint && vm.endpoint !== record.endpoint) return await deps.sessions.updateState(record.sessionId, record.state, { endpoint: vm.endpoint }, record.state);
  } catch (error) {
    // Preserve a useful session response while recording why the provider state
    // could not be refreshed. This is essential for diagnosing IAM or service
    // transition failures without hiding them behind STARTING indefinitely.
    console.warn("Unable to refresh MicroVM state", { sessionId: record.sessionId, error });
  }
  return (await deps.sessions.get(record.sessionId)) ?? record;
}

async function deleteSession(sessionId: string, deps: ControllerDependencies): Promise<APIGatewayProxyResult> {
  let record = await requireSession(sessionId, deps);
  if (record.state === 'ENDED' || record.state === 'FAILED') return json(202, publicSession(record));
  record = await deps.sessions.updateState(sessionId, 'TERMINATING', {}, record.state);
  if (provider(deps) === 'openrouter') {
    const ended = await deps.sessions.updateState(sessionId, 'ENDED', {}, 'TERMINATING');
    return json(202, publicSession(ended));
  }
  if (record.microvmId) {
    try { await deps.microvms.terminate(record.microvmId); }
    catch (error) { await deps.sessions.updateState(sessionId, 'FAILED', { errorMessage: error instanceof Error ? error.message : 'MicroVM termination failed' }, 'TERMINATING').catch(() => undefined); throw error; }
  }
  return json(202, publicSession(record));
}

async function judge(sessionId: string, event: APIGatewayProxyEvent, deps: ControllerDependencies): Promise<APIGatewayProxyResult> {
  let body = '';
  const decoder = new TextDecoder();
  await proxyJudge(sessionId, event, deps, (chunk) => { body += typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true }); });
  body += decoder.decode();
  return { statusCode: 200, headers: sseHeaders(), body, isBase64Encoded: false };
}

async function proxyJudge(sessionId: string, event: APIGatewayProxyEvent, deps: ControllerDependencies, onChunk: (chunk: string | Uint8Array) => void): Promise<void> {
  const record = await requireSession(sessionId, deps);
  const now = (deps.now ?? (() => new Date()))();
  if (record.state !== 'RUNNING') throw new ApiError(409, `session is ${record.state}`, 'NOT_RUNNING');
  if (new Date(record.expiresAt).getTime() <= now.getTime()) { await deps.sessions.updateState(sessionId, 'ENDED', {}, 'RUNNING').catch(() => undefined); throw new ApiError(409, 'session expired', 'EXPIRED'); }
  const input = parseJudgeInput(event);
  const requestId = randomUUID();
  try { await deps.sessions.acquireJudge(sessionId, requestId); }
  catch (error) { if (error instanceof ConditionalCheckFailed) throw new ApiError(409, 'another judge is already running', 'BUSY'); throw error; }
  try {
    if (provider(deps) === 'openrouter') {
      await judgeWithOpenRouter(input, deps, onChunk);
      return;
    }
    if (!record.microvmId) throw new ApiError(503, 'MicroVM is not ready', 'NOT_READY');
    const vm = await deps.microvms.get(record.microvmId);
    if (!vm.endpoint || vm.state !== 'RUNNING') throw new ApiError(503, 'MicroVM is not ready', 'NOT_READY');
    const token = await deps.microvms.createAuthToken(record.microvmId, deps.config.tokenExpirationMinutes, deps.config.microvmPort);
    const fetcher = deps.fetchImpl ?? fetch;
    const endpoint = vm.endpoint.startsWith('http') ? vm.endpoint : `https://${vm.endpoint}`;
    const response = await fetcher(`${endpoint.replace(/\/$/, '')}/judge`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'text/event-stream', 'x-aws-proxy-auth': token, 'x-aws-proxy-port': String(deps.config.microvmPort) }, body: JSON.stringify(input) });
    if (!response.ok) throw new ApiError(502, `MicroVM returned ${response.status}`, 'MICROVM_ERROR');
    if (response.body) {
      for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) onChunk(chunk);
    } else onChunk(await response.text());
  } finally { await deps.sessions.releaseJudge(sessionId, requestId); }
}

const OPENROUTER_LAUGH_THRESHOLD = 0.7;
const OPENROUTER_IPPON_RATIO = 0.5;
const OPENROUTER_REVEAL_MIN_DELAY_MS = 200;
const OPENROUTER_REVEAL_MAX_DELAY_MS = 3_000;

async function judgeWithOpenRouter(input: { topic: string; answer: string }, deps: ControllerDependencies, onChunk: (chunk: string) => void): Promise<void> {
  const client = deps.openrouter;
  if (!client) throw new ApiError(503, 'OpenRouter is not configured', 'NOT_READY');
  const judges = loadJudgeDefinitions();
  const questions: OpenRouterNoulQuestions = Object.fromEntries(judges.map(({ id, persona }) => [id, {
    type: 'noul' as const,
    instructions: `Judge persona: ${persona}\n\nこの回答を聞いて、あなたは笑いますか？`,
    criteria: { true: '笑う', false: '笑わない' },
  }]));
  const judgeCount = judges.length;
  const threshold = validRatio(deps.config.laughProbabilityThreshold, OPENROUTER_LAUGH_THRESHOLD);
  const ipponRatio = validRatio(deps.config.ipponThresholdRatio, OPENROUTER_IPPON_RATIO);
  const requiredLaughCount = Math.ceil(judgeCount * ipponRatio);
  onChunk(sseEvent('start', { judgeCount, requiredLaughCount, ipponThresholdRatio: ipponRatio }));
  let decision;
  try {
    decision = await client.evaluateNouls({
      system: 'あなたは大喜利大会の観客です。', language: 'ja',
      context: '回答を実際に聞いた観客として、簡単には笑わず、意外性・切れ味・お題への適合がある場合だけ自然に笑うかどうかを判定してください。',
      topic: input.topic, answer: input.answer,
    }, questions);
  } catch (error) {
    console.error('OpenRouter judge request failed', { error });
    throw new ApiError(502, 'OpenRouter judge request failed', 'OPENROUTER_ERROR');
  }

  let completedCount = 0;
  let laughCount = 0;
  let score = 0;
  let ippon = false;
  for (const { id, name } of judges) {
    const probability = decision.answers[id]?.noul;
    // The client validates the response, but keep the public stream safe if a
    // compatible alternative implementation is injected.
    if (typeof probability !== 'number' || !Number.isFinite(probability) || probability < 0 || probability > 1) {
      throw new ApiError(502, `OpenRouter returned an invalid answer for ${id}`, 'OPENROUTER_ERROR');
    }
    completedCount += 1;
    score += probability;
    const laughed = probability >= threshold;
    if (laughed) laughCount += 1;
    await revealDelay(deps, completedCount, judgeCount);
    onChunk(sseEvent('judge', { id, name, probability, laughed, completedCount, laughCount, judgeCount }));
    if (!ippon && laughCount >= requiredLaughCount) {
      ippon = true;
      onChunk(sseEvent('ippon', { laughCount, requiredLaughCount, judgeCount }));
    }
  }
  // Avoid exposing binary floating-point noise (for example 9.999999999999993)
  // in the otherwise stable public SSE contract.
  onChunk(sseEvent('complete', { laughCount, judgeCount, score: Number(score.toFixed(12)), ippon }));
}

async function revealDelay(deps: ControllerDependencies, completedCount: number, judgeCount: number): Promise<void> {
  const sleep = deps.sleep ?? ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const configured = Number(process.env.JUDGE_REVEAL_DELAY_MS);
  if (Number.isFinite(configured) && configured >= 0) {
    await sleep(configured);
    return;
  }
  // Spread reveals across the requested 0.2–3.0 second range. A deterministic
  // sequence keeps the POC reproducible while still feeling like a live panel.
  const min = Number(process.env.JUDGE_REVEAL_MIN_DELAY_MS ?? OPENROUTER_REVEAL_MIN_DELAY_MS);
  const max = Number(process.env.JUDGE_REVEAL_MAX_DELAY_MS ?? OPENROUTER_REVEAL_MAX_DELAY_MS);
  const delay = Math.round(min + ((max - min) * (completedCount - 1)) / Math.max(1, judgeCount - 1));
  if (delay > 0) await sleep(delay);
}

function parseJudgeInput(event: APIGatewayProxyEvent): { topic: string; answer: string } {
  let raw = event.body ?? '';
  if (event.isBase64Encoded) raw = Buffer.from(raw, 'base64').toString('utf8');
  let body: unknown;
  try { body = JSON.parse(raw); } catch { throw new ApiError(400, 'body must be JSON', 'INVALID_JSON'); }
  if (!body || typeof body !== 'object' || typeof (body as Record<string, unknown>).topic !== 'string' || typeof (body as Record<string, unknown>).answer !== 'string') throw new ApiError(400, 'topic and answer are required strings', 'INVALID_INPUT');
  const value = body as { topic: string; answer: string };
  if (!value.topic.trim() || !value.answer.trim()) throw new ApiError(400, 'topic and answer must not be empty', 'INVALID_INPUT');
  return value;
}

async function requireSession(id: string, deps: ControllerDependencies): Promise<SessionRecord> { const record = await deps.sessions.get(id); if (!record) throw new ApiError(404, 'session not found', 'NOT_FOUND'); return record; }
function provider(deps: ControllerDependencies): 'microvm' | 'openrouter' { return deps.config.provider ?? 'microvm'; }
function validRatio(value: number | undefined, fallback: number): number { return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1 ? value : fallback; }
function sseEvent(event: string, data: unknown): string { return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`; }
function publicSession(record: SessionRecord): Record<string, unknown> { return { sessionId: record.sessionId, state: record.state, startedAt: record.startedAt, expiresAt: record.expiresAt, modelName: record.modelName }; }
function corsHeaders(): Record<string, string> {
  // The POC is deliberately unauthenticated. Lock this down to the CloudFront
  // origin before making it internet-facing.
  return { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'DELETE,GET,OPTIONS,POST' };
}
function sseHeaders(): Record<string, string> { return { ...corsHeaders(), 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache, no-store', connection: 'keep-alive' }; }
function json(statusCode: number, body: unknown): APIGatewayProxyResult { return { statusCode, headers: { ...corsHeaders(), 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }, body: JSON.stringify(body) }; }
function errorResponse(error: unknown): APIGatewayProxyResult { if (error instanceof ApiError) return json(error.statusCode, { error: error.code, message: error.message }); console.error(error); return json(500, { error: 'INTERNAL_ERROR', message: 'internal server error' }); }
