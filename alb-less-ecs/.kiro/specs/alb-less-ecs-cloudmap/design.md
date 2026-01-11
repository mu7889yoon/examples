# Design Document: ALB-Less ECS with Cloud Map

## Overview

本設計は、ALBを使用せずにECS FargateサービスをAPI Gateway HTTP API経由で外部公開するインフラストラクチャを定義する。Cloud Map（Service Discovery）とVPC Linkを使用してAPI GatewayからFargateタスクへのプライベート統合を実現し、コストを最小化する。

### アーキテクチャ図

```
┌─────────────────────────────────────────────────────────────────┐
│                           Internet                               │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                    API Gateway HTTP API                          │
│                    (Public Endpoint)                             │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                         VPC Link                                 │
│                    (Private Integration)                         │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Cloud Map (Route 53)                        │
│                   Private DNS Namespace                          │
│                    Discovery Service                             │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│  VPC (10.0.0.0/16)                                              │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  Private Isolated Subnet (10.0.0.0/24) - AZ-a             │  │
│  │  ┌─────────────────┐  ┌─────────────────────────────────┐ │  │
│  │  │  ECS Fargate    │  │  VPC Endpoints                  │ │  │
│  │  │  Service        │  │  - ECR API                      │ │  │
│  │  │  (Port 80)      │  │  - ECR DKR                      │ │  │
│  │  │                 │  │  - S3 (Gateway)                 │ │  │
│  │  │                 │  │  - CloudWatch Logs              │ │  │
│  │  └─────────────────┘  └─────────────────────────────────┘ │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

## Architecture

### コンポーネント構成

1. **VPC Layer**: ネットワーク基盤（Private Isolated Subnet、VPC Endpoints）
2. **Container Layer**: ECS Cluster、Fargate Service、ECR Repository
3. **Service Discovery Layer**: Cloud Map（Private DNS Namespace、Discovery Service）
4. **API Layer**: API Gateway HTTP API、VPC Link、Integration

### データフロー

1. クライアントがAPI Gateway HTTP APIのエンドポイントにリクエスト
2. API GatewayがVPC Link経由でVPC内に接続
3. Cloud Map（Discovery Service）がFargateタスクのIPアドレスとポートを解決
4. リクエストがFargateタスクに転送される
5. レスポンスが同じ経路で返却される

## Components and Interfaces

### VPC構成

```typescript
import * as ec2 from 'aws-cdk-lib/aws-ec2';

// VPC with single private isolated subnet (no NAT Gateway)
const vpc = new ec2.Vpc(this, 'Vpc', {
  ipAddresses: ec2.IpAddresses.cidr('10.0.0.0/16'),
  maxAzs: 1,
  natGateways: 0,
  subnetConfiguration: [
    {
      name: 'Private',
      subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
      cidrMask: 24,
    },
  ],
});
```

### VPC Endpoints

NAT Gatewayなしでプライベートサブネットからイメージをプルするために必要：

```typescript
// Interface Endpoints for ECR and CloudWatch Logs
vpc.addInterfaceEndpoint('EcrApiEndpoint', {
  service: ec2.InterfaceVpcEndpointAwsService.ECR,
});

vpc.addInterfaceEndpoint('EcrDkrEndpoint', {
  service: ec2.InterfaceVpcEndpointAwsService.ECR_DOCKER,
});

vpc.addInterfaceEndpoint('LogsEndpoint', {
  service: ec2.InterfaceVpcEndpointAwsService.CLOUDWATCH_LOGS,
});

// Gateway Endpoint for S3 (ECR uses S3 for image layers)
vpc.addGatewayEndpoint('S3Endpoint', {
  service: ec2.GatewayVpcEndpointAwsService.S3,
});
```

### Docker Image Asset

```typescript
import * as path from 'path';
import * as ecr_assets from 'aws-cdk-lib/aws-ecr-assets';

// Build and push amazon/amazon-ecs-sample to ECR
const dockerImage = new ecr_assets.DockerImageAsset(this, 'EcsSampleImage', {
  directory: path.join(__dirname, '../docker'),
});
```

### ECS Cluster

```typescript
import * as ecs from 'aws-cdk-lib/aws-ecs';

const cluster = new ecs.Cluster(this, 'Cluster', {
  vpc,
  containerInsights: true,
});
```

### Cloud Map Service Discovery

```typescript
import * as servicediscovery from 'aws-cdk-lib/aws-servicediscovery';

// Private DNS Namespace
const namespace = new servicediscovery.PrivateDnsNamespace(this, 'Namespace', {
  vpc,
  name: 'ecs.local',
});

// Discovery Service with SRV record type
const discoveryService = namespace.createService('DiscoveryService', {
  name: 'backend',
  dnsRecordType: servicediscovery.DnsRecordType.SRV,
  dnsTtl: cdk.Duration.seconds(60),
  customHealthCheck: {
    failureThreshold: 1,
  },
});
```

### Task Definition and Fargate Service

```typescript
// Task Definition
const taskDefinition = new ecs.FargateTaskDefinition(this, 'TaskDef', {
  cpu: 512,
  memoryLimitMiB: 1024,
});

taskDefinition.addContainer('Container', {
  image: ecs.ContainerImage.fromDockerImageAsset(dockerImage),
  portMappings: [{ containerPort: 80 }],
  logging: ecs.LogDrivers.awsLogs({ streamPrefix: 'ecs' }),
});

// Security Group for Fargate
const fargateSecurityGroup = new ec2.SecurityGroup(this, 'FargateSg', {
  vpc,
  description: 'Security group for Fargate tasks',
});

// Fargate Service with Cloud Map association
const fargateService = new ecs.FargateService(this, 'Service', {
  cluster,
  taskDefinition,
  desiredCount: 1,
  vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
  securityGroups: [fargateSecurityGroup],
});

// Associate with Cloud Map
fargateService.associateCloudMapService({
  service: discoveryService,
  containerPort: 80,
});
```

### API Gateway HTTP API with VPC Link

```typescript
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';

// Security Group for VPC Link
const vpcLinkSecurityGroup = new ec2.SecurityGroup(this, 'VpcLinkSg', {
  vpc,
  description: 'Security group for VPC Link',
});

// Allow VPC Link to Fargate on port 80
fargateSecurityGroup.addIngressRule(
  vpcLinkSecurityGroup,
  ec2.Port.tcp(80),
  'Allow from VPC Link'
);

// VPC Link
const vpcLink = new apigwv2.CfnVpcLink(this, 'VpcLink', {
  name: 'EcsVpcLink',
  subnetIds: vpc.selectSubnets({ subnetType: ec2.SubnetType.PRIVATE_ISOLATED }).subnetIds,
  securityGroupIds: [vpcLinkSecurityGroup.securityGroupId],
});

// HTTP API
const httpApi = new apigwv2.CfnApi(this, 'HttpApi', {
  name: 'EcsHttpApi',
  protocolType: 'HTTP',
});

// Integration with Cloud Map Discovery Service
const integration = new apigwv2.CfnIntegration(this, 'Integration', {
  apiId: httpApi.attrApiId,
  integrationType: 'HTTP_PROXY',
  integrationMethod: 'ANY',
  connectionType: 'VPC_LINK',
  connectionId: vpcLink.attrVpcLinkId,
  integrationUri: discoveryService.serviceArn,
  payloadFormatVersion: '1.0',
});

// Default Route
const route = new apigwv2.CfnRoute(this, 'Route', {
  apiId: httpApi.attrApiId,
  routeKey: '$default',
  target: `integrations/${integration.ref}`,
});

// Stage with auto-deploy
const stage = new apigwv2.CfnStage(this, 'Stage', {
  apiId: httpApi.attrApiId,
  stageName: '$default',
  autoDeploy: true,
});
```

### Stack Output

```typescript
new cdk.CfnOutput(this, 'ApiEndpoint', {
  value: httpApi.attrApiEndpoint,
  description: 'API Gateway HTTP API endpoint URL',
});
```

## Data Models

### CDK Stack Props

```typescript
interface AlbLessEcsStackProps extends cdk.StackProps {
  // No additional props required - all configuration is internal
}
```

### Output Values

```typescript
// Stack outputs
new cdk.CfnOutput(this, 'ApiEndpoint', {
  value: httpApi.attrApiEndpoint,
  description: 'API Gateway HTTP API endpoint URL',
});
```

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system-essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*



This infrastructure-as-code project primarily consists of configuration verification rather than algorithmic properties. All acceptance criteria are testable as specific examples using CDK assertions to verify the synthesized CloudFormation template.

### Property 1: VPC Configuration Correctness

*For any* synthesized CloudFormation template, the VPC resource SHALL have CIDR block 10.0.0.0/16, exactly one private isolated subnet, zero NAT Gateways, and the required VPC Endpoints (ECR API, ECR DKR, S3, CloudWatch Logs).

**Validates: Requirements 1.1, 1.2, 1.3, 1.4**

### Property 2: ECS Resource Configuration Correctness

*For any* synthesized CloudFormation template, the ECS Cluster SHALL have Container Insights enabled, the Task Definition SHALL have 512 CPU units and 1024 MiB memory with port 80 exposed, and the Fargate Service SHALL have desired count of 1 in private isolated subnet.

**Validates: Requirements 2.1, 2.2, 4.1, 4.2, 4.4, 5.1, 5.2**

### Property 3: Cloud Map Service Discovery Configuration Correctness

*For any* synthesized CloudFormation template, the Private DNS Namespace SHALL be associated with the VPC, the Discovery Service SHALL use SRV record type with 60 second TTL and failure threshold of 1, and the Fargate Service SHALL be associated with the Discovery Service.

**Validates: Requirements 5.3, 6.1, 6.2, 6.3, 6.4**

### Property 4: API Gateway Integration Configuration Correctness

*For any* synthesized CloudFormation template, the HTTP API SHALL have HTTP protocol type with CORS enabled, the VPC Link SHALL be in private subnet, the Integration SHALL use HTTP_PROXY type with VPC_LINK connection referencing the Discovery Service ARN.

**Validates: Requirements 7.1, 7.2, 7.3, 7.4, 8.1, 8.3, 8.4, 8.5**

### Property 5: Security Group Rules Correctness

*For any* synthesized CloudFormation template, the security group rules SHALL allow: VPC Link to Fargate on port 80, Fargate to VPC Endpoints on port 443, and VPC Endpoints from Fargate on port 443.

**Validates: Requirements 5.4, 8.2, 9.1, 9.2, 9.3, 9.4**

## Error Handling

### Deployment Errors

1. **Docker Build Failure**: DockerImageAssetがビルドに失敗した場合、CDKデプロイは中断される
2. **VPC Endpoint Creation Failure**: エンドポイント作成に失敗した場合、Fargateタスクはイメージをプルできない
3. **Cloud Map Registration Failure**: サービス登録に失敗した場合、API Gatewayはルーティングできない

### Runtime Errors

1. **Task Startup Failure**: タスクが起動しない場合、Cloud Mapに登録されずAPI Gatewayは502を返す
2. **Health Check Failure**: ヘルスチェックに失敗した場合、Cloud Mapから登録解除される

## Testing Strategy

### Unit Tests (CDK Assertions)

CDKのassertionsライブラリを使用して、合成されたCloudFormationテンプレートを検証する。

```typescript
import { Template } from 'aws-cdk-lib/assertions';

// Example test structure
const template = Template.fromStack(stack);

// Verify VPC configuration
template.hasResourceProperties('AWS::EC2::VPC', {
  CidrBlock: '10.0.0.0/16',
});

// Verify no NAT Gateway
template.resourceCountIs('AWS::EC2::NatGateway', 0);

// Verify VPC Endpoints exist
template.resourceCountIs('AWS::EC2::VPCEndpoint', 4);
```

### Test Coverage

1. **VPC Tests**: CIDR、サブネット構成、NAT Gateway不在、VPCエンドポイント存在
2. **ECS Tests**: クラスター設定、タスク定義、サービス構成
3. **Cloud Map Tests**: 名前空間、ディスカバリサービス、サービス関連付け
4. **API Gateway Tests**: HTTP API、VPC Link、統合、ルート
5. **Security Group Tests**: インバウンド/アウトバウンドルール

### Testing Framework

- **Framework**: Jest with aws-cdk-lib/assertions
- **Test Location**: test/alb-less-ecs.test.ts
- **Execution**: `npm test`
