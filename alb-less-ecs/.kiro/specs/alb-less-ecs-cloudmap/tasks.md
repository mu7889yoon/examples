# Implementation Plan: ALB-Less ECS with Cloud Map

## Overview

API Gateway HTTP API + VPC Link + Cloud Mapを使用して、ALBなしでECS Fargateサービスを外部公開するCDKスタックを実装する。コスト最小化のため、NAT Gatewayは使用せずVPCエンドポイントでイメージプルを実現する。

## Tasks

- [x] 1. Dockerイメージの準備
  - [x] 1.1 docker/Dockerfileを作成（amazon/amazon-ecs-sampleをベースに）
    - `FROM amazon/amazon-ecs-sample` でイメージを作成
    - _Requirements: 3.3_

- [x] 2. VPCとネットワーク構成の実装
  - [x] 2.1 VPCをPrivate Isolated Subnetで作成
    - CIDR: 10.0.0.0/16、maxAzs: 1、natGateways: 0
    - _Requirements: 1.1, 1.2, 1.3_
  - [x] 2.2 VPCエンドポイントを追加
    - ECR API、ECR DKR、CloudWatch Logs（Interface）、S3（Gateway）
    - _Requirements: 1.4_
  - [ ]* 2.3 VPC構成のテストを作成
    - **Property 1: VPC Configuration Correctness**
    - **Validates: Requirements 1.1, 1.2, 1.3, 1.4**

- [x] 3. ECS Cluster構成の実装
  - [x] 3.1 ECS Clusterを作成
    - Container Insights有効化
    - _Requirements: 2.1, 2.2_
  - [ ]* 3.2 ECS Cluster構成のテストを作成
    - **Property 2: ECS Resource Configuration Correctness**
    - **Validates: Requirements 2.1, 2.2**

- [x] 4. DockerイメージとTask Definitionの実装
  - [x] 4.1 DockerImageAssetを作成
    - docker/ディレクトリからイメージをビルド
    - _Requirements: 3.1, 3.3_
  - [x] 4.2 Fargate Task Definitionを作成
    - CPU: 512、Memory: 1024、Port: 80
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_

- [x] 5. Cloud Map Service Discoveryの実装
  - [x] 5.1 Private DNS Namespaceを作成
    - 名前: ecs.local
    - _Requirements: 6.1_
  - [x] 5.2 Discovery Serviceを作成
    - SRV record type、TTL: 60秒、failureThreshold: 1
    - _Requirements: 6.2, 6.3, 6.4_
  - [ ]* 5.3 Cloud Map構成のテストを作成
    - **Property 3: Cloud Map Service Discovery Configuration Correctness**
    - **Validates: Requirements 5.3, 6.1, 6.2, 6.3, 6.4**

- [x] 6. Fargate Serviceの実装
  - [x] 6.1 Security Groupを作成
    - VPC LinkからのPort 80インバウンド許可
    - _Requirements: 5.4, 9.2, 9.3_
  - [x] 6.2 Fargate Serviceを作成しCloud Mapと関連付け
    - desiredCount: 1、Private Isolated Subnet
    - _Requirements: 5.1, 5.2, 5.3_

- [ ] 7. Checkpoint - ECS構成の確認
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. API Gateway HTTP APIの実装
  - [x] 8.1 VPC Link用Security Groupを作成
    - Fargateへのアウトバウンド許可
    - _Requirements: 8.2, 9.1_
  - [x] 8.2 VPC Linkを作成
    - Private Isolated Subnetに配置
    - _Requirements: 8.1_
  - [x] 8.3 HTTP APIを作成
    - Protocol: HTTP
    - _Requirements: 7.1_
  - [x] 8.4 IntegrationとRouteを作成
    - HTTP_PROXY、VPC_LINK、Discovery Service ARN
    - _Requirements: 7.4, 8.3, 8.4, 8.5_
  - [x] 8.5 Stageを作成
    - auto-deploy有効
    - _Requirements: 7.3_
  - [ ]* 8.6 API Gateway構成のテストを作成
    - **Property 4: API Gateway Integration Configuration Correctness**
    - **Validates: Requirements 7.1, 7.2, 7.3, 7.4, 8.1, 8.3, 8.4, 8.5**

- [x] 9. Stack Outputの追加
  - [x] 9.1 API EndpointをCfnOutputで出力
    - _Requirements: 7.1_

- [ ] 10. Final Checkpoint - 全テスト実行
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- 各タスクは要件への参照を含む
- Checkpointで段階的に検証
- テストはCDK assertionsを使用してCloudFormationテンプレートを検証
