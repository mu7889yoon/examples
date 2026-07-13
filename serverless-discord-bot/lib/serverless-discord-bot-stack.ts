import * as cdk from 'aws-cdk-lib';
import { CfnOutput, CfnResource, Stack, StackProps } from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as apigatewayv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as apigatewayv2Integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as assets from 'aws-cdk-lib/aws-s3-assets';
import { Construct } from 'constructs';
import { execSync } from 'child_process';
import * as path from 'path';

import {
  PROJECT_ROOT,
  INTERACTION_BOT_PATH,
  MICROVM_SOURCE_PATH,
  IMAGE_NAME,
  LOG_GROUP_NAME,
  BASE_IMAGE_VERSION,
  MINIMUM_MEMORY_IN_MIB,
  HOOK_PORT,
  BUNDLE_INCLUDES,
  loadDotEnv,
} from './consts.js';

class MicrovmArtifactBundle implements cdk.ILocalBundling {
  private readonly projectRoot: string;

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
  }

  public tryBundle(outputDir: string, _options: cdk.BundlingOptions): boolean {
    const outputZip = path.join(outputDir, 'microvm-artifact.zip');
    const files = BUNDLE_INCLUDES.join(' ');
    execSync(`zip -r -FS "${outputZip}" ${files}`, {
      cwd: this.projectRoot,
      stdio: 'inherit',
    });
    return true;
  }
}

export class ServerlessDiscordBotStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const dotenv = loadDotEnv();

    const baseImageArn =
      `arn:${this.partition}:lambda:${this.region}:aws:microvm-image:al2023-1`;
    const internetEgressConnector =
      `arn:${this.partition}:lambda:${this.region}:aws:network-connector:aws-network-connector:INTERNET_EGRESS`;

    const artifact = new assets.Asset(this, 'MicrovmArtifact', {
      path: MICROVM_SOURCE_PATH,
      bundling: {
        local: new MicrovmArtifactBundle(MICROVM_SOURCE_PATH),
        // Docker fallback（CI 等で zip がない環境向け）
        image: cdk.DockerImage.fromRegistry('alpine'),
        entrypoint: ['/bin/sh', '-c'],
        command: [
          `cd /asset-input && zip -r /asset-output/microvm-artifact.zip ${BUNDLE_INCLUDES.join(' ')}`,
        ],
        outputType: cdk.BundlingOutput.ARCHIVED,
      },
    });

    const artifactUri = `s3://${artifact.s3BucketName}/${artifact.s3ObjectKey}`;

    // --- Log Group ---
    const logGroup = new logs.CfnLogGroup(this, 'MicrovmLogGroup', {
      logGroupName: LOG_GROUP_NAME,
      retentionInDays: 14,
    });

    // --- Build Role ---
    const buildRole = new iam.CfnRole(this, 'MicrovmBuildRole', {
      roleName: `${IMAGE_NAME}-build`,
      assumeRolePolicyDocument: this.lambdaTrustPolicy(),
      description: 'Build role for the Discord echo bot Lambda MicroVM image',
      policies: [
        {
          policyName: 'microvm-image-build',
          policyDocument: {
            Version: '2012-10-17',
            Statement: [
              {
                Effect: 'Allow',
                Action: ['s3:GetObject'],
                Resource: `arn:${this.partition}:s3:::${artifact.s3BucketName}/${artifact.s3ObjectKey}`,
              },
              {
                Effect: 'Allow',
                Action: ['logs:CreateLogGroup', 'logs:CreateLogStream', 'logs:PutLogEvents'],
                Resource: `arn:${this.partition}:logs:${this.region}:${this.account}:*`,
              },
            ],
          },
        },
      ],
    });

    // --- Execution Role ---
    const executionRole = new iam.CfnRole(this, 'MicrovmExecutionRole', {
      roleName: `${IMAGE_NAME}-execution`,
      assumeRolePolicyDocument: this.lambdaTrustPolicy(),
      description: 'Execution role for the Discord echo bot Lambda MicroVM',
      policies: [
        {
          policyName: 'microvm-execution',
          policyDocument: {
            Version: '2012-10-17',
            Statement: [
              {
                Effect: 'Allow',
                Action: ['logs:CreateLogGroup', 'logs:CreateLogStream', 'logs:PutLogEvents'],
                Resource: `arn:${this.partition}:logs:${this.region}:${this.account}:*`,
              },
            ],
          },
        },
      ],
    });

    // --- MicroVM Image ---
    const microvmImage = new CfnResource(this, 'DiscordEchoMicrovmImage', {
      type: 'AWS::Lambda::MicrovmImage',
      properties: {
        Name: IMAGE_NAME,
        BaseImageArn: baseImageArn,
        BaseImageVersion: BASE_IMAGE_VERSION,
        BuildRoleArn: buildRole.attrArn,
        Description: 'Discord Gateway echo bot PoC',
        CodeArtifact: {
          Uri: artifactUri,
        },
        Logging: {
          CloudWatch: {
            LogGroup: LOG_GROUP_NAME,
          },
        },
        EgressNetworkConnectors: [internetEgressConnector],
        CpuConfigurations: [
          {
            Architecture: 'ARM_64',
          },
        ],
        Resources: [
          {
            MinimumMemoryInMiB: MINIMUM_MEMORY_IN_MIB,
          },
        ],
        AdditionalOsCapabilities: [],
        Hooks: {
          Port: HOOK_PORT,
          MicrovmImageHooks: {
            Ready: 'ENABLED',
            ReadyTimeoutInSeconds: 60,
            Validate: 'ENABLED',
            ValidateTimeoutInSeconds: 60,
          },
          MicrovmHooks: {
            Run: 'ENABLED',
            RunTimeoutInSeconds: 5,
            Resume: 'ENABLED',
            ResumeTimeoutInSeconds: 5,
            Suspend: 'ENABLED',
            SuspendTimeoutInSeconds: 5,
            Terminate: 'ENABLED',
            TerminateTimeoutInSeconds: 5,
          },
        },
        EnvironmentVariables: [
          {
            Key: 'DISCORD_BOT_TOKEN',
            Value: process.env.DISCORD_BOT_TOKEN ?? dotenv.DISCORD_BOT_TOKEN ?? '',
          },
        ],

      },
    });
    microvmImage.node.addDependency(logGroup);
    microvmImage.node.addDependency(buildRole);

    // --- Interactions Lambda (Discord webhook handler) ---
    const discordPublicKey = process.env.DISCORD_PUBLIC_KEY ?? dotenv.DISCORD_PUBLIC_KEY ?? '';
    const discordBotToken = process.env.DISCORD_BOT_TOKEN ?? dotenv.DISCORD_BOT_TOKEN ?? '';

    const interactionsLambda = new lambda.Function(this, 'InteractionsLambda', {
      runtime: lambda.Runtime.PYTHON_3_12,
      architecture: lambda.Architecture.ARM_64,
      handler: 'handler.lambda_handler',
      code: lambda.Code.fromAsset(INTERACTION_BOT_PATH, {
        bundling: {
          image: lambda.Runtime.PYTHON_3_12.bundlingImage,
          command: [
            'bash', '-c',
            'pip install -r requirements.txt -t /asset-output && cp -au . /asset-output',
          ],
        },
      }),
      timeout: cdk.Duration.seconds(10),
      environment: {
        DISCORD_PUBLIC_KEY: discordPublicKey,
        DISCORD_BOT_TOKEN: discordBotToken,
        STACK_NAME: this.stackName,
        MICROVM_IMAGE_ARN: microvmImage.getAtt('ImageArn').toString(),
        MICROVM_IMAGE_VERSION: microvmImage.getAtt('LatestActiveImageVersion').toString(),
        EXECUTION_ROLE_ARN: executionRole.attrArn,
        LOG_GROUP_NAME: LOG_GROUP_NAME,
      },
    });

    // --- IAM permissions for Interactions Lambda ---
    interactionsLambda.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        'lambda:RunMicrovm',
        'lambda:PassNetworkConnector',
      ],
      resources: ['*'],
    }));

    interactionsLambda.addToRolePolicy(new iam.PolicyStatement({
      actions: ['iam:PassRole'],
      resources: [executionRole.attrArn],
    }));

    // --- API Gateway HTTP API (L2) ---
    const httpApi = new apigatewayv2.HttpApi(this, 'InteractionsHttpApi', {
      apiName: `${this.stackName}-interactions`,
    });

    httpApi.addRoutes({
      path: '/',
      methods: [apigatewayv2.HttpMethod.POST],
      integration: new apigatewayv2Integrations.HttpLambdaIntegration(
        'InteractionsIntegration',
        interactionsLambda,
      ),
    });

    // --- Outputs ---
    // new CfnOutput(this, 'ArtifactUri', { value: artifactUri });
    // new CfnOutput(this, 'MicrovmImageArn', { value: microvmImage.getAtt('ImageArn').toString() });
    // new CfnOutput(this, 'MicrovmImageName', { value: IMAGE_NAME });
    // new CfnOutput(this, 'LatestActiveImageVersion', {
    //   value: microvmImage.getAtt('LatestActiveImageVersion').toString(),
    // });
    // new CfnOutput(this, 'ExecutionRoleArn', { value: executionRole.attrArn });
    // new CfnOutput(this, 'LogGroupName', { value: LOG_GROUP_NAME });
    new CfnOutput(this, 'InteractionsEndpointUrl', {
      value: httpApi.apiEndpoint,
      description: 'Discord Interactions Endpoint URL',
    });
    // new CfnOutput(this, 'InteractionsLambdaArn', {
    //   value: interactionsLambda.functionArn,
    // });
  }

  private lambdaTrustPolicy() {
    return {
      Version: '2012-10-17',
      Statement: [
        {
          Effect: 'Allow',
          Principal: {
            Service: 'lambda.amazonaws.com',
          },
          Action: ['sts:AssumeRole', 'sts:TagSession'],
          Condition: {
            StringEquals: {
              'aws:SourceAccount': this.account,
            },
          },
        },
      ],
    };
  }
}
