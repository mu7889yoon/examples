# Discord WebSocket Bot PoC メモ

## 調査メモの前提

- 2026-06-23 時点の調査メモ。
- 当初は AWS Knowledge MCP Server で調査する想定だったが、この作業環境の現在のツール一覧には AWS Knowledge MCP の検索ツールが露出していない。`tool_search` と MCP resource 一覧では検出できなかったため、現時点では AWS/Discord の公式ドキュメント、Tavily 検索結果、実装検証を元にメモしている。
- 事実として確認できたものと、今回の PoC からの推測・所感は分けて書く。
- ユーザーの見立てどおり、`AWS Lambda MicroVMs` は通常の Lambda Function とは別のリソースで、長時間実行・WebSockets・suspend/resume を扱える新しい実行モデルだった。通常 Lambda と同一視してはいけない。

## 方針

- 目的は「Lambda Function で Discord bot を動かすこと」ではなく、「AWS Lambda MicroVMs 上で Discord Gateway bot の常駐プロセスを動かすこと」。
- この PoC の本線は `src/microvm-runtime.mjs` + `src/discord-echo-bot.mjs` + `Dockerfile`。
- CDK L1 実装へ寄せたため、通常 Lambda Function / SAM 版の比較コードは削除した。
- MicroVM 版では、MicroVM の runtime lifecycle 内で Discord Gateway WebSocket に接続し、受け取った通常メッセージを同じチャンネルへオウム返しする。
- Lambda MicroVMs は最大 8 時間の runtime と suspend/resume を持つため、通常 Lambda Function より Discord Gateway bot の実験に向いている。

## 調査して分かった事実

### AWS Lambda / Firecracker

- Firecracker は AWS が開発した lightweight virtualization 技術で、microVM を作るための Virtual Machine Monitor。
- Firecracker は AWS Lambda と AWS Fargate を支える技術として紹介されている。
- Firecracker microVM は KVM を使い、従来の VM の隔離性とコンテナに近い起動速度・リソース効率を狙っている。
- AWS の Firecracker 紹介では、microVM は軽量で、短時間・一時的な workload に向いていると説明されている。
- Lambda の timeout は 1 秒単位で設定でき、最大値は 900 秒、つまり 15 分。
- これは通常の AWS Lambda function timeout の話。`lambda microVMs` という呼び方の新しい実行形態がある場合、その実行時間・課金・ライフサイクルは別途確認が必要。
- 通常 Lambda では「Lambda microVM 上で WebSocket 接続を張る」こと自体はできるが、1 invoke を常駐プロセスとして使い続ける設計は function timeout にぶつかる。
- 一方で Firecracker 自体は短命 workload だけに限定される技術ではない。Firecracker は AWS Lambda と AWS Fargate を支える技術であり、Fargate のような container workload では長時間プロセスも扱える。このため「microVM だから短命」という理解は不正確。

### AWS Lambda MicroVMs

- `AWS Lambda MicroVMs` は通常の Lambda Functions とは別の新しい resource / API surface。
- Launch blog では、Lambda Functions は event-driven / request-response workloads 向け、Lambda MicroVMs は end user/session ごとに isolated environment を渡して user-generated / AI-generated code を実行する用途向け、と説明されている。
- AWS 公式の What's New では、Lambda MicroVMs は isolated execution of user and AI-generated code 向けの new serverless compute primitive と説明されている。
- Lambda MicroVMs は VM-level isolation、near-instant launch and resume、state preservation を提供する。
- 各 session は dedicated MicroVM で実行される。Launch blog では、shared kernel / shared resources がないと説明されている。
- Lambda MicroVMs は Firecracker virtualization 上に構築されている。
- 通常 Lambda Function の 15 分 timeout と違い、Lambda MicroVMs は up to 8 hours of total runtime と説明されている。
- MicroVM は idle 時に suspend でき、memory と disk state を維持しながら cost を下げられる。traffic が戻ると resume できる。
- suspend/resume は lifecycle policy で自動化できるほか、`suspend-microvm` / `resume-microvm` API で直接操作できる。
- session が終わったら `terminate` して resource を解放する。
- application code と `Dockerfile` を zip archive にして S3 に置き、Lambda API で MicroVM Image を作成する。
- MicroVM Image 作成時、Lambda が `Dockerfile` を実行し、application を起動し、初期化済み環境の memory/disk state を Firecracker snapshot として取得する。
- 実行時は `run-microvm` で MicroVM Image から MicroVM を起動する。
- Launch blog の CLI 例では、image 作成に `aws lambda-microvms create-microvm-image`、実行に `aws lambda-microvms run-microvm` を使っている。
- Base image 例として `public.ecr.aws/lambda/microvms:al2023-minimal` が launch blog に載っている。
- MicroVM は dedicated HTTPS endpoint を持ち、load balancer や ingress infrastructure は不要と説明されている。
- ingress networking は configurable ports で HTTPS traffic、HTTP/2、gRPC、WebSockets をサポートする。
- egress networking は public internet access と VPC access を構成できる。
- What's New では、利用可能リージョンとして US East (N. Virginia), US East (Ohio), US West (Oregon), Asia Pacific (Tokyo), Europe (Ireland) が挙げられている。
- AWS CloudFormation、AWS CDK、AWS Lambda console、Agent Toolkit for AWS から始められると説明されている。
- 課金は、MicroVM running 中の baseline compute resources と、baseline を超えた追加 resource の active duration が関係する、と What's New に書かれている。詳細な単価は pricing page で確認が必要。
- 重要な補足: snapshot から起動するため、initialization 時に unique content 生成、network connection 確立、ephemeral data loading を行う application は service-provided hooks との統合が必要になる可能性がある、と launch blog に注意がある。

### Discord Gateway

- Discord Gateway は secure WebSocket connection で、guild/channel/message などのリアルタイムイベントを受け取るための仕組み。
- Discord 公式ドキュメントでは、REST 操作は Gateway ではなく HTTP API で行うのが基本と説明されている。
- Gateway 接続後、Discord から `HELLO` opcode 10 が届き、その payload に `heartbeat_interval` が含まれる。
- bot は heartbeat interval に従って `HEARTBEAT` opcode 1 を送り続ける必要がある。
- Discord は heartbeat に対して `HEARTBEAT_ACK` opcode 11 を返す。
- Dispatch event は opcode 0。payload の `t` で `READY` や `MESSAGE_CREATE` などのイベント種別を見る。
- `s` は sequence number。heartbeat と resume に使うため、最後に受け取った non-null の `s` を保持する必要がある。
- `IDENTIFY` opcode 2 で token、intents、properties を送ると、正常なら `READY` が返る。
- `READY` には `resume_gateway_url` と `session_id` が含まれ、切断後の resume に使う。
- Gateway の URL 例として `wss://gateway.discord.gg/?v=10&encoding=json` が公式ドキュメントに載っている。
- `GUILD_MESSAGES (1 << 9)` intent で guild message の `MESSAGE_CREATE` などを受け取れる。
- `MESSAGE_CONTENT (1 << 15)` は個別イベントではなく、message content 系フィールドが含まれるかどうかに影響する privileged intent。
- `MESSAGE_CONTENT` を有効にしていない場合、`content` などのフィールドが空になるケースがある。
- privileged intents は Developer Portal 側で有効化する必要がある。
- `IDENTIFY` には制限があり、公式ドキュメントでは websocket への `IDENTIFY` が 24 時間あたり 1000 回に制限されると説明されている。むやみに Lambda を短周期で再起動する設計は危ない。
- Gateway event payload は 4096 bytes を超えると close される可能性がある。今回の PoC は Gateway へ送る payload が `IDENTIFY` と `HEARTBEAT` だけなので影響は小さい。
- Gateway events の送信には 60 秒あたり 120 events per connection の制限がある。今回の PoC では heartbeat と identify だけなので通常は問題になりにくい。

### Discord Message REST API

- メッセージ送信は HTTP API の `POST /channels/{channel.id}/messages` を使う。
- guild channel へ送信するには `SEND_MESSAGES` permission が必要。
- reply として message を作成する場合、`READ_MESSAGE_HISTORY` permission も必要。
- Discord の create message docs では、user-generated string を message content に入れる場合は sanitizing と `allowed_mentions` の利用を検討するように書かれている。
- 通常メッセージで `allowed_mentions` を指定しない場合、user/role/everyone mention が parse される。
- `allowed_mentions: { "parse": [] }` を指定すると mention を抑制できる。

## 今回の設計判断

- Discord ライブラリは使わず、`ws` で Gateway protocol を最小実装した。
  - 理由: Lambda microVM と Discord Gateway の関係を PoC として見たいので、接続 lifecycle を隠しすぎないようにした。
  - 本番では `discord.js` などの実績あるライブラリを使った方が resume、rate limit、sharding、close code 対応を任せられる。
- Runtime は `nodejs20.x` にした。
  - 理由: Node.js 20 では `fetch` が標準で使えるため、Discord REST API 呼び出しに追加依存を入れなくてよい。
- Lambda timeout は最大の 900 秒にした。
  - 理由: WebSocket bot としての接続継続時間を PoC 上できるだけ長く見るため。
- `ReservedConcurrentExecutions: 1` を指定した。
  - 理由: 同じ bot token で Lambda が複数同時起動すると、Gateway session や Discord 側の制限と衝突する可能性があるため。
- Lambda の残り時間が 5 秒程度になったら close code 1000 で WebSocket を閉じる。
  - 理由: Lambda timeout で強制終了されるより、ログ上で終了理由を追いやすい。
  - 注意: Discord 公式ドキュメントでは close code 1000/1001 で閉じると session が invalidated され、bot が offline になると説明されている。resume を試す構成では別の閉じ方を検討する。
- Gateway URL は `GET /gateway` せず固定値 `wss://gateway.discord.gg/?v=10&encoding=json` にした。
  - 理由: 公式に例示されている URL で、PoC のコード量を減らせる。
  - 本番では `Get Gateway Bot` で URL、recommended shards、session start limit を取得してキャッシュする方がよい。
- Message reply は Gateway ではなく REST API を使う。
  - 理由: Discord 公式ドキュメントでも REST 操作は HTTP API を使うのが基本と説明されているため。
- オウム返しの内容は 1900 文字に切り詰めた。
  - 理由: Discord message content の上限や reply payload の余白を考え、PoC では安全側に寄せた。
- `allowed_mentions: { parse: [] }` を入れた。
  - 理由: 誰かが `@everyone` や role mention を投稿したとき、bot が再通知してしまうのを避けるため。
- Gateway 接続ロジックは `src/discord-echo-bot.mjs` に切り出した。
  - 理由: MicroVM runtime の lifecycle hook 処理と Discord Gateway 実装を分離するため。
- `src/microvm-runtime.mjs` は handler ではなく Node.js process として起動する。
  - 理由: Lambda MicroVMs は Dockerfile/CMD で application process を起動するモデルとして説明されているため。
- `Dockerfile` は MicroVM artifact の root に置く必要がある。AWS docs の package 例も `Dockerfile` という名前を前提にしている。
- `Dockerfile` は launch blog の例に合わせて `public.ecr.aws/lambda/microvms:al2023-minimal` を base image にした。
  - 注意: 実際の build は AWS 側で Dockerfile を実行して snapshot を取る。ローカル Docker build と完全に同じ扱いになるかは追加検証する。
- MicroVM 版では `MAX_RUNTIME_SECONDS` を任意環境変数にした。
  - 理由: 通常 Lambda の `context.getRemainingTimeInMillis()` がないため。検証時に 8 時間より短い安全な終了時間を設定できる。
- MicroVM Image build 時に Discord Gateway へ接続しないよう、`CMD` は HTTP lifecycle hook server を起動する。
  - `/ready` と `/validate` は build/snapshot 用に成功応答する。
  - `/run` で `DISCORD_BOT_TOKEN` を読んで Discord bot を開始する。
  - `/suspend` / `/terminate` では WebSocket を閉じる。
  - `/resume` では前回の設定で bot を再開する。

## MicroVM 版 PoC で実装している Gateway lifecycle

1. MicroVM Image build 時に `CMD ["node", "src/microvm-runtime.mjs"]` で lifecycle hook server が起動する。
2. build hook の `/ready` / `/validate` は Discord へ接続せず成功応答する。
3. `run-microvm` で MicroVM が起動すると、Lambda が `/aws/lambda-microvms/runtime/v1/run` を呼ぶ。
4. `/run` hook で `DISCORD_BOT_TOKEN` を環境変数または `runHookPayload` から読む。
5. `wss://gateway.discord.gg/?v=10&encoding=json` へ WebSocket 接続する。
6. `HELLO` を受け取る。
7. `heartbeat_interval` に従って heartbeat timer を開始する。
8. `IDENTIFY` を送る。
9. `READY` が来たらログに bot ユーザー名を出す。
10. `MESSAGE_CREATE` が来たら bot 投稿と空 content を除外する。
11. REST API で同じ channel に同じ content を reply する。
12. `MAX_RUNTIME_SECONDS` を指定している場合は、その時間が近づいたら WebSocket を close する。指定しない場合は process が生きている限り接続を維持する。

## Lambda MicroVMs 版 PoC の構成

- `Dockerfile`
  - `public.ecr.aws/lambda/microvms:al2023-minimal` を base image にする。
  - `dnf` で Node.js / npm を入れる。
  - `npm ci --omit=dev` で依存を入れる。
  - `EXPOSE 8080 9000` で application port と lifecycle hook server port を宣言する。
  - `CMD ["node", "src/microvm-runtime.mjs"]` で lifecycle hook server を起動する。
- `src/microvm-runtime.mjs`
  - `/ready` / `/validate` / `/run` / `/suspend` / `/resume` / `/terminate` と `/aws/lambda-microvms/runtime/v1/<hook>` の両方で MicroVM lifecycle hooks を実装する。
  - `/run` で `DISCORD_BOT_TOKEN` を環境変数または `runHookPayload` から読む。
  - `/run` まで Discord Gateway へ接続しない。
- `src/discord-echo-bot.mjs`
  - Discord Gateway の hello/heartbeat/identify/message dispatch/reply を実装する共通ロジック。

## Lambda MicroVMs 版の手順案

注意: まだ実際の AWS アカウントで実行検証していない。Tavily で見つけた launch blog / Developer Guide の断片から組み立てた手順案。

1. MicroVM 用 artifact を作る。

```bash
npm run package:microvm
```

2. S3 に artifact を置く。

```bash
aws s3 cp microvm-artifact.zip s3://<bucket>/serverless-discord-bot/microvm-artifact.zip
```

3. MicroVM Image を作成する。

```bash
aws lambda-microvms create-microvm-image \
  --code-artifact uri=s3://<bucket>/serverless-discord-bot/microvm-artifact.zip \
  --name discord-echo-bot \
  --base-image-arn arn:aws:lambda:ap-northeast-1:aws:microvm-image:al2023-1 \
  --build-role-arn arn:aws:iam::<account-id>:role/MicroVMBuildRole \
  --hooks '{
    "port": 9000,
    "microvmImageHooks": {
      "ready": "ENABLED",
      "readyTimeoutInSeconds": 60,
      "validate": "ENABLED",
      "validateTimeoutInSeconds": 60
    },
    "microvmHooks": {
      "run": "ENABLED",
      "runTimeoutInSeconds": 5,
      "resume": "ENABLED",
      "resumeTimeoutInSeconds": 5,
      "suspend": "ENABLED",
      "suspendTimeoutInSeconds": 5,
      "terminate": "ENABLED",
      "terminateTimeoutInSeconds": 5
    }
  }'
```

4. MicroVM を起動する。

```bash
aws lambda-microvms run-microvm \
  --image-identifier arn:aws:lambda:ap-northeast-1:<account-id>:microvm-image:discord-echo-bot \
  --egress-network-connectors "arn:aws:lambda:ap-northeast-1:aws:network-connector:aws-network-connector:INTERNET_EGRESS" \
  --execution-role-arn arn:aws:iam::<account-id>:role/MicroVMExecutionRole \
  --maximum-duration-in-seconds 28800 \
  --run-hook-payload '{"DISCORD_BOT_TOKEN":"YOUR_DISCORD_BOT_TOKEN"}' \
  --idle-policy '{"maxIdleDurationSeconds":900,"suspendedDurationSeconds":300,"autoResumeEnabled":true}'
```

5. 環境変数 / secret の渡し方を確認する。
   - 公式 docs では environment variables は MicroVM image build time の設定で、同じ image から起動する MicroVM 間で共有される。
   - MicroVM ごとに変える値は `runHookPayload` を使うのが自然。
   - この PoC は `DISCORD_BOT_TOKEN` 環境変数でも `runHookPayload` JSON でも読める。
   - Discord bot token は image build 時に埋め込まず、run 時の payload か Secrets Manager path を payload で渡す構成にするのが望ましい。

## Discord bot と Lambda MicroVMs の相性メモ

- Discord Gateway bot は outbound WebSocket を維持する workload。
- Lambda MicroVMs は egress public internet access を構成できるので、Discord Gateway への outbound WebSocket には合いそう。
- Lambda MicroVMs の ingress WebSockets support は、Discord Gateway 接続には直接は不要。これは client が MicroVM に WebSocket 接続する用途。
- Discord bot では idle suspend が悩みどころ。
  - MicroVM を suspend すると、Discord Gateway heartbeat が止まり、Discord 側から切断される可能性が高い。
  - Discord bot としては、idle policy を無効化または長めにする方が自然かもしれない。
  - 逆に Discord からのイベントが少ない bot でも heartbeat は定期的に発生するため、MicroVM 側が idle と判断するかどうかは要検証。
- 最大 8 時間 runtime は通常 Lambda Function の 15 分よりかなり長いが、24/7 常駐にはまだ再起動設計が必要。
- 8 時間ごとの再起動なら `IDENTIFY` は単純計算で 3 回/日程度。Discord の 1000 identifies/day 制限には十分余裕がある。
- 再起動時の取りこぼしを減らすには、Discord Gateway の `session_id` / `resume_gateway_url` / sequence を外部保存して `RESUME` を実装する必要がある。
- MicroVM snapshot 作成時に Discord Gateway へ接続してはいけない。
  - snapshot から複数 MicroVM を起動すると、同じ接続状態を複製するような危険な設計になる。
  - Gateway 接続は `/run` lifecycle hook 後に行うのがよい。

## Discord 側の準備

1. Discord Developer Portal で Application を作成する。
2. Bot を追加し、Token を発行する。
3. Bot 設定で `MESSAGE CONTENT INTENT` を有効化する。
4. OAuth2 URL Generator で `bot` scope を選び、最低限次の権限を付けてサーバーへ招待する。
   - `View Channels`
   - `Send Messages`
   - `Read Message History`

## ローカル準備

```bash
npm install
npm run check
```

MicroVM 版をローカルで直接動かす場合は、環境変数を指定して Node.js process として起動する。

```bash
DISCORD_BOT_TOKEN=YOUR_DISCORD_BOT_TOKEN \
MAX_RUNTIME_SECONDS=300 \
npm run start:microvm
```

別 terminal から `/run` hook 相当の request を送ると bot が開始する。

```bash
curl -X POST http://127.0.0.1:9000/aws/lambda-microvms/runtime/v1/run \
  -H 'Content-Type: application/json' \
  -d '{"runHookPayload":"{\"DISCORD_BOT_TOKEN\":\"YOUR_DISCORD_BOT_TOKEN\",\"MAX_RUNTIME_SECONDS\":300}"}'
```

MicroVM 用 artifact は次の script で作る。

```bash
npm run package:microvm
```

## 実装メモ

- `src/microvm-runtime.mjs` は MicroVM 上の常駐 Node.js process として起動する。
- `src/discord-echo-bot.mjs` は Discord Gateway v10 に直接 WebSocket 接続する共通ロジック。
- Gateway `HELLO` を受け取ったら heartbeat を開始し、`IDENTIFY` を送る。
- `MESSAGE_CREATE` イベントを受けたら、bot 自身や他 bot のメッセージを除外して返信する。
- 返信は Gateway ではなく Discord REST API `POST /channels/{channel.id}/messages` を使う。
- `allowed_mentions: { parse: [] }` を指定し、オウム返しで mention を再通知しないようにしている。
- MicroVM 版は `MAX_RUNTIME_SECONDS` を指定した場合だけ終了ガードを入れる。

## 制約と次の検証

- 通常 Lambda 関数として動かす場合、1 回の実行は最大 15 分なので、そのままでは常駐 bot にはならない。
- Lambda MicroVMs は up to 8 hours の runtime と WebSockets / egress networking を持つため、Discord bot PoC の本命はこちら。
- 通常 Lambda が終了すると Gateway から切断されるため、EventBridge Scheduler などで再起動しても接続断が発生する。
- 複数同時起動すると Discord 側で同一 bot セッションが競合する可能性があるため、予約同時実行数を 1 にするなどの制御が必要。
- Discord Gateway の close code、rate limit、resume 処理は PoC では最小限。継続検証では resume/session 管理を追加する。
- Token は CloudFormation parameter 直渡しではなく、Secrets Manager または SSM Parameter Store から参照する構成に変える。
- AWS Knowledge MCP Server で確認したい項目:
  - `run-microvm` で環境変数や Secrets Manager value を渡す方法。
  - CloudFormation / CDK で MicroVM Image と MicroVM 実行をどこまで管理できるか。
  - `idle-policy` を無効化できるか、または max 値はいくつか。
  - MicroVM の health check / automatic restart の扱い。
  - CloudWatch Logs の出力先と log group 命名。
  - MicroVM Image の versioning / update / rollback 手順。
  - 課金単位、起動/停止方法、同時実行制御、ヘルスチェック、再起動ポリシー。
  - VPC/NAT なしで Discord Gateway への outbound WebSocket が使えるか、または public egress 設定が必要か。
  - Secrets Manager / Parameter Store 連携の推奨方法。

## 気づいた点

- 通常の Lambda function は「イベントに反応して一定時間内に処理する」サービスなので、Discord Gateway のような「接続を張って待ち続ける」workload とは性格がずれる。
- Lambda MicroVMs は長時間接続に対応する新しい実行モデルなので、Discord bot はかなり相性のよい検証題材になる。
- WebSocket client として外向きに接続すること自体は普通にできるため、通常 Lambda Function でも「最大 15 分だけ bot がオンラインになる」設計は理屈上あり得る。ただし今回の本命ではないため、比較コードは削除した。
- 「Lambda MicroVMs で Discord bot」というタイトルは成立する。ブログでは、通常 Lambda / Firecracker microVM / 新しい Lambda MicroVMs の違いを混同しないように整理する必要がある。
- microVM という言葉から EC2 のような常駐 VM を想像するとミスリードになる場合がある。一方で、microVM 技術自体は長時間プロセスを否定するものではない。制約は Firecracker ではなく、その上に載る managed service の実行モデルで決まる。
- Lambda 側の hard limit より、Discord Gateway 側の session/identify/rate limit のほうが bot 設計に効いてくる。
- EventBridge Scheduler で通常 Lambda を 15 分ごとに起動し直す案は一見成立しそうだが、今回の目的からは外れる。MicroVM で runtime lifecycle を管理する方針に寄せる。
- `MESSAGE_CONTENT` privileged intent を使うため、Discord Developer Portal 側の bot 設定が抜けると「接続はできるが content が空でオウム返ししない」という見え方になりそう。
- mention のオウム返しは事故りやすい。PoC でも `allowed_mentions` を最初から潰しておくのは大事。
- Gateway resume を入れないと、Lambda 再起動のたびに取りこぼしがあり得る。ブログでは「動いた」と「運用できる」の差として説明できそう。
- 通常 Lambda の非同期実行は失敗時リトライや DLQ/宛先設定も絡む。WebSocket bot のプロセス管理として使うには、失敗時に多重起動しないような設計が必要。
- 予約同時実行数 1 は PoC では分かりやすいガード。ただし本番で他の Lambda と同じアカウントに置くなら account concurrency や throttling の見え方も整理したい。
- Lambda MicroVMs では「MicroVM 単位の lifecycle 管理」が主役になる。通常 Lambda の reserved concurrency と同じ発想だけでは足りない。

## ブログに使えそうな構成案

1. 「Lambda microVMs で Discord bot を動かしたくなった」
2. 「まず microVM とは何か」
3. 「Lambda は Firecracker 上で動くが、利用者が microVM を直接管理するわけではない」
4. 「Discord bot は Gateway WebSocket を維持する必要がある」
5. 「Lambda で WebSocket client は動く」
6. 「通常 Lambda は最大 15 分。Lambda MicroVMs は最大 8 時間」
7. 「PoC 実装: HELLO、heartbeat、IDENTIFY、MESSAGE_CREATE、REST reply」
8. 「MicroVMs 版: Dockerfile から snapshot、run-microvm で起動」
9. 「長時間 WebSocket ユースケースとして成立する条件」
10. 「通常 Lambda / Fargate / lambda microVMs の比較」

## 参考リンク

- AWS Lambda timeout: https://docs.aws.amazon.com/lambda/latest/dg/configuration-timeout.html
- AWS Lambda MicroVMs Developer Guide: https://docs.aws.amazon.com/lambda/latest/dg/lambda-microvms-guide.html
- AWS Lambda MicroVMs launch blog: https://aws.amazon.com/blogs/aws/run-isolated-sandboxes-with-full-lifecycle-control-aws-lambda-introduces-microvms
- AWS What's New - Lambda MicroVMs: https://aws.amazon.com/about-aws/whats-new/2026/06/aws-lambda-microvms
- AWS News Blog - Firecracker: https://aws.amazon.com/blogs/aws/firecracker-lightweight-virtualization-for-serverless-computing/
- Firecracker official site: https://firecracker-microvm.github.io/
- Discord Gateway docs: https://docs.discord.com/developers/events/gateway
- Discord Message resource docs: https://docs.discord.com/developers/resources/message

## CDK L1 実装メモ

ユーザー要望に合わせて、AWS CDK v2 の L1 相当で MicroVM Image を管理する構成を追加した。

公式 CloudFormation Template Reference:

- https://docs.aws.amazon.com/ja_jp/AWSCloudFormation/latest/TemplateReference/aws-resource-lambda-microvmimage.html

追加ファイル:

- `cdk.json`
- `tsconfig.json`
- `bin/serverless-discord-bot.ts`
- `lib/serverless-discord-bot-stack.ts`
- `scripts/prepare_cdk_microvm.py`
- `scripts/run_cdk_microvm.py`
- `requirements.txt`

CDK stack は以下を作る:

- `AWS::Logs::LogGroup`
- `AWS::IAM::Role` build role
- `AWS::IAM::Role` execution role
- `AWS::Lambda::MicrovmImage`

CDK v2.260.0 の `aws-cdk-lib` には、現時点で `aws_lambda.CfnMicrovmImage` のような生成済み L1 construct は見つからなかった。

一方、CloudFormation registry には以下の resource type が存在した:

- `AWS::Lambda::MicrovmImage`
- `AWS::Lambda::NetworkConnector`

そのため、MicroVM Image は CDK の汎用 `CfnResource` を使って `type: "AWS::Lambda::MicrovmImage"` として定義した。これは CDK の型付き L1 ではないが、CloudFormation L1 resource type を CDK から直接使う実装。

`AWS::Lambda::MicrovmImage` の schema から分かった必須プロパティ:

- `Name`
- `BaseImageArn`
- `BaseImageVersion`
- `BuildRoleArn`
- `Description`
- `CodeArtifact`
- `Logging`
- `EgressNetworkConnectors`
- `CpuConfigurations`
- `Resources`
- `AdditionalOsCapabilities`
- `Hooks`
- `EnvironmentVariables`

公式 Template Reference でも同じ必須プロパティが確認できた。`Tags` だけ optional。

戻り値:

- `Ref`: resource name
- `Fn::GetAtt ImageArn`
- `Fn::GetAtt LatestActiveImageVersion`
- `Fn::GetAtt LatestFailedImageVersion`
- `Fn::GetAtt State`
- `Fn::GetAtt CreatedAt`
- `Fn::GetAtt UpdatedAt`

更新挙動:

- `Name` は replacement。
- それ以外の主要プロパティは no interruption。
- MicroVM image build は非同期で、成功すると `CREATING` から `CREATED`、失敗すると `CREATE_FAILED` に遷移する。

`BaseImageVersion` は CloudFormation では必須。API 直叩きの `create_microvm_image` では省略できたが、CloudFormation では明示が必要だった。`list_managed_microvm_image_versions` で `al2023-1` の version が `0` であることを確認した。

`CodeArtifact` は S3 URI を参照するだけで、CDK L1 だけでは artifact zip のアップロードまでは行わない。そのため `scripts/prepare_cdk_microvm.py` で次を行う:

1. `npm run package:microvm`
2. S3 bucket 作成または存在確認
3. `microvm-artifact.zip` を S3 へアップロード
4. `cdk.context.json` に artifact bucket/key、base image、image name などを書き込む

artifact key は `microvm-artifact-<sha256 prefix>.zip` にしている。S3 の同じ key へ上書きすると CloudFormation の `CodeArtifact.Uri` が変わらず、`AWS::Lambda::MicrovmImage` の更新が検知されないため。

`discordBotMicrovm:artifactKey` は `cdk.json` には置かず、`scripts/prepare_cdk_microvm.py` が生成する `cdk.context.json` にだけ書く。`cdk.json` に固定値を置くと、hash 付き key が上書きされず `cdk deploy` が no changes になる。

CDK deploy 手順:

```bash
AWS_PROFILE=nakamura npm run cdk:prepare -- --profile nakamura --region ap-northeast-1
AWS_PROFILE=nakamura AWS_REGION=ap-northeast-1 npm run cdk:deploy
```

CDK 版の実行手順:

```bash
npm run microvm:venv
AWS_PROFILE=nakamura AWS_REGION=ap-northeast-1 npm run cdk:run
```

CDK 版の停止手順:

```bash
AWS_PROFILE=nakamura AWS_REGION=ap-northeast-1 npm run cdk:terminate
```

`DISCORD_BOT_TOKEN` は `.env` または環境変数から読む。CloudFormation parameter や CDK context には入れない。理由は、CloudFormation template / stack events / parameter 履歴に secret が残る可能性があるため。

CDK deploy 実績:

- Stack: `ServerlessDiscordBotMicrovmStack`
- Region: `ap-northeast-1`
- Account: `381491917100`
- Artifact: `s3://lambda-microvms-discord-bot-cdk-381491917100-ap-northeast-1/serverless-discord-bot/microvm-artifact.zip`
- MicroVM Image: `arn:aws:lambda:ap-northeast-1:381491917100:microvm-image:discord-echo-bot-cdk`
- Latest active image version: `1.0`
- Execution role: `arn:aws:iam::381491917100:role/discord-echo-bot-cdk-execution`
- Log group: `/aws/lambda-microvms/discord-echo-bot-cdk`

起動確認:

- 古い boto3 直デプロイ版 `microvm-44e0cfc0-65a0-3470-a800-d50a66036dc5` が `RUNNING` のまま残っていたため、二重応答を避ける目的で terminate した。
- CDK 版 image から `microvm-d6f55c05-729f-3650-a2d2-69e1dd247cba` を起動。
- state は `RUNNING`。
- CloudWatch Logs で以下を確認:
  - `Discord Gateway WebSocket opened`
  - `Logged in as lambda-microvm#0107`

CDK 版で分かったこと:

- `AWS::Lambda::MicrovmImage` は CloudFormation 管理できる。
- `RunMicrovm` 相当の「MicroVM 実行インスタンス」は今回確認した範囲では CloudFormation resource type としては見つからなかった。そのため、image は CDK/CloudFormation 管理、実行開始は boto3 script という分担にした。
- token を `runHookPayload` で渡す設計は CDK 管理と相性がよい。image build 時には secret を入れず、run 時だけ渡せる。
- CDK L1 だけにこだわると、artifact upload のような imperative な処理は別ステップに切り出す必要がある。`BucketDeployment` などの高レベル construct や custom resource を使えば CDK に寄せられるが、今回は L1 指定を優先して避けた。
- `AWS::Lambda::NetworkConnector` は VPC egress 用の resource type。今回の PoC は managed `INTERNET_EGRESS` connector ARN を使うだけで足りたため、stack では作っていない。
- CDK の default synthesizer は bootstrap 用 SSM parameter を差し込む。今回の stack は asset を使わないので `BootstraplessSynthesizer` にして bootstrap 不要にした。
- `package.json` が `type: module` のため、CDK app は `node --loader ts-node/esm` で起動する必要があった。
- CDK 版へ寄せたため、通常 Lambda Function / SAM 版の `src/index.mjs`、`template.yaml`、直接 API で image を作る `scripts/deploy_microvm.py`、単体常駐 runner の `src/microvm-bot.mjs` は削除した。

注意:

- この token は会話ログやローカル `.env` に残っているため、PoC 後は Discord Developer Portal で再生成する。
- `microvm-d6f55c05-729f-3650-a2d2-69e1dd247cba` は最大 8 時間で起動中。不要になったら terminate する。
