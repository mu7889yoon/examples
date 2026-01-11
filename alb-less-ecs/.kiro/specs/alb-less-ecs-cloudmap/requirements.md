# Requirements Document

## Introduction

ALBを使用せずにECS Fargateサービスを外部公開するためのインフラストラクチャ構成。API Gateway HTTP APIとVPC Link、Cloud Map（Service Discovery）を使用して、コスト効率の良いサーバーレス統合を実現する。

## Glossary

- **VPC**: Virtual Private Cloud - AWSの仮想ネットワーク環境
- **ECS_Cluster**: Elastic Container Service Cluster - コンテナを実行するための論理グループ
- **Fargate_Service**: ECS上でサーバーレスに実行されるコンテナサービス
- **ECR_Repository**: Elastic Container Registry - コンテナイメージを保存するプライベートレジストリ
- **Cloud_Map**: AWSのサービスディスカバリサービス。動的に変化するリソースの接続先情報を管理
- **Private_Dns_Namespace**: Cloud Mapで作成されるVPC内部のDNS名前空間
- **Discovery_Service**: Cloud Map内でサービスの接続先情報を管理するリソース
- **API_Gateway_HTTP_API**: HTTP APIタイプのAPI Gateway（REST APIとは異なる）
- **VPC_Link**: API GatewayからVPC内のリソースにプライベート接続するためのリンク
- **VPC_Endpoint**: VPC内からAWSサービスにプライベート接続するためのエンドポイント
- **Security_Group**: VPC内のリソースへのトラフィックを制御するファイアウォール

## Requirements

### Requirement 1: VPCネットワーク構成

**User Story:** As an infrastructure engineer, I want to create a minimal VPC configuration, so that ECS tasks can run in private subnet with minimum cost while API Gateway can connect via VPC Link.

#### Acceptance Criteria

1. THE VPC SHALL be created with CIDR block 10.0.0.0/16
2. THE VPC SHALL have 1 private isolated subnet in a single availability zone
3. THE VPC SHALL NOT have NAT Gateway to minimize cost
4. THE VPC SHALL have VPC Endpoints for ECR API, ECR DKR, S3, and CloudWatch Logs to enable image pulls without NAT Gateway

### Requirement 2: ECS Cluster構成

**User Story:** As an infrastructure engineer, I want to create an ECS cluster with Fargate capacity, so that containers can run without managing EC2 instances.

#### Acceptance Criteria

1. THE ECS_Cluster SHALL be created with Fargate capacity provider
2. THE ECS_Cluster SHALL have Container Insights enabled for monitoring

### Requirement 3: ECRリポジトリとイメージ管理

**User Story:** As a developer, I want to store container images in ECR, so that Fargate can pull images from a private registry within AWS.

#### Acceptance Criteria

1. THE ECR_Repository SHALL be created for storing the application image
2. THE ECR_Repository SHALL have image scanning enabled on push
3. THE CDK SHALL deploy the amazon/amazon-ecs-sample image to ECR using DockerImageAsset
4. THE ECR_Repository SHALL retain images on stack deletion to prevent accidental data loss

### Requirement 4: Fargateタスク定義

**User Story:** As a developer, I want to define a Fargate task that runs the container from ECR, so that the sample application can be deployed.

#### Acceptance Criteria

1. THE Task_Definition SHALL use Fargate launch type compatibility
2. THE Task_Definition SHALL allocate 512 CPU units and 1024 MiB memory
3. THE Task_Definition SHALL include a container using the image from ECR_Repository
4. THE Container SHALL expose port 80 for HTTP traffic
5. THE Task_Definition SHALL have appropriate IAM execution role for pulling images from ECR

### Requirement 5: Fargateサービス構成

**User Story:** As an infrastructure engineer, I want to deploy a Fargate service in private subnet with minimal cost, so that the application runs securely without NAT Gateway expenses.

#### Acceptance Criteria

1. THE Fargate_Service SHALL run in private isolated subnet
2. THE Fargate_Service SHALL have desired count of 1 task
3. THE Fargate_Service SHALL be associated with Cloud_Map Discovery_Service
4. THE Fargate_Service SHALL have a Security_Group allowing inbound traffic on port 80 from VPC_Link Security_Group

### Requirement 6: Cloud Map Service Discovery構成

**User Story:** As an infrastructure engineer, I want to configure Cloud Map service discovery, so that API Gateway can dynamically discover healthy Fargate tasks.

#### Acceptance Criteria

1. THE Private_Dns_Namespace SHALL be created within the VPC
2. THE Discovery_Service SHALL use SRV DNS record type for port mapping
3. THE Discovery_Service SHALL have DNS TTL of 60 seconds
4. THE Discovery_Service SHALL be configured with custom health check with failure threshold of 1

### Requirement 7: API Gateway HTTP API構成

**User Story:** As an API consumer, I want to access the ECS service through API Gateway HTTP API, so that I can invoke the backend service via a public endpoint.

#### Acceptance Criteria

1. THE API_Gateway_HTTP_API SHALL be created with HTTP protocol type
2. THE API_Gateway_HTTP_API SHALL have CORS configuration allowing all origins and methods
3. THE API_Gateway_HTTP_API SHALL have a default stage with auto-deploy enabled
4. WHEN a request is received THEN THE API_Gateway_HTTP_API SHALL route it to the VPC_Link integration

### Requirement 8: VPC Link統合構成

**User Story:** As an infrastructure engineer, I want to configure VPC Link integration, so that API Gateway can privately connect to ECS services via Cloud Map.

#### Acceptance Criteria

1. THE VPC_Link SHALL be created in the private isolated subnet
2. THE VPC_Link SHALL have a Security_Group allowing outbound traffic to Fargate_Service
3. THE Integration SHALL use HTTP_PROXY type with VPC_LINK connection
4. THE Integration SHALL reference the Discovery_Service ARN as integration URI
5. THE Integration SHALL use ANY method for proxying all HTTP methods

### Requirement 9: セキュリティグループ構成

**User Story:** As a security engineer, I want to configure security groups with least privilege, so that only necessary traffic flows between components.

#### Acceptance Criteria

1. THE VPC_Link Security_Group SHALL allow outbound traffic to Fargate_Service on port 80
2. THE Fargate_Service Security_Group SHALL allow inbound traffic from VPC_Link Security_Group on port 80
3. THE Fargate_Service Security_Group SHALL allow outbound traffic to VPC Endpoints for image pulls
4. THE VPC_Endpoint Security_Group SHALL allow inbound HTTPS traffic from Fargate_Service Security_Group
