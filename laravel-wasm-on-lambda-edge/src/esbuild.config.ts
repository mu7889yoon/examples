// src/esbuild.config.ts
import { build } from 'esbuild';
import { copyFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

async function main() {
  // Bundle the handler
  await build({
    entryPoints: ['handler.ts'],
    bundle: true,
    platform: 'node',
    target: 'node18',
    format: 'esm',
    outfile: 'dist/handler.mjs',
    external: [
      '@php-wasm/node',
      '@php-wasm/universal',
      'pg-native',
    ],
    treeShaking: true,
    minify: false, // Keep readable for debugging
    sourcemap: false,
    banner: {
      js: `
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
`.trim(),
    },
  });

  // Copy PHP source files to dist
  mkdirSync('dist/php/views', { recursive: true });
  const phpFiles = [
    'helpers.php',
    'router.php',
    'index.php',
    'resume.php',
    'views/list.php',
    'views/error.php',
  ];
  for (const file of phpFiles) {
    copyFileSync(join('php', file), join('dist/php', file));
  }

  console.log('Build complete: dist/handler.mjs + PHP files');
}

main().catch(console.error);
