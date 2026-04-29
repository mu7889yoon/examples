/**
 * @php-wasm/universal の型定義補完
 *
 * パッケージの `export * from './lib'` が NodeNext モジュール解決で
 * 正しく解決されないため、必要な型を手動で再エクスポートする。
 */
declare module '@php-wasm/universal' {
  export { PHP } from '@php-wasm/universal/lib/php';
}
