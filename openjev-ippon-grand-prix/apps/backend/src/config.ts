export type JudgingProvider = 'microvm' | 'openrouter';

export interface BackendConfig {
  tableName: string;
  /** Defaults to MicroVM for compatibility with existing deployments. */
  provider?: JudgingProvider;
  microvmImageIdentifier: string;
  microvmImageVersion?: string;
  microvmExecutionRoleArn?: string;
  microvmPort: number;
  durationSeconds: number;
  tokenExpirationMinutes: number;
  /** OpenRouter settings are used only when provider is `openrouter`. */
  openrouterModel?: string;
  openrouterApiKey?: string;
  openrouterApiKeySecretArn?: string;
  laughProbabilityThreshold?: number;
  ipponThresholdRatio?: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): BackendConfig {
  const number = (key: string, fallback: number) => {
    const value = env[key];
    return value === undefined ? fallback : Number(value);
  };
  const tableName = env.SESSION_TABLE_NAME ?? 'openjev-sessions';
  const provider = env.JUDGING_PROVIDER ?? 'microvm';
  if (provider !== 'microvm' && provider !== 'openrouter') {
    throw new Error('JUDGING_PROVIDER must be either microvm or openrouter');
  }
  const image = env.MICROVM_IMAGE_IDENTIFIER;
  if (provider === 'microvm' && !image) throw new Error('MICROVM_IMAGE_IDENTIFIER is required when JUDGING_PROVIDER is microvm');
  const openrouterModel = env.OPENROUTER_MODEL ?? 'typesafe/jev-1.13';
  if (!openrouterModel.trim()) throw new Error('OPENROUTER_MODEL must not be empty');
  const openrouterApiKey = env.OPENROUTER_API_KEY;
  const openrouterApiKeySecretArn = env.OPENROUTER_API_KEY_SECRET_ARN;
  // The session Lambda shares this config but never evaluates a judgment, so
  // it intentionally does not receive the provider credential. The streaming
  // proxy reports NOT_READY if neither key source is configured.
  const durationSeconds = number('SESSION_DURATION_SECONDS', 3600);
  if (!Number.isInteger(durationSeconds) || durationSeconds < 1 || durationSeconds > 28800) {
    throw new Error('SESSION_DURATION_SECONDS must be an integer from 1 to 28800');
  }
  return {
    tableName,
    provider,
    // The MicroVM adapter is never called for OpenRouter sessions. Keep this
    // value defined to retain the existing adapter's input contract.
    microvmImageIdentifier: image ?? '',
    microvmImageVersion: env.MICROVM_IMAGE_VERSION,
    microvmExecutionRoleArn: env.MICROVM_RUNTIME_ROLE_ARN,
    microvmPort: number('MICROVM_PORT', 8080),
    durationSeconds,
    tokenExpirationMinutes: Math.min(60, Math.max(1, number('MICROVM_TOKEN_EXPIRATION_MINUTES', 60))),
    openrouterModel,
    openrouterApiKey,
    openrouterApiKeySecretArn,
    laughProbabilityThreshold: number('LAUGH_PROBABILITY_THRESHOLD', 0.7),
    ipponThresholdRatio: number('IPPON_THRESHOLD_RATIO', 0.5),
  };
}
