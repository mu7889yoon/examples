/**
 * Aurora DSQL データベースクライアント
 *
 * IAM 認証トークンを使用して Aurora DSQL に接続し、
 * PostgreSQL クエリを実行するクライアントクラス。
 * Lambda@Edge 環境向けにコネクションプール設定を最適化している。
 */

import pg from 'pg';
const { Pool } = pg;
import { DsqlSigner } from '@aws-sdk/dsql-signer';
import type { DbClientConfig, DbResult } from './types.js';

/**
 * Aurora DSQL データベースクライアント
 *
 * `@aws-sdk/dsql-signer` による IAM 認証トークン生成と
 * `pg` (node-postgres) による PostgreSQL 接続管理を行う。
 * SSL (verify-full) 接続を使用し、セキュアな通信を保証する。
 */
export class DsqlClient {
  /** データベース接続設定 */
  private config: DbClientConfig;
  /** PostgreSQL コネクションプール */
  private pool: pg.Pool | null = null;

  /**
   * DsqlClient を初期化する
   *
   * @param config - Aurora DSQL 接続設定（エンドポイント、リージョン、データベース名）
   */
  constructor(config: DbClientConfig) {
    this.config = config;
  }

  /**
   * IAM 認証トークンを生成して Aurora DSQL への接続を確立する
   *
   * `@aws-sdk/dsql-signer` で管理者用 IAM 認証トークンを生成し、
   * SSL (verify-full) で PostgreSQL コネクションプールを作成する。
   * Lambda@Edge のコールドスタート最適化のため、プール最大接続数は 1 に設定。
   */
  async connect(): Promise<void> {
    const signer = new DsqlSigner({
      hostname: this.config.endpoint,
      region: this.config.region,
    });
    const token = await signer.getDbConnectAdminAuthToken();

    this.pool = new Pool({
      host: this.config.endpoint,
      port: 5432,
      user: 'admin',
      password: token,
      database: this.config.database,
      ssl: { rejectUnauthorized: true },
      max: 1,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });
  }

  /**
   * SELECT クエリを実行し結果を返す
   *
   * @param sql - SQL クエリ文（パラメータバインド $1, $2 を使用）
   * @param params - バインドパラメータの配列
   * @returns クエリ結果を含む DbResult。エラー時は error フィールドにメッセージを設定
   * @throws 接続が確立されていない場合は Error をスロー
   */
  async query(sql: string, params: (string | number | null)[] = []): Promise<DbResult> {
    if (!this.pool) throw new Error('Not connected');
    try {
      const result = await this.pool.query(sql, params);
      return {
        rows: result.rows,
        rowCount: result.rows.length,
      };
    } catch (error) {
      return {
        rows: [],
        rowCount: 0,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * INSERT/UPDATE/DELETE クエリを実行し結果を返す
   *
   * @param sql - SQL クエリ文（パラメータバインド $1, $2 を使用）
   * @param params - バインドパラメータの配列
   * @returns 実行結果を含む DbResult。エラー時は error フィールドにメッセージを設定
   * @throws 接続が確立されていない場合は Error をスロー
   */
  async execute(sql: string, params: (string | number | null)[] = []): Promise<DbResult> {
    if (!this.pool) throw new Error('Not connected');
    try {
      const result = await this.pool.query(sql, params);
      return {
        rows: result.rows ?? [],
        rowCount: result.rowCount ?? 0,
      };
    } catch (error) {
      return {
        rows: [],
        rowCount: 0,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * データベース接続を閉じる
   *
   * コネクションプールを終了し、すべての接続を解放する。
   */
  async disconnect(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
    }
  }
}
