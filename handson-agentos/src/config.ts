import dotenv from "dotenv";
import type { AppConfig, AWSCredentials } from "./types.js";

export const DEFAULT_PROMPT =
  "FizzBuzzを1から30まで出力するプログラムを書いて実行して";

const AGENT_COUNT = 5;

/**
 * CLI 引数パース + .env 読み込み → AppConfig を返す
 *
 * - process.argv[2]: プロンプト文字列（省略時は DEFAULT_PROMPT）
 * - --output-dir=<path>: ブログ用レポート出力先（オプション）
 */
export function loadConfig(): AppConfig {
  dotenv.config();

  let prompt = DEFAULT_PROMPT;
  let outputDir: string | null = null;

  const args = process.argv.slice(2);

  for (const arg of args) {
    if (arg.startsWith("--output-dir=")) {
      outputDir = arg.slice("--output-dir=".length);
    } else if (!arg.startsWith("--")) {
      // 最初の非フラグ引数をプロンプトとして採用
      prompt = arg;
    }
  }

  const awsCredentials: AWSCredentials = {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? "",
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? "",
    sessionToken: process.env.AWS_SESSION_TOKEN ?? "",
    region: process.env.AWS_REGION ?? "",
  };

  return {
    prompt,
    agentCount: AGENT_COUNT,
    awsCredentials,
    outputDir,
  };
}

/**
 * AWS credentials の存在チェック。
 * 全フィールドが非空文字列なら true を返す。
 */
export async function validateCredentials(
  creds: AWSCredentials,
): Promise<boolean> {
  return (
    typeof creds.accessKeyId === "string" &&
    creds.accessKeyId.length > 0 &&
    typeof creds.secretAccessKey === "string" &&
    creds.secretAccessKey.length > 0 &&
    typeof creds.sessionToken === "string" &&
    creds.sessionToken.length > 0 &&
    typeof creds.region === "string" &&
    creds.region.length > 0
  );
}
