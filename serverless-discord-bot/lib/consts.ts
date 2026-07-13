import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** プロジェクトルート */
export const PROJECT_ROOT = path.join(__dirname, '..');

/** Lambda ソースパス */
export const INTERACTION_BOT_PATH = path.join(PROJECT_ROOT, 'lambda', 'interactions');
export const MICROVM_BOT_PATH = path.join(PROJECT_ROOT, 'lambda', 'mircovms');

/** MicroVM Image 設定 */
export const IMAGE_NAME = 'discord-echo-bot-cdk';
export const LOG_GROUP_NAME = '/aws/lambda-microvms/discord-echo-bot-cdk';
export const BASE_IMAGE_VERSION = '0';
export const MINIMUM_MEMORY_IN_MIB = 512;
export const HOOK_PORT = 9000;

/** MicroVM ソースパス */
export const MICROVM_SOURCE_PATH = path.join(PROJECT_ROOT, 'lambda', 'mircovms');

/** バンドル対象ファイル（zip に含めるもの） */
export const BUNDLE_INCLUDES = ['Dockerfile', 'package.json', 'package-lock.json', 'discord-echo-bot.mjs', 'microvm-runtime.mjs'];

/** Asset 除外パターン（CDK Asset にコピーしないもの） */
export const ASSET_EXCLUDES = [
  'node_modules',
  '.venv',
  'cdk.out',
  '.git',
  '*.ts',
  'tsconfig.json',
  'bin',
  'lib',
  'scripts',
  'memo.md',
  '.env',
  'microvm-artifact.zip',
  'cdk.context.json',
  'requirements.txt',
];

/** .env ファイルから環境変数を読み込む */
export function loadDotEnv(): Record<string, string> {
  const envPath = path.join(PROJECT_ROOT, '.env');
  if (!fs.existsSync(envPath)) return {};
  const values: Record<string, string> = {};
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const [key, ...rest] = trimmed.split('=');
    values[key.trim()] = rest.join('=').trim().replace(/^["']|["']$/g, '');
  }
  return values;
}
