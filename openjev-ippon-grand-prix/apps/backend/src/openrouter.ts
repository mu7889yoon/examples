/**
 * Thin client for OpenRouter's (currently alpha) Decisions endpoint.
 *
 * Jev uses the same `state` / `questions` / `answers` wire format as the
 * TypeSafe System One API, but OpenRouter exposes it at
 * `/api/alpha/decisions` and requires both criteria descriptions when a
 * Noul supplies criteria.
 */
export const OPENROUTER_DECISIONS_URL = 'https://openrouter.ai/api/alpha/decisions';
export const DEFAULT_OPENROUTER_JEV_MODEL = 'typesafe/jev-1.13';
export const MAX_NOUL_QUESTIONS = 20;

export type DecisionState = string | Record<string, unknown> | unknown[];

export interface OpenRouterNoulQuestion {
  type: 'noul';
  instructions: string;
  /** A partial criteria object is normalised before it is sent to OpenRouter. */
  criteria?: {
    true?: string;
    false?: string;
  };
}

export type OpenRouterNoulQuestions = Readonly<Record<string, OpenRouterNoulQuestion>>;

export interface OpenRouterNoulAnswer {
  type: 'noul';
  noul: number;
}

export interface OpenRouterDecisionUsage {
  input_tokens: number;
  output_tokens: number;
  cost?: number;
}

export interface OpenRouterNoulDecision {
  id?: string;
  model: string;
  provider?: string;
  answers: Record<string, OpenRouterNoulAnswer>;
  usage: OpenRouterDecisionUsage;
}

export interface OpenRouterJevClientOptions {
  apiKey: string;
  model?: string;
  endpoint?: string;
  timeoutMs?: number;
  maxRetries?: number;
  retryBaseDelayMs?: number;
  fetchImpl?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
}

export class OpenRouterDecisionError extends Error {
  constructor(message: string, public readonly statusCode?: number) {
    super(message);
    this.name = 'OpenRouterDecisionError';
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isFiniteNonNegativeNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;

const defaultSleep = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

/**
 * Evaluates up to 20 independent Noul questions in one OpenRouter request.
 * TypeSafe evaluates questions in a request in parallel, so this preserves
 * the low-latency fan-out needed for the 20 IPPON judges.
 */
export class OpenRouterJevClient {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly endpoint: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly retryBaseDelayMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (milliseconds: number) => Promise<void>;

  constructor(options: OpenRouterJevClientOptions) {
    if (!options.apiKey.trim()) throw new Error('OpenRouter API key is required');
    this.apiKey = options.apiKey;
    this.model = options.model ?? DEFAULT_OPENROUTER_JEV_MODEL;
    this.endpoint = options.endpoint ?? OPENROUTER_DECISIONS_URL;
    this.timeoutMs = options.timeoutMs ?? 5_000;
    this.maxRetries = options.maxRetries ?? 2;
    this.retryBaseDelayMs = options.retryBaseDelayMs ?? 100;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sleep = options.sleep ?? defaultSleep;

    if (!Number.isInteger(this.timeoutMs) || this.timeoutMs < 1) throw new Error('timeoutMs must be a positive integer');
    if (!Number.isInteger(this.maxRetries) || this.maxRetries < 0) throw new Error('maxRetries must be a non-negative integer');
    if (!Number.isInteger(this.retryBaseDelayMs) || this.retryBaseDelayMs < 0) throw new Error('retryBaseDelayMs must be a non-negative integer');
  }

  async evaluateNouls(state: DecisionState, questions: OpenRouterNoulQuestions): Promise<OpenRouterNoulDecision> {
    const normalizedQuestions = validateAndNormalizeQuestions(questions);
    const payload = JSON.stringify({ model: this.model, state, questions: normalizedQuestions });

    for (let attempt = 0; ; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
      let response: Response;
      try {
        response = await this.fetchImpl(this.endpoint, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${this.apiKey}`,
            'content-type': 'application/json',
          },
          body: payload,
          signal: controller.signal,
        });
      } catch (error) {
        if (controller.signal.aborted) {
          throw new OpenRouterDecisionError(`OpenRouter Decisions request timed out after ${this.timeoutMs}ms`);
        }
        throw new OpenRouterDecisionError(`OpenRouter Decisions request failed: ${toErrorMessage(error)}`);
      } finally {
        clearTimeout(timeout);
      }

      if (response.ok) {
        let body: unknown;
        try {
          body = await response.json();
        } catch {
          throw new OpenRouterDecisionError('OpenRouter Decisions response is not valid JSON');
        }
        return parseDecisionResponse(body, Object.keys(normalizedQuestions));
      }

      if ((response.status === 429 || response.status === 529) && attempt < this.maxRetries) {
        await this.sleep(retryDelayMilliseconds(response.headers.get('retry-after'), attempt, this.retryBaseDelayMs));
        continue;
      }

      const body = await response.text();
      throw new OpenRouterDecisionError(
        `OpenRouter Decisions request failed with ${response.status}${body ? `: ${body.slice(0, 500)}` : ''}`,
        response.status,
      );
    }
  }
}

function validateAndNormalizeQuestions(questions: OpenRouterNoulQuestions): Record<string, OpenRouterNoulQuestion> {
  const entries = Object.entries(questions);
  if (entries.length === 0 || entries.length > MAX_NOUL_QUESTIONS) {
    throw new Error(`questions must contain from 1 to ${MAX_NOUL_QUESTIONS} Noul questions`);
  }

  const normalized: Record<string, OpenRouterNoulQuestion> = {};
  for (const [id, question] of entries) {
    if (!id.trim()) throw new Error('question id must not be empty');
    if (!isRecord(question) || question.type !== 'noul') throw new Error(`question ${id} must have type "noul"`);
    if (!question.instructions.trim()) throw new Error(`question ${id} must have instructions`);
    if (question.criteria && Object.values(question.criteria).some((value) => value !== undefined && typeof value !== 'string')) {
      throw new Error(`question ${id} criteria values must be strings`);
    }
    normalized[id] = question.criteria === undefined
      ? { type: 'noul', instructions: question.instructions }
      : {
        type: 'noul',
        instructions: question.instructions,
        // The OpenRouter Decisions schema requires both keys when criteria is present.
        criteria: { true: question.criteria.true ?? '', false: question.criteria.false ?? '' },
      };
  }
  return normalized;
}

function parseDecisionResponse(value: unknown, requestedQuestionIds: string[]): OpenRouterNoulDecision {
  if (!isRecord(value) || typeof value.model !== 'string' || !isRecord(value.answers) || !isRecord(value.usage)) {
    throw new OpenRouterDecisionError('OpenRouter Decisions response has an invalid shape');
  }
  const usage = value.usage;
  if (!isFiniteNonNegativeNumber(usage.input_tokens) || !isFiniteNonNegativeNumber(usage.output_tokens)
    || (usage.cost !== undefined && !isFiniteNonNegativeNumber(usage.cost))) {
    throw new OpenRouterDecisionError('OpenRouter Decisions response has invalid usage');
  }

  const answers: Record<string, OpenRouterNoulAnswer> = {};
  for (const id of requestedQuestionIds) {
    const answer = value.answers[id];
    if (!isRecord(answer) || answer.type !== 'noul' || !isFiniteNonNegativeNumber(answer.noul) || answer.noul > 1) {
      throw new OpenRouterDecisionError(`OpenRouter Decisions response has invalid Noul answer for ${id}`);
    }
    answers[id] = { type: 'noul', noul: answer.noul };
  }

  return {
    ...(typeof value.id === 'string' ? { id: value.id } : {}),
    model: value.model,
    ...(typeof value.provider === 'string' ? { provider: value.provider } : {}),
    answers,
    usage: {
      input_tokens: usage.input_tokens,
      output_tokens: usage.output_tokens,
      ...(usage.cost === undefined ? {} : { cost: usage.cost }),
    },
  };
}

function retryDelayMilliseconds(retryAfter: string | null, attempt: number, fallbackBaseDelayMs: number): number {
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1_000);
    const dateMilliseconds = Date.parse(retryAfter);
    if (!Number.isNaN(dateMilliseconds)) return Math.max(0, dateMilliseconds - Date.now());
  }
  return fallbackBaseDelayMs * 2 ** attempt;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
