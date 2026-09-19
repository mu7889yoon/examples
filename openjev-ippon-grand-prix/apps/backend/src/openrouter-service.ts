import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { OpenRouterJevClient, type DecisionState, type OpenRouterNoulDecision, type OpenRouterNoulQuestions } from './openrouter.js';

/** The narrow controller-facing contract makes provider tests network-free. */
export interface OpenRouterJudgeService {
  evaluateNouls(state: DecisionState, questions: OpenRouterNoulQuestions): Promise<OpenRouterNoulDecision>;
}

export interface AwsOpenRouterJudgeServiceOptions {
  apiKey?: string;
  apiKeySecretArn?: string;
  model?: string;
  fetchImpl?: typeof fetch;
}

/**
 * Lazily reads the API key so MicroVM-only invocations never need Secrets
 * Manager, then delegates request validation/retry behavior to openrouter.ts.
 */
export class AwsOpenRouterJudgeService implements OpenRouterJudgeService {
  private readonly apiKey: Promise<string>;
  private readonly model?: string;
  private readonly fetchImpl?: typeof fetch;
  private client?: Promise<OpenRouterJevClient>;

  constructor(options: AwsOpenRouterJudgeServiceOptions) {
    this.apiKey = options.apiKey?.trim()
      ? Promise.resolve(options.apiKey)
      : loadSecret(options.apiKeySecretArn);
    this.model = options.model;
    this.fetchImpl = options.fetchImpl;
  }

  evaluateNouls(state: DecisionState, questions: OpenRouterNoulQuestions): Promise<OpenRouterNoulDecision> {
    return (this.client ??= this.apiKey.then((apiKey) => new OpenRouterJevClient({
      apiKey,
      model: this.model,
      ...(this.fetchImpl ? { fetchImpl: this.fetchImpl } : {}),
    }))).then((client) => client.evaluateNouls(state, questions));
  }
}

async function loadSecret(secretId: string | undefined): Promise<string> {
  if (!secretId?.trim()) throw new Error('OpenRouter API key is not configured');
  const result = await new SecretsManagerClient({}).send(new GetSecretValueCommand({ SecretId: secretId }));
  const secret = result.SecretString?.trim();
  if (!secret) throw new Error('OpenRouter API key secret has no SecretString value');

  // Support a plain key (the Terraform instructions) and the common JSON
  // representation without allowing a secret value to reach an error response.
  try {
    const value: unknown = JSON.parse(secret);
    if (value && typeof value === 'object') {
      const key = (value as Record<string, unknown>).OPENROUTER_API_KEY ?? (value as Record<string, unknown>).apiKey;
      if (typeof key === 'string' && key.trim()) return key;
    }
  } catch { /* A raw key is expected in the normal case. */ }
  return secret;
}
