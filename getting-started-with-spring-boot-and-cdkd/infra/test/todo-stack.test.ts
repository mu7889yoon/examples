import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { ExistingTodoResources, TodoStack } from '../lib/todo-stack';

describe('TodoStack', () => {
  const app = new App();
  const stack = new TodoStack(app, 'TestTodoStack', {
    env: {
      account: '111111111111',
      region: 'ap-northeast-1'
    }
  });
  const template = Template.fromStack(stack);

  test('creates an internet-facing ALB and a public Fargate service', () => {
    template.hasResourceProperties('AWS::ElasticLoadBalancingV2::LoadBalancer', {
      Scheme: 'internet-facing',
      Type: 'application'
    });
    template.hasResourceProperties('AWS::ElasticLoadBalancingV2::Listener', {
      Port: 80,
      Protocol: 'HTTP'
    });
    template.hasResourceProperties('AWS::ECS::Service', {
      DesiredCount: 1,
      LaunchType: 'FARGATE',
      DeploymentConfiguration: Match.objectLike({
        DeploymentCircuitBreaker: {
          Enable: true,
          Rollback: true
        },
        MinimumHealthyPercent: 100
      }),
      NetworkConfiguration: {
        AwsvpcConfiguration: Match.objectLike({
          AssignPublicIp: 'ENABLED'
        })
      }
    });
  });

  test('does not create a NAT gateway', () => {
    template.resourceCountIs('AWS::EC2::NatGateway', 0);
    template.resourceCountIs('AWS::EC2::Subnet', 4);
  });

  test('runs the Spring Boot container with Aurora credentials', () => {
    template.hasResourceProperties('AWS::ECS::TaskDefinition', {
      Cpu: '256',
      Memory: '512',
      RuntimePlatform: {
        CpuArchitecture: 'ARM64',
        OperatingSystemFamily: 'LINUX'
      },
      ContainerDefinitions: Match.arrayWith([
        Match.objectLike({
          PortMappings: Match.arrayWith([
            Match.objectLike({
              ContainerPort: 8080
            })
          ]),
          Environment: Match.arrayWith([
            Match.objectLike({ Name: 'SPRING_DATASOURCE_URL' }),
            Match.objectLike({ Name: 'JAVA_TOOL_OPTIONS' })
          ]),
          Secrets: Match.arrayWith([
            Match.objectLike({ Name: 'SPRING_DATASOURCE_USERNAME' }),
            Match.objectLike({ Name: 'SPRING_DATASOURCE_PASSWORD' })
          ]),
          LogConfiguration: Match.objectLike({
            LogDriver: 'awslogs'
          })
        })
      ])
    });
    template.hasResourceProperties('AWS::Logs::LogGroup', {
      RetentionInDays: 7
    });
  });

  test('creates a private Aurora Serverless v2 database that can auto-pause', () => {
    template.hasResource('AWS::RDS::DBCluster', {
      DeletionPolicy: 'Delete',
      UpdateReplacePolicy: 'Delete',
      Properties: Match.objectLike({
        DatabaseName: 'todo',
        DeletionProtection: false,
        Engine: 'aurora-postgresql',
        EngineVersion: '16.8',
        ServerlessV2ScalingConfiguration: {
          MaxCapacity: 1,
          MinCapacity: 0,
          SecondsUntilAutoPause: 300
        },
        StorageEncrypted: true
      })
    });
    template.hasResourceProperties('AWS::RDS::DBInstance', {
      DBInstanceClass: 'db.serverless',
      Engine: 'aurora-postgresql',
      PubliclyAccessible: false
    });
    template.hasResourceProperties('AWS::EC2::SecurityGroupIngress', {
      FromPort: 5432,
      IpProtocol: 'tcp',
      SourceSecurityGroupId: Match.anyValue(),
      ToPort: 5432
    });

    const clusters = Object.values(template.findResources('AWS::RDS::DBCluster'));
    const instances = Object.values(template.findResources('AWS::RDS::DBInstance'));
    expect(clusters).toHaveLength(1);
    expect(instances).toHaveLength(1);
    expect(clusters[0]?.Properties).not.toHaveProperty('DBClusterParameterGroupName');
    expect(clusters[0]?.Properties).not.toHaveProperty('CopyTagsToSnapshot');
    expect(instances[0]?.Properties).not.toHaveProperty('AutoMinorVersionUpgrade');
    expect(instances[0]?.Properties).not.toHaveProperty('PromotionTier');
  });

  test('waits for the Aurora writer before starting the ECS service', () => {
    const databaseInstanceId = Object.keys(template.findResources('AWS::RDS::DBInstance'))[0];
    const service = Object.values(template.findResources('AWS::ECS::Service'))[0];

    expect(databaseInstanceId).toBeDefined();
    expect(service?.DependsOn).toContain(databaseInstanceId);
  });

  test('uses the database-independent liveness endpoint', () => {
    template.hasResourceProperties('AWS::ElasticLoadBalancingV2::TargetGroup', {
      HealthCheckPath: '/actuator/health/liveness',
      HealthCheckIntervalSeconds: 30,
      HealthCheckTimeoutSeconds: 5,
      Matcher: {
        HttpCode: '200'
      },
      Port: 80,
      Protocol: 'HTTP',
      TargetType: 'ip'
    });
  });
});

describe('TodoStack with existing AWS resources', () => {
  const existingResources: ExistingTodoResources = {
    vpcId: 'vpc-0123456789abcdef0',
    publicSubnets: [
      {
        subnetId: 'subnet-0123456789abcdef0',
        availabilityZone: 'ap-northeast-1a',
        routeTableId: 'rtb-0123456789abcdef0'
      },
      {
        subnetId: 'subnet-1123456789abcdef0',
        availabilityZone: 'ap-northeast-1c',
        routeTableId: 'rtb-1123456789abcdef0'
      }
    ],
    databaseClusterId: 'todo-database',
    databaseEndpoint: 'todo-database.example.ap-northeast-1.rds.amazonaws.com',
    databasePort: 5432,
    databaseSecurityGroupId: 'sg-0123456789abcdef0',
    databaseSecretArn: 'arn:aws:secretsmanager:ap-northeast-1:111111111111:secret:todo-secret'
  };

  const app = new App();
  const stack = new TodoStack(app, 'ExistingTodoStack', {
    env: {
      account: '111111111111',
      region: 'ap-northeast-1'
    },
    existingResources
  });
  const template = Template.fromStack(stack);

  test('reuses rather than recreates the VPC and Aurora resources', () => {
    template.resourceCountIs('AWS::EC2::VPC', 0);
    template.resourceCountIs('AWS::EC2::Subnet', 0);
    template.resourceCountIs('AWS::RDS::DBCluster', 0);
    template.resourceCountIs('AWS::RDS::DBInstance', 0);
    template.resourceCountIs('AWS::SecretsManager::Secret', 0);
  });

  test('points Spring Boot at the existing database and secret', () => {
    template.hasResourceProperties('AWS::ECS::TaskDefinition', {
      ContainerDefinitions: Match.arrayWith([
        Match.objectLike({
          Environment: Match.arrayWith([
            Match.objectLike({
              Name: 'SPRING_DATASOURCE_URL',
              Value: 'jdbc:postgresql://todo-database.example.ap-northeast-1.rds.amazonaws.com:5432/todo'
            })
          ]),
          Secrets: Match.arrayWith([
            Match.objectLike({ Name: 'SPRING_DATASOURCE_USERNAME' }),
            Match.objectLike({ Name: 'SPRING_DATASOURCE_PASSWORD' })
          ])
        })
      ])
    });
    template.resourceCountIs('AWS::ECS::Service', 1);
    template.hasResourceProperties('AWS::EC2::SecurityGroupIngress', {
      FromPort: 5432,
      IpProtocol: 'tcp',
      ToPort: 5432
    });
  });
});
