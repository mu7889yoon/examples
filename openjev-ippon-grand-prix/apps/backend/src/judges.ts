import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export interface JudgeDefinition {
  id: string;
  name: string;
  persona: string;
}

const DEFAULT_JUDGES_DIRS = [
  process.env.JUDGES_DIR,
  '/var/task/configs/judges',
  resolve(process.cwd(), 'configs/judges'),
  resolve(process.cwd(), '../../configs/judges'),
].filter((value): value is string => Boolean(value));

/** Load the single source of truth shared by the MicroVM and OpenRouter paths. */
export function loadJudgeDefinitions(directory?: string): JudgeDefinition[] {
  const judgesDir = directory ?? DEFAULT_JUDGES_DIRS.find((candidate) => existsSync(candidate));
  if (!judgesDir) throw new Error('judge definitions directory was not found');
  const judges = readdirSync(judgesDir)
    .filter((file) => /^judge-\d+\.json$/.test(file))
    .sort()
    .map((file) => JSON.parse(readFileSync(resolve(judgesDir, file), 'utf8')) as unknown)
    .map(parseJudge)
    .sort((left, right) => left.id.localeCompare(right.id));
  if (judges.length === 0) throw new Error(`no judge definitions found in ${judgesDir}`);
  if (new Set(judges.map((judge) => judge.id)).size !== judges.length) throw new Error('judge ids must be unique');
  return judges;
}

function parseJudge(value: unknown): JudgeDefinition {
  if (!value || typeof value !== 'object') throw new Error('judge definition must be an object');
  const record = value as Record<string, unknown>;
  if ([record.id, record.name, record.persona].some((field) => typeof field !== 'string' || !field.trim())) {
    throw new Error('judge definition requires non-empty id, name and persona');
  }
  return { id: record.id as string, name: record.name as string, persona: record.persona as string };
}
