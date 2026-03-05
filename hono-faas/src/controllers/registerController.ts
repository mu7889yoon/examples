import type { Context } from 'hono';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { loadConfig, loadFunctions, saveFunctions } from '../models/storage';
import type { RegisterPayload } from '../models/types';
import { runDocker } from '../services/docker';
import { logEvent } from '../services/logger';
import { functionNamePattern, imagePattern } from '../services/validation';
import { registerPageHtml } from '../views/registerPage';

function isHtmx(c: Context): boolean {
  return c.req.header('HX-Request') === 'true';
}

function errorResponse(c: Context, message: string, status: number) {
  if (isHtmx(c)) {
    return c.html(`<p class="result error">${message}</p>`, status);
  }
  return c.json({ statusCode: status, body: message }, status);
}

function successResponse(c: Context, message: string) {
  if (isHtmx(c)) {
    return c.html(`<p class="result success">${message}</p>`);
  }
  return c.json({ statusCode: 200, body: message });
}

async function parseRegisterPayload(c: Context): Promise<RegisterPayload> {
  const contentType = c.req.header('content-type') ?? '';
  if (contentType.includes('application/json')) {
    return (await c.req.json()) as RegisterPayload;
  }
  const body = await c.req.parseBody();
  return {
    name: String(body.name ?? ''),
    image: String(body.image ?? ''),
    code: typeof body.code === 'string' ? body.code : undefined
  };
}

export async function registerFunction(c: Context) {
  let payload: RegisterPayload;
  try {
    payload = await parseRegisterPayload(c);
  } catch {
    return errorResponse(c, 'Invalid request body', 400);
  }

  const name = payload.name?.trim();
  const image = payload.image?.trim();
  const code = payload.code;
  if (!name || !image) {
    return errorResponse(c, 'name and image are required', 400);
  }
  if (!functionNamePattern.test(name)) {
    return errorResponse(c, 'Invalid function name', 400);
  }
  if (!imagePattern.test(image)) {
    return errorResponse(c, 'Invalid image name', 400);
  }

  const config = await loadConfig();
  const entries = await loadFunctions();
  if (entries.some((entry) => entry.name === name)) {
    return errorResponse(c, 'Function already registered', 409);
  }

  if (config.dockerImagePullOnRegister) {
    logEvent('docker pull start', { image });
    const pullResult = await runDocker(['pull', image]);
    if (pullResult.code !== 0) {
      logEvent('docker pull failed', { image, stderr: pullResult.stderr });
      const message = `docker pull failed: ${pullResult.stderr.trim()}`;
      return errorResponse(c, message, 500);
    }
    logEvent('docker pull completed', { image });
  }

  const entry = {
    name,
    image,
    path: path.join(config.functionsDir, name)
  };
  entries.push(entry);
  await saveFunctions(entries);

  if (code && code.trim().length > 0) {
    const targetDir = path.resolve(entry.path);
    await mkdir(targetDir, { recursive: true });
    const handlerPath = path.join(targetDir, 'handler.js');
    await writeFile(handlerPath, code, 'utf8');
  }

  return successResponse(c, 'registered');
}

export function showRegisterForm(c: Context) {
  return c.html(registerPageHtml);
}
