export type SessionState = 'STARTING' | 'RUNNING' | 'TERMINATING' | 'ENDED' | 'FAILED';

export interface SessionRecord {
  sessionId: string;
  state: SessionState;
  microvmId?: string;
  endpoint?: string;
  startedAt: string;
  expiresAt: string;
  updatedAt: string;
  judgeLock?: boolean;
  judgeRequestId?: string;
  errorMessage?: string;
  modelName?: string;
}

export interface RunMicrovmInput {
  imageIdentifier: string;
  imageVersion?: string;
  executionRoleArn?: string;
  maximumDurationInSeconds: number;
  clientToken: string;
  runHookPayload?: string;
}

export interface MicroVm {
  id: string;
  state: string;
  endpoint?: string;
}

export interface MicroVmService {
  run(input: RunMicrovmInput): Promise<MicroVm>;
  get(id: string): Promise<MicroVm>;
  terminate(id: string): Promise<void>;
  createAuthToken(id: string, expirationMinutes: number, port?: number): Promise<string>;
}

export interface SessionRepository {
  create(record: SessionRecord): Promise<void>;
  get(sessionId: string): Promise<SessionRecord | undefined>;
  update(record: SessionRecord): Promise<void>;
  updateState(sessionId: string, state: SessionState, patch?: Partial<SessionRecord>, expected?: SessionState): Promise<SessionRecord>;
  acquireJudge(sessionId: string, requestId: string): Promise<SessionRecord>;
  releaseJudge(sessionId: string, requestId: string): Promise<void>;
}

export class ConditionalCheckFailed extends Error {
  constructor(message = 'conditional check failed') {
    super(message);
    this.name = 'ConditionalCheckFailed';
  }
}

export class ApiError extends Error {
  constructor(public readonly statusCode: number, message: string, public readonly code = 'BAD_REQUEST') {
    super(message);
    this.name = 'ApiError';
  }
}
