import { build } from 'esbuild';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
const sourcePackage = resolve(import.meta.dirname, '../package.json');
const stagedPackage = resolve(staging, 'package.json');
const packageManifest = JSON.parse(readFileSync(sourcePackage, 'utf8'));
// esbuild emits index.js as CommonJS. Omitting this package-level setting keeps
// Node.js from treating that handler as an ES module inside the Lambda ZIP.
delete packageManifest.type;
writeFileSync(stagedPackage, `${JSON.stringify(packageManifest, null, 2)}\n`);
cpSync(resolve(import.meta.dirname, '../package-lock.json'), resolve(staging, 'package-lock.json'));
// OpenRouter judging reuses the canonical judge personas from the repository.
// Keep them alongside the bundled handler so the Lambda artifact does not
// depend on the source checkout at runtime.
cpSync(resolve(import.meta.dirname, '../../../configs/judges'), resolve(staging, 'configs/judges'), { recursive: true });
execFileSync('npm', ['ci', '--omit=dev', '--ignore-scripts'], { cwd: staging, stdio: 'inherit' });
execFileSync('zip', ['-q', '-r', archive, '.'], { cwd: staging });
