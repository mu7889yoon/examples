import * as cdk from 'aws-cdk-lib/core'
import * as ec2 from 'aws-cdk-lib/aws-ec2'
import * as ecs from 'aws-cdk-lib/aws-ecs'
import * as ecr_assets from 'aws-cdk-lib/aws-ecr-assets'
import * as servicediscovery from 'aws-cdk-lib/aws-servicediscovery'
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2'
import { HttpServiceDiscoveryIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations'
import * as path from 'path'
import { Construct } from 'constructs'

export class AlbLessEcsStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props)

    const vpc = new ec2.Vpc(this, 'Vpc', {
      maxAzs: 1,
      natGateways: 0,
      subnetConfiguration: [
        {
          name: 'Public',
          subnetType: ec2.SubnetType.PUBLIC,
        },
      ],
    })

    const cluster = new ecs.Cluster(this, 'Cluster', {
      vpc,
      enableFargateCapacityProviders: true,
    })

    const dockerImage = new ecr_assets.DockerImageAsset(this, 'EcsSampleImage', {
      directory: path.join(__dirname, '../docker'),
      platform: ecr_assets.Platform.LINUX_ARM64,
    })

    const taskDefinition = new ecs.FargateTaskDefinition(this, 'TaskDef', {
      cpu: 256,
      memoryLimitMiB: 512,
      runtimePlatform: {
        cpuArchitecture: ecs.CpuArchitecture.ARM64,
        operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
      },
    })

    taskDefinition.addContainer('Container', {
      image: ecs.ContainerImage.fromDockerImageAsset(dockerImage),
      portMappings: [{ containerPort: 80 }],
    })

    const namespace = new servicediscovery.PrivateDnsNamespace(this, 'Namespace', {
      vpc,
      name: 'ecs.local',
    })

    const discoveryService = namespace.createService('DiscoveryService', {
      dnsRecordType: servicediscovery.DnsRecordType.SRV,
      dnsTtl: cdk.Duration.seconds(10),
      customHealthCheck: {
        failureThreshold: 1,
      },
    })

    const vpcLinkSecurityGroup = new ec2.SecurityGroup(this, 'VpcLinkSg', { vpc })

    const fargateSecurityGroup = new ec2.SecurityGroup(this, 'FargateSg', { vpc })

    fargateSecurityGroup.addIngressRule(
      vpcLinkSecurityGroup,
      ec2.Port.tcp(80)
    )

    const fargateService = new ecs.FargateService(this, 'Service', {
      cluster,
      taskDefinition,
      desiredCount: 1,
      vpcSubnets: { 
        subnetType: ec2.SubnetType.PUBLIC,
      },
      securityGroups: [fargateSecurityGroup],
      assignPublicIp: true,
      capacityProviderStrategies: [
        {
          capacityProvider: 'FARGATE_SPOT',
          weight: 1,
        },
      ],
      circuitBreaker: { enable: true, rollback: true },
      minHealthyPercent: 0,
      maxHealthyPercent: 200,
    })

    fargateService.associateCloudMapService({
      service: discoveryService,
      containerPort: 80,
    });

    vpcLinkSecurityGroup.addEgressRule(
      fargateSecurityGroup,
      ec2.Port.tcp(80),
    )

    const vpcLink = new apigwv2.VpcLink(this, 'VpcLink', {
      vpc,
      subnets: { subnetType: ec2.SubnetType.PUBLIC },
      securityGroups: [vpcLinkSecurityGroup],
    })

    const httpApi = new apigwv2.HttpApi(this, 'HttpApi', {
      corsPreflight: {
        allowOrigins: ['*'],
        allowMethods: [apigwv2.CorsHttpMethod.ANY],
        allowHeaders: ['*'],
      },
      defaultIntegration: new HttpServiceDiscoveryIntegration('Integration', discoveryService, {
        vpcLink,
      }),
    })

    new cdk.CfnOutput(this, 'ApiEndpoint', {
      value: httpApi.apiEndpoint,
      description: 'API Gateway HTTP API endpoint URL',
    })
  }
}
