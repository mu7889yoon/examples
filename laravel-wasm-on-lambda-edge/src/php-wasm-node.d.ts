/**
 * @php-wasm/node の型定義補完
 *
 * パッケージの `export * from './lib'` が NodeNext モジュール解決で
 * 正しく解決されないため、必要な型を手動で再エクスポートする。
 */
declare module '@php-wasm/node' {
  import type { SupportedPHPVersion } from '@php-wasm/universal';

  interface PHPLoaderOptions {
    emscriptenOptions?: Record<string, unknown>;
  }

  export function loadNodeRuntime(
    phpVersion: SupportedPHPVersion,
    options?: PHPLoaderOptions,
  ): Promise<number>;
}
