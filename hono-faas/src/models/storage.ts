import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Config, FunctionEntry } from './types';

const CONFIG_PATH = path.resolve('config.json');
const FUNCTIONS_PATH = path.resolve('functions.json');

export async function loadConfig(): Promise<Config> {
  const raw = await readFile(CONFIG_PATH, 'utf8');
  const config = JSON.parse(raw) as Config;
  if (!config.port) {
    throw new Error('config.port is required');
  }
  if (!config.functionsDir) {
    throw new Error('config.functionsDir is required');
  }
  if (!config.containerNamePrefix) {
    throw new Error('config.containerNamePrefix is required');
  }
  return config;
}

export async function loadFunctions(): Promise<FunctionEntry[]> {
  const raw = await readFile(FUNCTIONS_PATH, 'utf8');
  return JSON.parse(raw) as FunctionEntry[];
}

export async function saveFunctions(entries: FunctionEntry[]): Promise<void> {
  const data = JSON.stringify(entries, null, 2);
  await writeFile(FUNCTIONS_PATH, `${data}\n`, 'utf8');
}
