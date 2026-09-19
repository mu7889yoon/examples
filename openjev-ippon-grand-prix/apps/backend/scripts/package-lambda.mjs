import { build } from 'esbuild';
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const target = process.argv[2];
const entries = {
  controller: 'src/lambda-controller.ts',
  'streaming-proxy': 'src/lambda-streaming-proxy.ts',
};

if (!(target in entries)) {
  throw new Error('usage: node scripts/package-lambda.mjs <controller|streaming-proxy>');
}

const artifacts = resolve(import.meta.dirname, '../../../artifacts');
const staging = resolve(artifacts, target);
const archive = resolve(artifacts, `${target}.zip`);
rmSync(staging, { recursive: true, force: true });
rmSync(archive, { force: true });
mkdirSync(staging, { recursive: true });

await build({
  entryPoints: [entries[target]],
  bundle: true,
  format: 'cjs',
  platform: 'node',
  target: 'node22',
  packages: 'external',
  outfile: resolve(staging, 'index.js'),
  sourcemap: true,
});
// Keep the SDK outside the bundle. This avoids coupling the artifact to the
// Lambda runtime's bundled SDK and includes the MicroVM client explicitly.
// Install production dependencies only: copying the source node_modules tree
// would also put esbuild, TypeScript and Vitest into each Lambda artifact.
cpSync(resolve(import.meta.dirname, '../package.json'), resolve(staging, 'package.json'));
cpSync(resolve(import.meta.dirname, '../package-lock.json'), resolve(staging, 'package-lock.json'));
execFileSync('npm', ['ci', '--omit=dev', '--ignore-scripts'], { cwd: staging, stdio: 'inherit' });
execFileSync('zip', ['-q', '-r', archive, '.'], { cwd: staging });
