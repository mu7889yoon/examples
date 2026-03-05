import type { Context } from 'hono';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { loadConfig, loadFunctions } from '../models/storage';
import type { InvokeRequest } from '../models/types';
import { runDocker } from '../services/docker';
import { logEvent } from '../services/logger';
import { functionNamePattern } from '../services/validation';

export async function invokeFunction(c: Context) {
  const name = c.req.param('name');
  if (!functionNamePattern.test(name)) {
    return c.json({ statusCode: 400, body: 'Invalid function name' }, 400);
  }

  let payload: InvokeRequest;
  try {
    payload = await c.req.json();
  } catch {
    return c.json({ statusCode: 400, body: 'Invalid JSON' }, 400);
  }

  const config = await loadConfig();
  const entries = await loadFunctions();
  const entry = entries.find((item) => item.name === name);
  if (!entry) {
    return c.json({ statusCode: 404, body: 'Function not found' }, 404);
  }

  const functionPath = path.resolve(entry.path);
  try {
    await stat(functionPath);
  } catch {
    return c.json({ statusCode: 500, body: 'Function code not found on disk' }, 500);
  }
  const containerName = `${config.containerNamePrefix}${name}`;

  const dockerArgs = ['run', '--rm', '-i', '--name', containerName];
  if (config.runAsUser) {
    dockerArgs.push('--user', config.runAsUser);
  }
  const runnerPath = path.resolve('runner.js');
  dockerArgs.push('-v', `${functionPath}:/app`, '-v', `${runnerPath}:/runner/runner.js:ro`);
  dockerArgs.push('-w', '/app', entry.image, 'bun', 'run', '/runner/runner.js');

  logEvent('invoke start', { name, image: entry.image });
  const eventPayload = JSON.stringify({ body: payload.body, metadata: payload.metadata ?? {} });
  const result = await runDocker(dockerArgs, eventPayload);

  if (result.code !== 0) {
    const errorBody = result.stderr.trim() || 'Function failed';
    logEvent('invoke failed', { name, code: result.code, stderr: result.stderr.trim() });
    return c.json({ statusCode: 500, body: `Error: ${errorBody}` }, 500);
  }

  const rawOutput = result.stdout.trim();
  let responsePayload: { statusCode: number; body: string };
  try {
    const parsed = JSON.parse(rawOutput) as { statusCode: number; body: string };
    if (typeof parsed.statusCode === 'number' && typeof parsed.body === 'string') {
      responsePayload = parsed;
    } else {
      responsePayload = { statusCode: 200, body: rawOutput };
    }
  } catch {
    responsePayload = { statusCode: 200, body: rawOutput };
  }

  logEvent('invoke success', { name, statusCode: responsePayload.statusCode });
  return c.json(responsePayload);
}
