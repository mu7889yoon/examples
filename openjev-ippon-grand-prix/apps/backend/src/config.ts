export interface BackendConfig {
  tableName: string;
  microvmImageIdentifier: string;
  microvmImageVersion?: string;
  microvmExecutionRoleArn?: string;
  microvmPort: number;
  durationSeconds: number;
  tokenExpirationMinutes: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): BackendConfig {
  const number = (key: string, fallback: number) => {
    const value = env[key];
    return value === undefined ? fallback : Number(value);
  };
  const tableName = env.SESSION_TABLE_NAME ?? 'openjev-sessions';
  const image = env.MICROVM_IMAGE_IDENTIFIER;
  if (!image) throw new Error('MICROVM_IMAGE_IDENTIFIER is required');
  const durationSeconds = number('SESSION_DURATION_SECONDS', 3600);
  if (!Number.isInteger(durationSeconds) || durationSeconds < 1 || durationSeconds > 28800) {
    throw new Error('SESSION_DURATION_SECONDS must be an integer from 1 to 28800');
  }
  return {
    tableName,
    microvmImageIdentifier: image,
    microvmImageVersion: env.MICROVM_IMAGE_VERSION,
    microvmExecutionRoleArn: env.MICROVM_RUNTIME_ROLE_ARN,
    microvmPort: number('MICROVM_PORT', 8080),
    durationSeconds,
    tokenExpirationMinutes: Math.min(60, Math.max(1, number('MICROVM_TOKEN_EXPIRATION_MINUTES', 60))),
  };
}
