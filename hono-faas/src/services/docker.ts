import { spawn } from 'node:child_process';

export function runDocker(
  args: string[],
  input?: string
): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    if (input) {
      child.stdin.write(input);
    }
    child.stdin.end();
    child.on('error', (error) => reject(error));
    child.on('close', (code) => resolve({ stdout, stderr, code }));
  });
}
