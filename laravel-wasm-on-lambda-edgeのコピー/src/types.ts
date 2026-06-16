/**
 * PHP-WASM 掲示板 on Lambda@Edge 共通型定義
 *
 * アプリケーション全体で使用されるインターフェースを定義する。
 * 掲示板の投稿データ、PHP-WASM ブリッジ通信、データベース操作に関する型を含む。
 */

// ============================================================
// 掲示板データモデル
// ============================================================

/**
 * 掲示板の投稿
 *
 * データベースの posts テーブルに対応するインターフェース。
 * フィールド名は TypeScript の camelCase 規約に従う。
 */
export interface Post {
  /** 投稿の一意識別子（UUID） */
  id: string;
  /** 投稿者名 */
  authorName: string;
  /** 投稿内容 */
  content: string;
  /** 投稿日時（ISO 8601 形式） */
  createdAt: string;
}

/**
 * 新規投稿リクエストの入力データ
 *
 * POST /board で送信されるフォームデータに対応する。
 * バリデーション: authorName は 1〜100 文字、content は 1〜2000 文字。
 */
export interface CreatePostInput {
  /** 投稿者名（1〜100 文字） */
  authorName: string;
  /** 投稿内容（1〜2000 文字） */
  content: string;
}

/**
 * 投稿一覧リクエストの入力パラメータ
 *
 * GET /board のクエリパラメータに対応する。
 * 未指定の場合はデフォルト値が適用される。
 */
export interface ListPostsInput {
  /** ページ番号（1 始まり、デフォルト: 1） */
  page?: number;
  /** 1 ページあたりの表示件数（デフォルト: 20、最大: 100） */
  limit?: number;
}

/**
 * 投稿一覧レスポンスの結果データ
 *
 * ページネーション情報を含む投稿一覧のレスポンス。
 */
export interface ListPostsResult {
  /** 投稿の配列 */
  posts: Post[];
  /** 全投稿数 */
  totalCount: number;
  /** 現在のページ番号 */
  page: number;
  /** 1 ページあたりの表示件数 */
  limit: number;
  /** 次のページが存在するかどうか */
  hasNextPage: boolean;
}

// ============================================================
// PHP-WASM ブリッジ通信
// ============================================================

/**
 * PHP-WASM に渡すリクエスト情報
 *
 * CloudFront Origin Request イベントから抽出した HTTP リクエスト情報を
 * PHP-WASM の仮想ファイルシステム経由で渡すためのインターフェース。
 */
export interface PhpRequest {
  /** HTTP メソッド（GET, POST） */
  method: string;
  /** リクエスト URI（例: /board, /board?page=2） */
  uri: string;
  /** クエリ文字列（例: page=2&sort=new） */
  queryString: string;
  /** POST ボディ（URL エンコード済み文字列） */
  body: string;
  /** HTTP ヘッダー */
  headers: Record<string, string>;
}

/**
 * PHP-WASM から返されるレスポンス
 *
 * PHP スクリプトの実行結果を仮想ファイルシステム経由で
 * Node.js 側に返すためのインターフェース。
 */
export interface PhpResponse {
  /** HTTP ステータスコード */
  statusCode: number;
  /** HTTP レスポンスヘッダー */
  headers: Record<string, string>;
  /** レスポンスボディ（HTML 等） */
  body: string;
}

// ============================================================
// データベース操作
// ============================================================

/**
 * PHP から要求されるデータベース操作
 *
 * PHP-WASM が仮想ファイルシステムの `/tmp/bridge/db_operation.json` に
 * 書き込む DB 操作要求のインターフェース。
 */
export interface DbOperation {
  /** 操作種別: query（SELECT）または execute（INSERT/UPDATE/DELETE） */
  action: 'query' | 'execute';
  /** SQL 文（パラメータバインド $1, $2 を使用） */
  sql: string;
  /** バインドパラメータの配列 */
  params: (string | number | null)[];
}

/**
 * データベース操作の結果
 *
 * Node.js が DB クエリを実行した結果を仮想ファイルシステムの
 * `/tmp/bridge/db_result.json` に書き込むためのインターフェース。
 */
export interface DbResult {
  /** クエリ結果の行データ */
  rows: Record<string, string | number | null>[];
  /** 結果の行数（SELECT の場合は取得行数、INSERT/UPDATE/DELETE の場合は影響行数） */
  rowCount: number;
  /** エラー発生時のエラーメッセージ */
  error?: string;
}

/**
 * Aurora DSQL データベースクライアントの接続設定
 *
 * IAM 認証による Aurora DSQL への接続に必要な設定情報。
 */
export interface DbClientConfig {
  /** Aurora DSQL クラスターのエンドポイント */
  endpoint: string;
  /** AWS リージョン */
  region: string;
  /** データベース名 */
  database: string;
}
