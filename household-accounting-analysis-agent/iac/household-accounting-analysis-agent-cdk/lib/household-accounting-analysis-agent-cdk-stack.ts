import * as cdk from 'aws-cdk-lib/core';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as glue from 'aws-cdk-lib/aws-glue';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as agentCore from '@aws-cdk/aws-bedrock-agentcore-alpha';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import { Construct } from 'constructs';
import * as path from 'path';

// 定数定義
const AWS_REGION = 'ap-northeast-1';
const BEDROCK_MODEL_ID = 'apac.amazon.nova-pro-v1:0';

export class HouseholdAccountingAnalysisAgentCdkStack extends cdk.Stack {
  // S3バケットをパブリックプロパティとして公開（他のリソースから参照可能）
  public readonly sourceBucket: s3.Bucket;
  public readonly dataBucket: s3.Bucket;
  // Glue ETL Job用のIAMロール
  public readonly glueRole: iam.Role;
  // Glue ETL Job
  public readonly glueJob: glue.CfnJob;
  // Glueスクリプト格納用バケット
  public readonly glueScriptsBucket: s3.Bucket;
  // フロントエンド用S3バケット
  public readonly frontendBucket: s3.Bucket;
  // CloudFrontディストリビューション
  public readonly distribution: cloudfront.Distribution;
  // AgentCore Runtime
  public readonly agentCoreRuntime: agentCore.Runtime;
  // プロキシLambda
  public readonly proxyLambda: lambda.Function;
  // API Gateway
  public readonly apiGateway: apigateway.RestApi;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Source Bucket: CSVファイル格納用
    // Requirements: 4.1
    this.sourceBucket = new s3.Bucket(this, 'SourceBucket', {
      bucketName: `household-accounting-source-${this.account}-${this.region}`,
      encryption: s3.BucketEncryption.S3_MANAGED,
      versioned: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
    });


    // Data Bucket: Parquetファイル格納用（SSE-S3暗号化）
    // Requirements: 4.1, 6.1
    this.dataBucket = new s3.Bucket(this, 'DataBucket', {
      bucketName: `household-accounting-data-${this.account}-${this.region}`,
      encryption: s3.BucketEncryption.S3_MANAGED,
      versioned: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
    });

    // Glue ETL Job用のIAMロール
    // Requirements: 4.5, 6.4
    this.glueRole = new iam.Role(this, 'GlueETLRole', {
      roleName: 'HouseholdAccountingGlueETLRole',
      assumedBy: new iam.ServicePrincipal('glue.amazonaws.com'),
      description: 'IAM role for Glue ETL Job to process household accounting data',
    });

    // Glue サービスロールポリシーをアタッチ
    this.glueRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSGlueServiceRole')
    );

    // Source Bucket への読み取り権限
    this.sourceBucket.grantRead(this.glueRole);

    // Data Bucket への読み取り/書き込み権限
    this.dataBucket.grantReadWrite(this.glueRole);

    // CloudWatch Logs への書き込み権限（Glue Job のログ用）
    this.glueRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'logs:CreateLogGroup',
        'logs:CreateLogStream',
        'logs:PutLogEvents',
      ],
      resources: [
        `arn:aws:logs:${this.region}:${this.account}:log-group:/aws-glue/*`,
      ],
    }));

    // CloudFormation出力
    new cdk.CfnOutput(this, 'SourceBucketName', {
      value: this.sourceBucket.bucketName,
      description: 'Source bucket for CSV files',
    });

    new cdk.CfnOutput(this, 'DataBucketName', {
      value: this.dataBucket.bucketName,
      description: 'Data bucket for Parquet files',
    });

    new cdk.CfnOutput(this, 'GlueRoleArn', {
      value: this.glueRole.roleArn,
      description: 'IAM role ARN for Glue ETL Job',
    });

    // Glueスクリプト格納用バケット
    // Requirements: 4.2
    this.glueScriptsBucket = new s3.Bucket(this, 'GlueScriptsBucket', {
      bucketName: `household-accounting-glue-scripts-${this.account}-${this.region}`,
      encryption: s3.BucketEncryption.S3_MANAGED,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
    });

    // Glueスクリプトをバケットにアップロード
    new s3deploy.BucketDeployment(this, 'DeployGlueScripts', {
      sources: [s3deploy.Source.asset(path.join(__dirname, '../../../src/glue'))],
      destinationBucket: this.glueScriptsBucket,
      destinationKeyPrefix: 'scripts',
    });

    // CSVデータファイルをSource Bucketにアップロード
    new s3deploy.BucketDeployment(this, 'DeployCsvData', {
      sources: [s3deploy.Source.asset(path.join(__dirname, '../../../data'))],
      destinationBucket: this.sourceBucket,
    });

    // GlueロールにスクリプトバケットへのRead権限を付与
    this.glueScriptsBucket.grantRead(this.glueRole);

    // Glue ETL Job定義
    // Requirements: 4.2
    this.glueJob = new glue.CfnJob(this, 'CsvToParquetETLJob', {
      name: 'household-accounting-csv-to-parquet',
      role: this.glueRole.roleArn,
      command: {
        name: 'glueetl',
        pythonVersion: '3',
        scriptLocation: `s3://${this.glueScriptsBucket.bucketName}/scripts/etl_csv_to_parquet.py`,
      },
      defaultArguments: {
        '--job-language': 'python',
        '--enable-metrics': 'true',
        '--enable-continuous-cloudwatch-log': 'true',
        '--enable-spark-ui': 'true',
        '--spark-event-logs-path': `s3://${this.glueScriptsBucket.bucketName}/spark-logs/`,
        '--SOURCE_BUCKET': this.sourceBucket.bucketName,
        '--DATA_BUCKET': this.dataBucket.bucketName,
        '--TempDir': `s3://${this.glueScriptsBucket.bucketName}/temp/`,
      },
      glueVersion: '4.0',
      workerType: 'G.1X',
      numberOfWorkers: 2,
      timeout: 60, // 60分
      maxRetries: 0,
      description: 'ETL job to convert household accounting CSV files to Parquet format',
    });

    // CloudFormation出力
    new cdk.CfnOutput(this, 'GlueScriptsBucketName', {
      value: this.glueScriptsBucket.bucketName,
      description: 'Bucket for Glue ETL scripts',
    });

    new cdk.CfnOutput(this, 'GlueJobName', {
      value: this.glueJob.name || 'household-accounting-csv-to-parquet',
      description: 'Glue ETL Job name',
    });

    // ========================================
    // AgentCore Runtime
    // Requirements: 4.3, 4.5, 6.2
    // ========================================

    this.agentCoreRuntime = new agentCore.Runtime(this, 'HouseholdAccountingAgentCoreRuntime', {
      runtimeName: 'householdAccountingAgent',
      agentRuntimeArtifact: agentCore.AgentRuntimeArtifact.fromAsset(
        path.join(__dirname, '../../../src/agent')
      ),
      environmentVariables: {
        DATA_BUCKET: this.dataBucket.bucketName,
        BEDROCK_MODEL_ID: BEDROCK_MODEL_ID,
        AWS_REGION: AWS_REGION,
      },
    });

    // Bedrock呼び出し権限
    this.agentCoreRuntime.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'bedrock:InvokeModel',
        'bedrock:InvokeModelWithResponseStream',
      ],
      resources: ['*'],
    }));

    // Data Bucket への読み取り権限（DuckDBでParquetファイルを読み込むため）
    this.dataBucket.grantRead(this.agentCoreRuntime.role);

    // CloudFormation出力
    new cdk.CfnOutput(this, 'AgentCoreRuntimeName', {
      value: this.agentCoreRuntime.agentRuntimeName,
      description: 'AgentCore Runtime name',
    });

    new cdk.CfnOutput(this, 'AgentCoreRuntimeArn', {
      value: this.agentCoreRuntime.agentRuntimeArn,
      description: 'AgentCore Runtime ARN',
    });

    // ========================================
    // プロキシLambda（SSEストリーミング対応）
    // Requirements: 3.2, 3.4
    // ========================================

    this.proxyLambda = new lambda.Function(this, 'ProxyLambda', {
      runtime: lambda.Runtime.NODEJS_20_X,
      architecture: lambda.Architecture.ARM_64,
      code: lambda.Code.fromAsset(path.join(__dirname, '../../../src/lambda')),
      handler: 'index.handler',
      timeout: cdk.Duration.seconds(900),
      environment: {
        AGENT_CORE_RUNTIME: this.agentCoreRuntime.agentRuntimeArn,
      },
    });

    // AgentCore Runtime呼び出し権限
    this.proxyLambda.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['bedrock-agentcore:InvokeAgentRuntime'],
      resources: ['*'],
    }));

    // CloudFormation出力
    new cdk.CfnOutput(this, 'ProxyLambdaArn', {
      value: this.proxyLambda.functionArn,
      description: 'Proxy Lambda ARN',
    });

    // ========================================
    // API Gateway（SSEストリーミング対応）
    // Requirements: 3.2
    // ========================================

    this.apiGateway = new apigateway.RestApi(this, 'ApiGateway', {
      restApiName: 'HouseholdAccountingAgentApi',
      description: 'API Gateway for Household Accounting Agent',
    });

    // CORSプリフライト設定
    this.apiGateway.root.addCorsPreflight({
      allowOrigins: ['*'],
      allowMethods: ['OPTIONS', 'POST'],
      allowHeaders: apigateway.Cors.DEFAULT_HEADERS,
    });

    // /invocations エンドポイント
    const invocationsResource = this.apiGateway.root.addResource('invocations', {
      defaultCorsPreflightOptions: {
        allowOrigins: ['*'],
        allowMethods: ['OPTIONS', 'POST'],
        allowHeaders: apigateway.Cors.DEFAULT_HEADERS,
      },
    });

    // Lambda統合（SSEストリーミング対応）
    const proxyLambdaIntegration = new apigateway.LambdaIntegration(this.proxyLambda, {
      responseTransferMode: apigateway.ResponseTransferMode.STREAM
    });

    invocationsResource.addMethod('POST', proxyLambdaIntegration, {
      authorizationType: apigateway.AuthorizationType.NONE,
    });

    // CloudFormation出力
    new cdk.CfnOutput(this, 'ApiGatewayUrl', {
      value: this.apiGateway.url,
      description: 'API Gateway URL',
    });

    // ========================================
    // フロントエンド用S3バケットとCloudFront
    // Requirements: 4.4, 6.3
    // ========================================

    // フロントエンド用S3バケット（静的ホスティング）
    this.frontendBucket = new s3.Bucket(this, 'FrontendBucket', {
      bucketName: `household-accounting-frontend-${this.account}-${this.region}`,
      encryption: s3.BucketEncryption.S3_MANAGED,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
    });

    // API Gateway URL からホスト名とステージを抽出
    const apiGatewayDomainName = `${this.apiGateway.restApiId}.execute-api.${this.region}.amazonaws.com`;

    // CloudFrontディストリビューション（HTTPS強制）
    // S3オリジン（フロントエンド）とAPI Gatewayオリジン（バックエンド）
    this.distribution = new cloudfront.Distribution(this, 'FrontendDistribution', {
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(this.frontendBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
      },
      additionalBehaviors: {
        '/invocations': {
          origin: new origins.HttpOrigin(apiGatewayDomainName, {
            originPath: `/${this.apiGateway.deploymentStage.stageName}`,
            protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY,
          }),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
        },
      },
      defaultRootObject: 'index.html',
      errorResponses: [
        {
          httpStatus: 403,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: cdk.Duration.minutes(5),
        },
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: cdk.Duration.minutes(5),
        },
      ],
      priceClass: cloudfront.PriceClass.PRICE_CLASS_200,
      comment: 'Household Accounting Analysis Agent Frontend',
    });

    // フロントエンドファイルをS3にデプロイ
    new s3deploy.BucketDeployment(this, 'DeployFrontend', {
      sources: [s3deploy.Source.asset(path.join(__dirname, '../../../src/frontend'))],
      destinationBucket: this.frontendBucket,
      distribution: this.distribution,
      distributionPaths: ['/*'],
    });

    // CloudFormation出力
    new cdk.CfnOutput(this, 'FrontendBucketName', {
      value: this.frontendBucket.bucketName,
      description: 'Frontend S3 bucket name',
    });

    new cdk.CfnOutput(this, 'CloudFrontDistributionId', {
      value: this.distribution.distributionId,
      description: 'CloudFront distribution ID',
    });

    new cdk.CfnOutput(this, 'CloudFrontDomainName', {
      value: this.distribution.distributionDomainName,
      description: 'CloudFront distribution domain name (HTTPS)',
    });

    new cdk.CfnOutput(this, 'FrontendUrl', {
      value: `https://${this.distribution.distributionDomainName}`,
      description: 'Frontend URL (HTTPS)',
    });

    // ========================================
    // 環境変数設定用の出力
    // Requirements: 4.6
    // ========================================

    new cdk.CfnOutput(this, 'DataBucketForAgent', {
      value: this.dataBucket.bucketName,
      description: 'DATA_BUCKET environment variable for AgentCore',
      exportName: 'HouseholdAccountingDataBucket',
    });
  }
}
