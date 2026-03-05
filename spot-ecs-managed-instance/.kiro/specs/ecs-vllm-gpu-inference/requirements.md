# Requirements Document

## Introduction

ECS Managed Instance（EC2起動タイプ）を使用して、g4dnインスタンス上でvLLMを動作させるGPU推論環境を構築する。小規模なLLMモデルを使用した検証環境として、AWS CDKでインフラをコード化する。

## Glossary

- **ECS_Cluster**: Amazon ECS クラスター。コンテナ化されたアプリケーションを実行するための論理グループ
- **Capacity_Provider**: ECS クラスターのキャパシティを管理するコンポーネント。Auto Scaling Groupと連携
- **Task_Definition**: コンテナの実行設定を定義するテンプレート
- **vLLM_Service**: vLLMを実行するECSサービス
- **GPU_Instance**: NVIDIA GPUを搭載したEC2インスタンス（g4dn系）
- **CDK_Stack**: AWS CDKで定義されるインフラストラクチャスタック

## Requirements

### Requirement 1: ECSクラスターの構築

**User Story:** As a developer, I want to create an ECS cluster with EC2 capacity provider, so that I can run GPU-accelerated containers on managed instances.

#### Acceptance Criteria

1. THE CDK_Stack SHALL create an ECS cluster with container insights enabled
2. WHEN the cluster is created, THE CDK_Stack SHALL configure an Auto Scaling Group with g4dn.xlarge instances
3. THE Capacity_Provider SHALL be associated with the Auto Scaling Group for managed instance scaling
4. THE CDK_Stack SHALL use the ECS-optimized Amazon Linux 2 GPU AMI for EC2 instances

### Requirement 2: ネットワーク構成

**User Story:** As a developer, I want proper network configuration, so that the vLLM service can be accessed securely.

#### Acceptance Criteria

1. THE CDK_Stack SHALL create a VPC with public and private subnets
2. THE GPU_Instance SHALL be placed in private subnets for security
3. WHEN external access is needed, THE CDK_Stack SHALL configure an Application Load Balancer in public subnets
4. THE CDK_Stack SHALL configure security groups to allow only necessary traffic (port 8000 for vLLM API)

### Requirement 3: vLLMタスク定義

**User Story:** As a developer, I want to define a task that runs vLLM with GPU support, so that I can serve LLM inference requests.

#### Acceptance Criteria

1. THE Task_Definition SHALL specify EC2 launch type with GPU resource requirements
2. THE Task_Definition SHALL use the vLLM official Docker image or a compatible image
3. WHEN the task starts, THE vLLM_Service SHALL load a small model (e.g., TinyLlama or similar)
4. THE Task_Definition SHALL configure appropriate memory and CPU limits for g4dn.xlarge
5. THE Task_Definition SHALL expose port 8000 for the vLLM OpenAI-compatible API

### Requirement 4: ECSサービスの構成

**User Story:** As a developer, I want an ECS service that manages vLLM tasks, so that the inference endpoint remains available.

#### Acceptance Criteria

1. THE vLLM_Service SHALL run with desired count of 1 for verification purposes
2. WHEN the task fails, THE vLLM_Service SHALL automatically restart it
3. THE vLLM_Service SHALL be registered with the Application Load Balancer target group
4. THE vLLM_Service SHALL use the capacity provider strategy for instance placement

### Requirement 5: IAMとセキュリティ

**User Story:** As a developer, I want proper IAM roles and security configuration, so that the service runs with least privilege.

#### Acceptance Criteria

1. THE CDK_Stack SHALL create a task execution role with permissions to pull container images
2. THE CDK_Stack SHALL create a task role with minimal permissions required for vLLM operation
3. IF the model is stored in S3, THEN THE task role SHALL have read access to the S3 bucket
4. THE CDK_Stack SHALL configure VPC endpoints for ECR and S3 to avoid NAT Gateway costs

### Requirement 6: 検証とモニタリング

**User Story:** As a developer, I want to verify the deployment and monitor the service, so that I can confirm GPU inference is working.

#### Acceptance Criteria

1. THE CDK_Stack SHALL output the ALB DNS name for accessing the vLLM API
2. WHEN the service is running, THE vLLM_Service SHALL respond to health check requests on /health
3. THE CDK_Stack SHALL enable CloudWatch Container Insights for monitoring
4. THE CDK_Stack SHALL create CloudWatch alarms for GPU utilization and task health
