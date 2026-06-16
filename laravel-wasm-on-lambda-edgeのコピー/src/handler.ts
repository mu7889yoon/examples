/**
 * Lambda@Edge Origin Request ハンドラー
 *
 * CloudFront の Origin Request イベントを受け取り、PHP-WASM で処理して
 * HTTP レスポンスを直接返す「Originless パターン」のハンドラー。
 *
 * 処理フロー:
 *   1. CloudFront イベントから HTTP リクエスト情報を抽出
 *   2. PHP-WASM ランタイムを初期化（ウォームスタート時はキャッシュを再利用）
 *   3. PHP スクリプト (index.php) を実行
 *   4. DB 操作ブリッジループ: PHP が DB 操作を要求する限り繰り返す
 *   5. PHP レスポンスを CloudFrontRequestResult 形式に変換して返す
 */

import type {
  CloudFrontRequestEvent,
  CloudFrontRequestResult,
  CloudFrontHeaders,
} from 'aws-lambda';
import { PhpWasmBridge } from './bridge.js';
import { DsqlClient } from './db-client.js';
import type { PhpRequest, PhpResponse } from './types.js';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// ============================================================
// 定数
// ============================================================

/** PHP 仮想FS にロードするソースファイル一覧 */
const PHP_FILES = [
  'helpers.php',
  'router.php',
  'index.php',
  'resume.php',
  'views/list.php',
  'views/error.php',
];

/**
 * Aurora DSQL 接続設定
 *
 * Lambda@Edge は環境変数を使用できないため、エンドポイントをハードコードする。
 * CDK デプロイ後に実際のエンドポイントに置き換える。
 */
const DSQL_CONFIG = {
  endpoint: process.env.DSQL_ENDPOINT || 'tztxms3h2t3skczngb4wtu2s2m.dsql.us-east-1.on.aws',
  region: 'us-east-1',
  database: 'postgres',
};

// ============================================================
// グローバルキャッシュ（ウォームスタート用）
// ============================================================

/** PHP-WASM インスタンスのキャッシュ */
let phpInstance: any = null;

/** DsqlClient インスタンスのキャッシュ */
let dbClient: DsqlClient | null = null;

/** PHP ソースファイルが仮想FS にロード済みかどうか */
let phpFilesLoaded = false;

// ============================================================
// 内部ヘルパー関数
// ============================================================

/**
 * PHP-WASM インスタンスを取得する（未初期化の場合は新規作成）
 *
 * `@php-wasm/node` と `@php-wasm/universal` を動的インポートし、
 * ESM/CJS 互換性の問題を回避する。
 */
async function getPhpInstance(): Promise<any> {
  if (!phpInstance) {
    const { loadNodeRuntime } = await import('@php-wasm/node');
    const { PHP } = await import('@php-wasm/universal');
    phpInstance = new PHP(await loadNodeRuntime('8.3'));
  }
  return phpInstance;
}

/**
 * PHP ソースファイルを仮想FS にロードする
 *
 * ディスク上の `src/php/` ディレクトリから PHP ファイルを読み取り、
 * PHP-WASM の仮想FS `/app/` 配下に書き込む。
 * 一度ロードしたらフラグで管理し、ウォームスタート時はスキップする。
 */
function loadPhpFiles(php: any): void {
  if (phpFilesLoaded) return;

  const __dirname = dirname(fileURLToPath(import.meta.url));
  const phpDir = join(__dirname, 'php');

  php.mkdir('/app');
  php.mkdir('/app/views');

  for (const file of PHP_FILES) {
    const content = readFileSync(join(phpDir, file), 'utf-8');
    php.writeFile(`/app/${file}`, content);
  }

  phpFilesLoaded = true;
}

/**
 * DsqlClient インスタンスを取得する（未初期化の場合は新規作成・接続）
 *
 * 初回接続時に posts テーブルとインデックスを自動作成する。
 */
async function getDbClient(): Promise<DsqlClient> {
  if (!dbClient) {
    dbClient = new DsqlClient(DSQL_CONFIG);
    await dbClient.connect();

    // 初回接続時にテーブルを自動作成
    await dbClient.execute(`
      CREATE TABLE IF NOT EXISTS posts (
        id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        author_name VARCHAR(100) NOT NULL,
        content TEXT NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
      )
    `);
    await dbClient.execute(
      'CREATE INDEX IF NOT EXISTS idx_posts_created_at ON posts (created_at DESC)',
    );
  }
  return dbClient;
}

/**
 * CloudFront ヘッダー形式からシンプルな key-value マップに変換する
 */
function extractHeaders(
  cfHeaders: CloudFrontHeaders,
): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [key, values] of Object.entries(cfHeaders)) {
    if (values && values.length > 0) {
      headers[key] = values[0].value;
    }
  }
  return headers;
}

/**
 * シンプルな key-value マップを CloudFront ヘッダー形式に変換する
 */
function formatCfHeaders(
  headers: Record<string, string>,
): CloudFrontHeaders {
  const cfHeaders: CloudFrontHeaders = {};
  for (const [key, value] of Object.entries(headers)) {
    cfHeaders[key.toLowerCase()] = [{ key, value }];
  }
  return cfHeaders;
}

/**
 * HTTP ステータスコードに対応する説明文を返す
 */
function getStatusDescription(code: number): string {
  const descriptions: Record<number, string> = {
    200: 'OK',
    302: 'Found',
    400: 'Bad Request',
    404: 'Not Found',
    500: 'Internal Server Error',
  };
  return descriptions[code] || 'Unknown';
}

// ============================================================
// メインハンドラー
// ============================================================

/**
 * Lambda@Edge Origin Request ハンドラー
 *
 * CloudFront Origin Request イベントを受け取り、PHP-WASM で処理して
 * CloudFrontRequestResult を返す。
 *
 * @param event - CloudFront Origin Request イベント
 * @returns CloudFrontRequestResult 形式の HTTP レスポンス
 */
export async function handler(
  event: CloudFrontRequestEvent,
): Promise<CloudFrontRequestResult> {
  try {
    const cfRequest = event.Records[0].cf.request;

    // Step 1: CloudFront イベントから PhpRequest を構築
    const phpRequest: PhpRequest = {
      method: cfRequest.method,
      uri: cfRequest.uri,
      queryString: cfRequest.querystring || '',
      body: cfRequest.body?.data
        ? cfRequest.body.encoding === 'base64'
          ? Buffer.from(cfRequest.body.data, 'base64').toString('utf-8')
          : cfRequest.body.data
        : '',
      headers: extractHeaders(cfRequest.headers),
    };

    // Step 2: PHP-WASM ランタイムを初期化
    const php = await getPhpInstance();
    loadPhpFiles(php);

    // Step 3: ブリッジを作成し、リクエスト情報を仮想FS に書き込む
    const bridge = new PhpWasmBridge(php);
    await bridge.writeRequest(phpRequest);

    // Step 4: index.php を実行（初回パス）
    await bridge.runPhp('/app/index.php');

    // Step 5: DB 操作ブリッジループ
    let dbOp = await bridge.readDbOperation();
    while (dbOp !== null) {
      const client = await getDbClient();
      const result =
        dbOp.action === 'query'
          ? await client.query(dbOp.sql, dbOp.params)
          : await client.execute(dbOp.sql, dbOp.params);

      await bridge.writeDbResult(result);
      await bridge.runPhp('/app/resume.php');

      dbOp = await bridge.readDbOperation();
    }

    // Step 6: PHP レスポンスを読み取り、CloudFront 形式に変換
    const phpResponse: PhpResponse = await bridge.readResponse();

    return {
      status: String(phpResponse.statusCode),
      statusDescription: getStatusDescription(phpResponse.statusCode),
      headers: formatCfHeaders(phpResponse.headers),
      body: phpResponse.body,
    };
  } catch (error) {
    console.error('Lambda@Edge handler error:', error);

    // エラー時は PHP インスタンスをリセット（破損状態の可能性があるため）
    phpInstance = null;
    phpFilesLoaded = false;

    return {
      status: '500',
      statusDescription: 'Internal Server Error',
      headers: {
        'content-type': [
          { key: 'Content-Type', value: 'text/html; charset=utf-8' },
        ],
      },
      body: '<h1>500 Internal Server Error</h1><p>サーバーエラーが発生しました。</p>',
    };
  }
}
