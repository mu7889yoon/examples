# Implementation Plan: Realtime Counter

## Overview

HTMXとSSEを使用したリアルタイム同期カウンターの実装。TypeScriptでLambda関数を実装し、AWS CDKでインフラを管理する。

## Tasks

- [x] 1. プロジェクトセットアップ
  - ルートディレクトリにpackage.jsonを作成
  - TypeScript、ESLint、Vitestの設定
  - _Requirements: 7.1_

- [x] 2. Increment Lambda実装
  - [x] 2.1 Increment Lambda関数を実装
    - `src/lambda/increment/index.ts`を作成
    - DynamoDBのADD操作でカウント値をアトミックにインクリメント
    - 更新後のカウント値をJSONで返却
    - _Requirements: 1.1, 1.2, 6.3_
  - [ ]* 2.2 Property 1: Increment Persistence Round Tripのテスト
    - **Property 1: Increment Persistence Round Trip**
    - **Validates: Requirements 1.1, 1.2, 6.2**

- [-] 3. SSE Lambda実装
  - [x] 3.1 SSE Lambda関数を実装
    - `src/lambda/sse/index.ts`を作成
    - Lambda Response Streamingを使用
    - 接続時に現在のカウント値を送信
    - DynamoDBをポーリングして変更を検知・配信
    - _Requirements: 2.1, 2.2, 3.3, 4.2_
  - [ ]* 3.2 Property 2: SSE Event Format Validityのテスト
    - **Property 2: SSE Event Format Validity**
    - **Validates: Requirements 3.3, 4.2**

- [x] 4. フロントエンド実装
  - [x] 4.1 HTMLファイルを作成
    - `src/frontend/index.html`を作成
    - HTMXとSSE拡張機能を読み込み
    - カウンター表示とインクリメントボタンを実装
    - _Requirements: 3.1, 3.2, 5.1, 5.2, 5.3_

- [ ] 5. Checkpoint - Lambda関数の動作確認
  - 全てのテストが通ることを確認
  - 質問があればユーザーに確認

- [x] 6. CDKインフラ実装
  - [x] 6.1 CDKプロジェクトをセットアップ
    - `iac/htmx-sse-counter-cdk/`にCDKプロジェクトを作成
    - 必要な依存関係をインストール
    - _Requirements: 7.1_
  - [x] 6.2 CDKスタックを実装
    - DynamoDBテーブル（オンデマンドキャパシティ）
    - Lambda関数（Response Streaming有効）
    - API Gateway HTTP API
    - S3バケット（静的ファイル用）
    - CloudFrontディストリビューション
    - _Requirements: 7.2, 7.3, 7.4_

- [ ] 7. Checkpoint - 最終確認
  - 全てのテストが通ることを確認
  - 質問があればユーザーに確認

## Notes

- タスクに`*`マークがあるものはオプション（テスト関連）
- 各タスクは要件への参照を含む
- Property 3（並行処理のアトミック性）とProperty 4（初期化）は統合テストで検証
