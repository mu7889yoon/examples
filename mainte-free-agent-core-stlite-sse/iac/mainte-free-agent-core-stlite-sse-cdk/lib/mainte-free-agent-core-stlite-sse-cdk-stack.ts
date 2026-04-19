import * as cdk from 'aws-cdk-lib/core';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as path from 'path';
import { IdentityPool, UserPoolAuthenticationProvider } from 'aws-cdk-lib/aws-cognito-identitypool';
import * as agentCore from '@aws-cdk/aws-bedrock-agentcore-alpha';
import { Construct } from 'constructs';

export class MainteFreeAgentCoreStliteSseCdkStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // 1. S3 バケット
    const siteBucket = new s3.Bucket(this, 'StliteSiteBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // 2. Cognito User Pool
    const userPool = new cognito.UserPool(this, 'UserPool', {
      selfSignUpEnabled: true,
      signInAliases: { email: true },
      autoVerify: { email: true },
      passwordPolicy: { minLength: 8, requireUppercase: true, requireDigits: true, requireSymbols: false },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    userPool.addDomain('HostedUiDomain', {
      cognitoDomain: { domainPrefix: `stlite-agentcore-${cdk.Aws.ACCOUNT_ID}` },
    });

    // 3. User Pool Client
    const userPoolClient = userPool.addClient('AppClient', {
      generateSecret: false,
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [cognito.OAuthScope.OPENID, cognito.OAuthScope.EMAIL],
        callbackUrls: ['https://localhost'],
        logoutUrls: ['https://localhost'],
      },
    });

    // 4. Identity Pool
    const identityPool = new IdentityPool(this, 'IdentityPool', {
      authenticationProviders: {
        userPools: [new UserPoolAuthenticationProvider({ userPool, userPoolClient })],
      },
    });
    identityPool.authenticatedRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: ['bedrock-agentcore:InvokeAgentRuntime'],
        resources: ['arn:aws:bedrock-agentcore:*:*:runtime/*'],
      }),
    );

    // 5. Lambda@Edge（cognito-at-edge）
    // EdgeFunction は自動的に us-east-1 にデプロイする。
    // config.json はデプロイ後に手動で設定する。
    const authEdgeFunction = new cloudfront.experimental.EdgeFunction(this, 'AuthEdgeFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../lambda/auth'), {
        bundling: {
          image: lambda.Runtime.NODEJS_20_X.bundlingImage,
          command: ['echo', 'Docker bundling not used'],
          local: {
            tryBundle(outputDir: string) {
              const fs = require('fs');
              const { execSync } = require('child_process');
              for (const file of ['package.json', 'index.js', 'config.json']) {
                const src = path.join(__dirname, '../lambda/auth', file);
                if (fs.existsSync(src)) fs.copyFileSync(src, `${outputDir}/${file}`);
              }
              execSync('npm install --omit=dev', { cwd: outputDir, stdio: 'inherit' });
              return true;
            },
          },
        },
      }),
      timeout: cdk.Duration.seconds(5),
      memorySize: 128,
    });

    // 6. CloudFront
    const distribution = new cloudfront.Distribution(this, 'Distribution', {
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(siteBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        edgeLambdas: [{
          functionVersion: authEdgeFunction.currentVersion,
          eventType: cloudfront.LambdaEdgeEventType.VIEWER_REQUEST,
        }],
      },
      defaultRootObject: 'index.html',
    });

    // CloudFront ドメイン確定後、User Pool Client の callbackUrls を上書き
    const cfnClient = userPoolClient.node.defaultChild as cognito.CfnUserPoolClient;
    cfnClient.addPropertyOverride('CallbackURLs', [
      `https://${distribution.distributionDomainName}`,
    ]);
    cfnClient.addPropertyOverride('LogoutURLs', [
      `https://${distribution.distributionDomainName}`,
    ]);

    // 7. S3 に stlite アプリをデプロイ（全ファイル — Python ファイルも fetch で読み込むため）
    new s3deploy.BucketDeployment(this, 'DeployStliteApp', {
      sources: [s3deploy.Source.asset(path.join(__dirname, '../../../src/stlite'), {
        exclude: ['__pycache__', '*.pyc'],
      })],
      destinationBucket: siteBucket,
      distribution,
      distributionPaths: ['/*'],
    });

    // 8. AgentCore Runtime
    const agentRuntime = new agentCore.Runtime(this, 'AgentCoreRuntime', {
      runtimeName: 'stliteNovaAgent',
      agentRuntimeArtifact: agentCore.AgentRuntimeArtifact.fromAsset(
        path.join(__dirname, '../../../src/agentcore'),
      ),
      environmentVariables: {
        BEDROCK_MODEL_ID: 'amazon.nova-lite-v1:0',
        AWS_REGION: this.region,
      },
    });

    agentRuntime.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
      resources: ['*'],
    }));

    // 9. Outputs
    new cdk.CfnOutput(this, 'UserPoolId', { value: userPool.userPoolId });
    new cdk.CfnOutput(this, 'UserPoolClientId', { value: userPoolClient.userPoolClientId });
    new cdk.CfnOutput(this, 'IdentityPoolId', { value: identityPool.identityPoolId });
    new cdk.CfnOutput(this, 'CloudFrontUrl', { value: `https://${distribution.distributionDomainName}` });
    new cdk.CfnOutput(this, 'Region', { value: this.region });
    new cdk.CfnOutput(this, 'AgentRuntimeArn', {
      value: (agentRuntime.node.defaultChild as cdk.CfnResource).getAtt('AgentRuntimeArn').toString(),
    });
  }
}
