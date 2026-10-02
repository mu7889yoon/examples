# Spring Boot Todo hands-on

Spring Boot、Postman、React、AWS CDK、cdkdを段階的に学ぶためのTodoアプリです。

現在はSpring BootのREST APIまで実装しています。

## ローカル環境

- Java 26
- Spring Boot 4.1
- Maven Wrapper
- PostgreSQL 16
- Docker Compose

## 起動方法

リポジトリのルートで実行します。

```bash
docker compose -f app/compose.yml up
```

ヘルスチェック：

```text
GET http://localhost:8080/actuator/health
```

ブラウザ画面：

```text
http://localhost:8080/
```

画面はSpring Bootの静的リソースとして配信され、同じSpring BootのREST APIを呼び出します。

終了：

```bash
docker compose -f app/compose.yml down
```

PostgreSQLのデータも削除する場合だけ、`--volumes`を付けます。

## レイヤードアーキテクチャ

```text
Controller
    ↓
Service
    ↓
Repository
    ↓
PostgreSQL
```

| レイヤー | 主な責務 |
| --- | --- |
| `controller` | HTTPリクエスト、入力検証、レスポンス、エラー形式 |
| `service` | ユースケース、トランザクション |
| `repository` | Spring Data JPAによるデータアクセス |
| `entity` | Todoのデータと状態変更ルール |

依存オブジェクトはコンストラクタインジェクションで受け取ります。

## API

| 操作 | メソッド | パス |
| --- | --- | --- |
| 登録 | `POST` | `/api/todos` |
| 一覧 | `GET` | `/api/todos` |
| 状態で絞り込み | `GET` | `/api/todos?status=OPEN` |
| 1件取得 | `GET` | `/api/todos/{id}` |
| 内容変更 | `PUT` | `/api/todos/{id}` |
| 状態変更 | `PATCH` | `/api/todos/{id}/status` |
| 削除 | `DELETE` | `/api/todos/{id}` |

状態は`OPEN`または`COMPLETED`です。

### 登録

```http
POST http://localhost:8080/api/todos
Content-Type: application/json

{
  "title": "Spring Bootを学ぶ",
  "description": "Todo APIを作る",
  "dueDate": "2026-08-31"
}
```

### 内容変更

```http
PUT http://localhost:8080/api/todos/{id}
Content-Type: application/json

{
  "title": "Spring BootとPostmanを学ぶ",
  "description": "PostmanからAPIを確認する",
  "dueDate": "2026-09-01"
}
```

### 完了にする

```http
PATCH http://localhost:8080/api/todos/{id}/status
Content-Type: application/json

{
  "status": "COMPLETED"
}
```

## テスト

Composeを起動した状態で実行します。

```bash
docker compose -f app/compose.yml exec backend ./mvnw test
```

FlywayがDBスキーマを管理し、Hibernateは起動時にEntityとスキーマの整合性を検証します。
