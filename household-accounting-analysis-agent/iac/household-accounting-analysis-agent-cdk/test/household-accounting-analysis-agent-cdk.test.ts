import * as cdk from 'aws-cdk-lib/core';
import { Template, Match } from 'aws-cdk-lib/assertions';
import * as HouseholdAccountingAnalysisAgentCdk from '../lib/household-accounting-analysis-agent-cdk-stack';

describe('HouseholdAccountingAnalysisAgentCdkStack', () => {
  let template: Template;

  beforeAll(() => {
    const app = new cdk.App();
    const stack = new HouseholdAccountingAnalysisAgentCdk.HouseholdAccountingAnalysisAgentCdkStack(app, 'MyTestStack');
    template = Template.fromStack(stack);
  });

  test('Source Bucket is created with correct configuration', () => {
    template.hasResourceProperties('AWS::S3::Bucket', {
      BucketEncryption: {
        ServerSideEncryptionConfiguration: [
          {
            ServerSideEncryptionByDefault: {
              SSEAlgorithm: 'AES256',
            },
          },
        ],
      },
      VersioningConfiguration: {
        Status: 'Enabled',
      },
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
    });
  });

  test('All S3 Buckets are created', () => {
    // 4つのS3バケットが作成されていることを確認（Source, Data, GlueScripts, Frontend）
    template.resourceCountIs('AWS::S3::Bucket', 4);
  });

  test('Glue ETL Role is created', () => {
    template.hasResourceProperties('AWS::IAM::Role', {
      RoleName: 'HouseholdAccountingGlueETLRole',
      AssumeRolePolicyDocument: {
        Statement: [
          {
            Action: 'sts:AssumeRole',
            Effect: 'Allow',
            Principal: {
              Service: 'glue.amazonaws.com',
            },
          },
        ],
      },
    });
  });

  test('Glue Role has AWSGlueServiceRole managed policy', () => {
    template.hasResourceProperties('AWS::IAM::Role', {
      ManagedPolicyArns: Match.arrayWith([
        Match.objectLike({
          'Fn::Join': Match.arrayWith([
            Match.arrayWith([
              Match.stringLikeRegexp('.*AWSGlueServiceRole.*'),
            ]),
          ]),
        }),
      ]),
    });
  });

  test('CloudFormation outputs are created', () => {
    template.hasOutput('SourceBucketName', {});
    template.hasOutput('DataBucketName', {});
    template.hasOutput('GlueRoleArn', {});
    template.hasOutput('GlueScriptsBucketName', {});
    template.hasOutput('GlueJobName', {});
    // 新しい出力
    template.hasOutput('FrontendBucketName', {});
    template.hasOutput('CloudFrontDistributionId', {});
    template.hasOutput('CloudFrontDomainName', {});
    template.hasOutput('FrontendUrl', {});
    template.hasOutput('AgentCoreRuntimeName', {});
    template.hasOutput('AgentCoreRuntimeArn', {});
    template.hasOutput('DataBucketForAgent', {});
    template.hasOutput('ProxyLambdaArn', {});
    template.hasOutput('ApiGatewayUrl', {});
  });

  test('Glue ETL Job is created with correct configuration', () => {
    template.hasResourceProperties('AWS::Glue::Job', {
      Name: 'household-accounting-csv-to-parquet',
      Command: {
        Name: 'glueetl',
        PythonVersion: '3',
      },
      GlueVersion: '4.0',
      WorkerType: 'G.1X',
      NumberOfWorkers: 2,
      Timeout: 60,
      MaxRetries: 0,
    });
  });

  test('Glue Scripts Bucket is created', () => {
    template.hasResourceProperties('AWS::S3::Bucket', {
      BucketEncryption: {
        ServerSideEncryptionConfiguration: [
          {
            ServerSideEncryptionByDefault: {
              SSEAlgorithm: 'AES256',
            },
          },
        ],
      },
    });
  });

  // ========================================
  // フロントエンド用S3バケットとCloudFrontのテスト
  // Requirements: 4.4, 6.3
  // ========================================

  test('CloudFront Distribution is created with HTTPS redirect', () => {
    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: {
        DefaultRootObject: 'index.html',
        PriceClass: 'PriceClass_200',
        Comment: 'Household Accounting Analysis Agent Frontend',
        DefaultCacheBehavior: {
          ViewerProtocolPolicy: 'redirect-to-https',
          AllowedMethods: ['GET', 'HEAD'],
        },
      },
    });
  });

  test('CloudFront has error responses configured', () => {
    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: {
        CustomErrorResponses: Match.arrayWith([
          Match.objectLike({
            ErrorCode: 403,
            ResponseCode: 200,
            ResponsePagePath: '/index.html',
          }),
          Match.objectLike({
            ErrorCode: 404,
            ResponseCode: 200,
            ResponsePagePath: '/index.html',
          }),
        ]),
      },
    });
  });

  // ========================================
  // AgentCore Runtimeのテスト
  // Requirements: 4.3, 4.5, 6.2
  // ========================================

  test('AgentCore Runtime is created', () => {
    template.hasResourceProperties('AWS::BedrockAgentCore::Runtime', {
      AgentRuntimeName: 'householdAccountingAgent',
    });
  });

  test('AgentCore Runtime has Bedrock permissions', () => {
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
            Effect: 'Allow',
          }),
        ]),
      },
    });
  });

  // ========================================
  // プロキシLambdaのテスト
  // Requirements: 3.2, 3.4
  // ========================================

  test('Proxy Lambda is created', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      Runtime: 'nodejs20.x',
      Architectures: ['arm64'],
      Timeout: 900,
    });
  });

  // ========================================
  // API Gatewayのテスト
  // Requirements: 3.2
  // ========================================

  test('API Gateway is created', () => {
    template.hasResourceProperties('AWS::ApiGateway::RestApi', {
      Name: 'HouseholdAccountingAgentApi',
    });
  });

  // ========================================
  // CloudFrontのAPI Gatewayオリジンテスト
  // ========================================

  test('CloudFront has API Gateway origin for /invocations', () => {
    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: {
        CacheBehaviors: Match.arrayWith([
          Match.objectLike({
            PathPattern: '/invocations',
            ViewerProtocolPolicy: 'redirect-to-https',
          }),
        ]),
      },
    });
  });
});
