/**
 * PHP-WASM ブリッジ
 *
 * Node.js と PHP-WASM 間のデータ受け渡しを担当するクラス。
 * 仮想ファイルシステム `/tmp/bridge/` 配下の JSON ファイルを介して通信する。
 *
 * 通信フロー:
 *   1. Node.js → writeRequest() → /tmp/bridge/request.json → PHP
 *   2. PHP → /tmp/bridge/db_operation.json → readDbOperation() → Node.js
 *   3. Node.js → writeDbResult() → /tmp/bridge/db_result.json → PHP
 *   4. PHP → /tmp/bridge/response.json → readResponse() → Node.js
 */

import type { PHP } from '@php-wasm/universal';
import type { PhpRequest, PhpResponse, DbOperation, DbResult } from './types.js';

/** ブリッジ用仮想ファイルシステムのベースディレクトリ */
const BRIDGE_DIR = '/tmp/bridge';

/** 各ブリッジファイルのパス */
const PATHS = {
  request: `${BRIDGE_DIR}/request.json`,
  response: `${BRIDGE_DIR}/response.json`,
  dbOperation: `${BRIDGE_DIR}/db_operation.json`,
  dbResult: `${BRIDGE_DIR}/db_result.json`,
} as const;

/**
 * PHP-WASM ブリッジクラス
 *
 * PHP-WASM インスタンスの仮想ファイルシステムを介して
 * Node.js と PHP 間でデータをやり取りする。
 */
export class PhpWasmBridge {
  private php: PHP;

  constructor(php: PHP) {
    this.php = php;
    // ブリッジ用ディレクトリを作成する
    // mkdir は再帰的にディレクトリを作成するため /tmp が存在しなくても安全
    this.php.mkdir(BRIDGE_DIR);
  }

  /**
   * PHP 仮想ファイルシステムにリクエスト情報を書き込む
   *
   * CloudFront Origin Request から抽出した HTTP リクエスト情報を
   * JSON にシリアライズして仮想FS に配置する。
   */
  async writeRequest(request: PhpRequest): Promise<void> {
    const json = JSON.stringify(request);
    this.php.writeFile(PATHS.request, json);
  }

  /**
   * PHP 仮想ファイルシステムにデータベース結果を書き込む
   *
   * Node.js 側で実行した DB クエリの結果を JSON にシリアライズして
   * 仮想FS に配置し、PHP が読み取れるようにする。
   */
  async writeDbResult(result: DbResult): Promise<void> {
    const json = JSON.stringify(result);
    this.php.writeFile(PATHS.dbResult, json);
  }

  /**
   * PHP スクリプトを実行する
   *
   * 指定パスの PHP ファイルを PHP-WASM ランタイムで実行する。
   */
  async runPhp(scriptPath: string): Promise<void> {
    await this.php.run({ scriptPath });
  }

  /**
   * PHP 仮想ファイルシステムからレスポンスを読み取る
   *
   * PHP スクリプト実行後に仮想FS に書き込まれたレスポンス JSON を
   * デシリアライズして返す。
   */
  async readResponse(): Promise<PhpResponse> {
    const json = this.php.readFileAsText(PATHS.response);
    return JSON.parse(json) as PhpResponse;
  }

  /**
   * PHP 仮想ファイルシステムからデータベース操作要求を読み取る
   *
   * PHP が DB 操作を要求した場合、仮想FS に書き込まれた操作要求 JSON を
   * デシリアライズして返す。読み取り後にファイルを削除し、
   * 二重実行を防止する。
   *
   * @returns DB 操作要求。ファイルが存在しない場合（= DB 操作不要）は null。
   */
  async readDbOperation(): Promise<DbOperation | null> {
    try {
      const json = this.php.readFileAsText(PATHS.dbOperation);
      this.php.unlink(PATHS.dbOperation);
      return JSON.parse(json) as DbOperation;
    } catch {
      // ファイルが存在しない場合は DB 操作不要
      return null;
    }
  }
}
