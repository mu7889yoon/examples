// src/esbuild.config.ts
import { build } from 'esbuild';
import { copyFileSync, mkdirSync, cpSync, existsSync } from 'node:fs';
import { join } from 'node:path';

async function main() {
  // Clean dist
  if (existsSync('dist')) {
    const { rmSync } = await import('node:fs');
    rmSync('dist', { recursive: true });
  }

  // Bundle the handler - include @php-wasm packages in the bundle
  // Only .wasm files need to be copied separately
  await build({
    entryPoints: ['handler.ts'],
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'esm',
    outfile: 'dist/handler.mjs',
    external: [
      'pg-native',
    ],
    // Treat .wasm files as external files (they can't be bundled)
    loader: {
      '.wasm': 'file',
    },
    treeShaking: true,
    minify: true,
    sourcemap: false,
    banner: {
      js: `
import { createRequire } from 'module';
import { dirname as __pathDirname } from 'path';
import { fileURLToPath as __fileURLToPath } from 'url';
const require = createRequire(import.meta.url);
const __filename = __fileURLToPath(import.meta.url);
const __dirname = __pathDirname(__filename);
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

  // Copy only PHP 8.3 WASM binary (not all versions)
  // The @php-wasm/node package contains WASM binaries for all PHP versions
  // We only need 8.3 for our use case
  const wasmSrc = 'node_modules/@php-wasm/node/8_3_0/php_8_3.wasm';
  if (existsSync(wasmSrc)) {
    mkdirSync('dist/8_3_0', { recursive: true });
    copyFileSync(wasmSrc, 'dist/8_3_0/php_8_3.wasm');
  }

  // Copy any .wasm files that esbuild may have output
  // (from the loader: { '.wasm': 'file' } setting)

  console.log('Build complete: dist/');

  // Show dist size
  const { execSync } = await import('node:child_process');
  const size = execSync('du -sh dist/').toString().trim();
  console.log(`Dist size: ${size}`);
}

main().catch(console.error);
