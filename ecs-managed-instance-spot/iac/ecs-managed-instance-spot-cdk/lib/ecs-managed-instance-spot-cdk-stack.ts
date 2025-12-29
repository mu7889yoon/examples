import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as path from 'path';

export class EcsManagedInstanceSpotCdkStack extends cdk.Stack {
  public readonly albDnsName: cdk.CfnOutput;
  public readonly cloudFrontDomainName: cdk.CfnOutput;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const vpc = new ec2.Vpc(this, 'VllmVpc', {
      maxAzs: 2,
      natGateways: 1,
      subnetConfiguration: [
        {
          name: 'Public',
          subnetType: ec2.SubnetType.PUBLIC,
          cidrMask: 24,
        },
        {
          name: 'Private',
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
          cidrMask: 24,
        },
      ],
    });

    const albSecurityGroup = new ec2.SecurityGroup(this, 'AlbSecurityGroup', {
      vpc,
      allowAllOutbound: true,
    });
    albSecurityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(80),
    );

    const ecsSecurityGroup = new ec2.SecurityGroup(this, 'EcsSecurityGroup', {
      vpc,
      allowAllOutbound: true,
    });
    ecsSecurityGroup.addIngressRule(
      albSecurityGroup,
      ec2.Port.tcp(8000),
    );

    // ECS Instance Role
    const instanceRole = new iam.Role(this, 'EcsInstanceRole', {
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonEC2ContainerServiceforEC2Role'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'),
      ],
    });

    // Instance Profile
    const instanceProfile = new iam.InstanceProfile(this, 'EcsInstanceProfile', {
      role: instanceRole,
    });

    // Task Execution Role
    const taskExecutionRole = new iam.Role(this, 'TaskExecutionRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy'),
      ],
    });

    // Task Role
    const taskRole = new iam.Role(this, 'TaskRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
    });

    // ECS Infrastructure Role for Managed Instances
    const infrastructureRole = new iam.Role(this, 'EcsInfrastructureRole', {
      assumedBy: new iam.ServicePrincipal('ecs.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonECSInfrastructureRolePolicyForManagedInstances'),
      ],
    });

    // Add PassRole permission for the instance role
    infrastructureRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['iam:PassRole'],
      resources: [instanceRole.roleArn],
    }));

    const cluster = new ecs.Cluster(this, 'VllmCluster', { vpc });

    const miCapacityProvider = new ecs.ManagedInstancesCapacityProvider(this, 'MiSpotCapacityProvider', {
      capacityProviderName: 'vllm-spot-cp',
      ec2InstanceProfile: instanceProfile,
      infrastructureRole,
      securityGroups: [ecsSecurityGroup],
      subnets: vpc.selectSubnets({ subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS }).subnets,
      instanceRequirements: {
        vCpuCountMin: 4,
        vCpuCountMax: 8,
        memoryMin: cdk.Size.gibibytes(16),
        memoryMax: cdk.Size.gibibytes(32),
        acceleratorTypes: [ec2.AcceleratorType.GPU],
        acceleratorManufacturers: [ec2.AcceleratorManufacturer.NVIDIA],
        acceleratorCountMin: 1,
        acceleratorCountMax: 2,
        excludedInstanceTypes: [
          'g4*',
        ]
      },      
    });

    const cfnCapacityProvider = miCapacityProvider.node.defaultChild as ecs.CfnCapacityProvider;
    cfnCapacityProvider.addPropertyOverride(
      'ManagedInstancesProvider.InstanceLaunchTemplate.CapacityOptionType',
      'SPOT'
    );
    cluster.addManagedInstancesCapacityProvider(miCapacityProvider);

    const taskDefinition = new ecs.TaskDefinition(this, 'VllmTaskDefinition', {
      compatibility: ecs.Compatibility.MANAGED_INSTANCES,
      cpu: '4096',
      memoryMiB: '16384',
      executionRole: taskExecutionRole,
      taskRole,
    });

    // CloudWatch Log Group
    const logGroup = new logs.LogGroup(this, 'VllmLogGroup', {
      retention: logs.RetentionDays.ONE_DAY,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // vLLM Container
    const container = taskDefinition.addContainer('vllm', {
      image: ecs.ContainerImage.fromRegistry('vllm/vllm-openai:latest'),
      gpuCount: 1,
      environment: {
        MODEL_NAME: 'Qwen/Qwen3-4B',
        PORT: '8000',
      },
      command: [
        '--model', 'Qwen/Qwen3-4B',
        '--port', '8000',
        '--host', '0.0.0.0',
      ],
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'vllm',
        logGroup,
      }),
      portMappings: [
        {
          containerPort: 8000,
          hostPort: 8000,
          protocol: ecs.Protocol.TCP,
        },
      ],
    });

    // ============================================================
    // Application Load Balancer
    // ============================================================
    const alb = new elbv2.ApplicationLoadBalancer(this, 'VllmAlb', {
      vpc,
      internetFacing: true,
      securityGroup: albSecurityGroup,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
    });

    const targetGroup = new elbv2.ApplicationTargetGroup(this, 'VllmTargetGroup', {
      vpc,
      port: 8000,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targetType: elbv2.TargetType.IP,
      healthCheck: {
        path: '/health',
        interval: cdk.Duration.seconds(60),
        timeout: cdk.Duration.seconds(10),
        healthyThresholdCount: 2,
        unhealthyThresholdCount: 5,
      },
      deregistrationDelay: cdk.Duration.minutes(1),
    });

    alb.addListener('HttpListener', {
      port: 80,
      defaultTargetGroups: [targetGroup],
    });

    const service = new ecs.FargateService(this, 'VllmService', {
      cluster,
      taskDefinition,
      desiredCount: 1,
      capacityProviderStrategies: [
        {
          capacityProvider: miCapacityProvider.capacityProviderName,
          weight: 1,
        },
      ],
    });

    service.attachToApplicationTargetGroup(targetGroup);

    const frontendBucket = new s3.Bucket(this, 'FrontendBucket', {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
    });

    const oac = new cloudfront.S3OriginAccessControl(this, 'FrontendOAC');

    const albOrigin = new origins.HttpOrigin(alb.loadBalancerDnsName, {
      protocolPolicy: cloudfront.OriginProtocolPolicy.HTTP_ONLY,
    });

    const distribution = new cloudfront.Distribution(this, 'FrontendDistribution', {
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(frontendBucket, {
          originAccessControl: oac,
        }),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
      },
      additionalBehaviors: {
        '/v1/*': {
          origin: albOrigin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER,
        },
      },
      defaultRootObject: 'index.html',
    });

    new s3deploy.BucketDeployment(this, 'DeployFrontend', {
      sources: [s3deploy.Source.asset(path.join(__dirname, '../../../src/frontend'))],
      destinationBucket: frontendBucket,
      distribution,
      distributionPaths: ['/*'],
    });

    this.albDnsName = new cdk.CfnOutput(this, 'AlbDnsName', {
      value: alb.loadBalancerDnsName,
      description: 'ALB DNS Name for vLLM API',
    });

    this.cloudFrontDomainName = new cdk.CfnOutput(this, 'CloudFrontDomainName', {
      value: distribution.distributionDomainName,
      description: 'CloudFront Domain Name for Frontend',
    });
  }
}
