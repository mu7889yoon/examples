import * as path from 'node:path';
import {
  CfnOutput,
  Duration,
  RemovalPolicy,
  Stack,
  StackProps,
  Tags
} from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecsPatterns from 'aws-cdk-lib/aws-ecs-patterns';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';

export interface ExistingTodoResources {
  readonly vpcId: string;
  readonly publicSubnets: readonly {
    readonly subnetId: string;
    readonly availabilityZone: string;
    readonly routeTableId: string;
  }[];
  readonly databaseClusterId: string;
  readonly databaseEndpoint: string;
  readonly databasePort: number;
  readonly databaseSecurityGroupId: string;
  readonly databaseSecretArn: string;
}

export interface TodoStackProps extends StackProps {
  readonly existingResources?: ExistingTodoResources;
}

export class TodoStack extends Stack {
  constructor(scope: Construct, id: string, props: TodoStackProps = {}) {
    const { existingResources, ...stackProps } = props;
    super(scope, id, stackProps);

    Tags.of(this).add('Project', 'spring-boot-todo');
    Tags.of(this).add('Environment', 'learning');

    const vpc = existingResources
      ? ec2.Vpc.fromVpcAttributes(this, 'Vpc', {
          vpcId: existingResources.vpcId,
          availabilityZones: existingResources.publicSubnets.map((subnet) => subnet.availabilityZone),
          publicSubnetIds: existingResources.publicSubnets.map((subnet) => subnet.subnetId),
          publicSubnetNames: ['Public'],
          publicSubnetRouteTableIds: existingResources.publicSubnets.map((subnet) => subnet.routeTableId)
        })
      : new ec2.Vpc(this, 'Vpc', {
          ipAddresses: ec2.IpAddresses.cidr('10.0.0.0/16'),
          maxAzs: 2,
          natGateways: 0,
          subnetConfiguration: [
            {
              name: 'Public',
              subnetType: ec2.SubnetType.PUBLIC,
              cidrMask: 24
            },
            {
              name: 'Database',
              subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
              cidrMask: 24
            }
          ]
        });

    let database: rds.IDatabaseCluster;
    let databaseSecret: secretsmanager.ISecret;
    let writerResource: rds.CfnDBInstance | undefined;

    if (existingResources) {
      const databaseSecurityGroup = ec2.SecurityGroup.fromSecurityGroupId(
        this,
        'ExistingDatabaseSecurityGroup',
        existingResources.databaseSecurityGroupId
      );
      databaseSecret = secretsmanager.Secret.fromSecretCompleteArn(
        this,
        'ExistingDatabaseSecret',
        existingResources.databaseSecretArn
      );
      database = rds.DatabaseCluster.fromDatabaseClusterAttributes(this, 'ExistingDatabase', {
        clusterIdentifier: existingResources.databaseClusterId,
        clusterEndpointAddress: existingResources.databaseEndpoint,
        port: existingResources.databasePort,
        securityGroups: [databaseSecurityGroup],
        secret: databaseSecret,
        engine: rds.DatabaseClusterEngine.auroraPostgres({
          version: rds.AuroraPostgresEngineVersion.VER_16_8
        })
      });
    } else {
      const createdDatabase = new rds.DatabaseCluster(this, 'Database', {
        engine: rds.DatabaseClusterEngine.auroraPostgres({
          version: rds.AuroraPostgresEngineVersion.VER_16_8
        }),
        writer: rds.ClusterInstance.serverlessV2('Writer', {
          autoMinorVersionUpgrade: true,
          publiclyAccessible: false
        }),
        credentials: rds.Credentials.fromGeneratedSecret('todo'),
        defaultDatabaseName: 'todo',
        serverlessV2MinCapacity: 0,
        serverlessV2MaxCapacity: 1,
        serverlessV2AutoPauseDuration: Duration.minutes(5),
        vpc,
        vpcSubnets: {
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED
        },
        backup: {
          retention: Duration.days(1)
        },
        storageEncrypted: true,
        deletionProtection: false,
        removalPolicy: RemovalPolicy.DESTROY
      });

      // cdkd's direct RDS provider does not currently apply these optional
      // CloudFormation properties. Omitting them lets Aurora use its defaults.
      const databaseResource = createdDatabase.node.defaultChild as rds.CfnDBCluster;
      databaseResource.addPropertyDeletionOverride('DBClusterParameterGroupName');
      databaseResource.addPropertyDeletionOverride('CopyTagsToSnapshot');

      const writer = createdDatabase.node.findChild('Writer');
      writerResource = writer.node.defaultChild as rds.CfnDBInstance;
      writerResource.addPropertyDeletionOverride('AutoMinorVersionUpgrade');
      writerResource.addPropertyDeletionOverride('PromotionTier');

      if (createdDatabase.secret === undefined) {
        throw new Error('Aurora credentials secret was not created');
      }
      database = createdDatabase;
      databaseSecret = createdDatabase.secret;
    }

    const cluster = new ecs.Cluster(this, 'Cluster', { vpc });

    const applicationLogs = new logs.LogGroup(this, 'ApplicationLogs', {
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: RemovalPolicy.DESTROY
    });

    const backendDirectory = path.resolve(__dirname, '../../app/backend');
    const service = new ecsPatterns.ApplicationLoadBalancedFargateService(this, 'ApiService', {
      cluster,
      publicLoadBalancer: true,
      listenerPort: 80,
      assignPublicIp: true,
      taskSubnets: {
        subnetType: ec2.SubnetType.PUBLIC
      },
      cpu: 256,
      memoryLimitMiB: 512,
      runtimePlatform: {
        operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
        cpuArchitecture: ecs.CpuArchitecture.ARM64
      },
      desiredCount: 1,
      minHealthyPercent: 100,
      circuitBreaker: {
        rollback: true
      },
      healthCheckGracePeriod: Duration.minutes(3),
      taskImageOptions: {
        image: ecs.ContainerImage.fromAsset(backendDirectory, {
          file: 'docker/Dockerfile'
        }),
        containerPort: 8080,
        logDriver: ecs.LogDrivers.awsLogs({
          streamPrefix: 'todo',
          logGroup: applicationLogs
        }),
        environment: {
          SPRING_DATASOURCE_URL: `jdbc:postgresql://${database.clusterEndpoint.hostname}:${database.clusterEndpoint.port}/todo`,
          JAVA_TOOL_OPTIONS: '-XX:MaxRAMPercentage=75.0'
        },
        secrets: {
          SPRING_DATASOURCE_USERNAME: ecs.Secret.fromSecretsManager(databaseSecret, 'username'),
          SPRING_DATASOURCE_PASSWORD: ecs.Secret.fromSecretsManager(databaseSecret, 'password')
        }
      }
    });

    // Wait for the Aurora writer before ECS starts Spring Boot and Flyway.
    // Attach this dependency to the ECS service resource only; adding it to
    // the whole FargateService construct also affects its security group and
    // creates a dependency cycle with the database ingress rule below.
    const ecsServiceResource = service.service.node.defaultChild as ecs.CfnService;
    if (writerResource) {
      ecsServiceResource.addResourceDependency(writerResource);
    }

    service.targetGroup.configureHealthCheck({
      path: '/actuator/health/liveness',
      healthyHttpCodes: '200',
      interval: Duration.seconds(30),
      timeout: Duration.seconds(5)
    });

    database.connections.allowFrom(
      service.service,
      ec2.Port.tcp(5432),
      'Allow PostgreSQL connections from the Todo service'
    );

    new CfnOutput(this, 'TodoUrl', {
      value: `http://${service.loadBalancer.loadBalancerDnsName}`,
      description: 'Spring Boot Todo application URL'
    });
  }
}
