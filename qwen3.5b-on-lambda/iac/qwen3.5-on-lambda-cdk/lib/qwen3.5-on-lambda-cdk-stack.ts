import * as cdk from 'aws-cdk-lib/core';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as codebuild from 'aws-cdk-lib/aws-codebuild';
import * as cr from 'aws-cdk-lib/custom-resources';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import path = require('path');

export class Qwen35OnLambdaCdkStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Parameters
    const modelKey = new cdk.CfnParameter(this, 'ModelKey', {
      type: 'String',
      default: 'Qwen3.5-4B-Q4_K_M.gguf',
      description: 'S3 key for the model file',
    });

    const modelUrl = new cdk.CfnParameter(this, 'ModelUrl', {
      type: 'String',
      default: 'https://huggingface.co/unsloth/Qwen3.5-4B-GGUF/resolve/main/Qwen3.5-4B-Q4_K_M.gguf?download=true',
      description: 'Download URL for the model file',
    });

    // S3 bucket for model storage
    const modelBucket = new s3.Bucket(this, 'ModelBucket', {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
    });

    // ----- CodeBuild: モデルダウンロード→S3アップロード -----
    const downloadProject = new codebuild.Project(this, 'ModelDownloadProject', {
      projectName: 'qwen35-model-download',
      environment: {
        buildImage: codebuild.LinuxBuildImage.STANDARD_7_0,
        computeType: codebuild.ComputeType.LARGE,
      },
      timeout: cdk.Duration.minutes(60),
      buildSpec: codebuild.BuildSpec.fromObject({
        version: '0.2',
        phases: {
          build: {
            commands: [
              'echo "Downloading model from $MODEL_URL"',
              'curl -L -o "$MODEL_KEY" "$MODEL_URL"',
              'ls -lh "$MODEL_KEY"',
              'echo "Uploading to s3://$BUCKET_NAME/$MODEL_KEY"',
              'aws s3 cp "$MODEL_KEY" "s3://$BUCKET_NAME/$MODEL_KEY"',
              'echo "Done"',
            ],
          },
        },
      }),
      environmentVariables: {
        BUCKET_NAME: { value: modelBucket.bucketName },
        MODEL_KEY: { value: modelKey.valueAsString },
        MODEL_URL: { value: modelUrl.valueAsString },
      },
    });

    modelBucket.grantWrite(downloadProject);

    // Custom Resource: デプロイ時にCodeBuildを起動してモデルをダウンロード
    const modelBuildParams = {
      service: 'CodeBuild',
      action: 'startBuild',
      parameters: {
        projectName: downloadProject.projectName,
      },
      physicalResourceId: cr.PhysicalResourceId.of(
        `model-download-${modelKey.valueAsString}`
      ),
    };

    const startModelDownload = new cr.AwsCustomResource(this, 'StartModelDownload', {
      onCreate: {
        ...modelBuildParams,
        outputPaths: ['build.id', 'build.buildStatus'],
      },
      onUpdate: {
        ...modelBuildParams,
        outputPaths: ['build.id', 'build.buildStatus'],
      },
      policy: cr.AwsCustomResourcePolicy.fromStatements([
        new iam.PolicyStatement({
          actions: ['codebuild:StartBuild'],
          resources: [downloadProject.projectArn],
        }),
      ]),
    });

    startModelDownload.node.addDependency(downloadProject);

    // ----- llama-cpp Lambda Layer (ローカルDockerビルド or コンテキスト指定ARN) -----
    const llamaCppLayerName = 'llama-cpp-python-qwen35';
    const llamaCppLayerArnFromContext = this.node.tryGetContext('llamaCppLayerArn');
    let llamaCppLayer: lambda.ILayerVersion;

    if (typeof llamaCppLayerArnFromContext === 'string' && llamaCppLayerArnFromContext.length > 0) {
      llamaCppLayer = lambda.LayerVersion.fromLayerVersionArn(
        this,
        'LlamaCppLayerImported',
        llamaCppLayerArnFromContext,
      );
    } else {
      const llamaCppLayerSourcePath = path.join(__dirname, '../../../src/layers/llama-cpp');
      const localLayerCode = lambda.Code.fromAsset(llamaCppLayerSourcePath, {
        bundling: {
          image: cdk.DockerImage.fromBuild(llamaCppLayerSourcePath, {
            platform: 'linux/amd64',
          }),
          command: [
            'bash',
            '-lc',
            [
              'mkdir -p /asset-output/python /asset-output/lib',
              'cp -r /opt/python/. /asset-output/python/',
              'cp -r /opt/lib/. /asset-output/lib/',
            ].join(' && '),
          ],
        },
      });

      llamaCppLayer = new lambda.LayerVersion(this, 'LlamaCppLayerLocal', {
        layerVersionName: llamaCppLayerName,
        description: 'llama-cpp-python layer for Qwen3.5 (local Docker build)',
        code: localLayerCode,
        compatibleRuntimes: [lambda.Runtime.PYTHON_3_12],
        compatibleArchitectures: [lambda.Architecture.X86_64],
      });
    }

    // Lambda Web Adapter Layer (public ARN)
    const webAdapterLayer = lambda.LayerVersion.fromLayerVersionArn(
      this,
      'WebAdapterLayer',
      `arn:aws:lambda:${this.region}:753240598075:layer:LambdaAdapterLayerX86:23`
    );

    // Lambda function
    const fn = new lambda.Function(this, 'QwenFunction', {
      runtime: lambda.Runtime.PYTHON_3_12,
      architecture: lambda.Architecture.X86_64,
      handler: 'run.sh',
      code: lambda.Code.fromAsset(
        path.join(__dirname, '../../../src/app')
      ),
      memorySize: 10240,
      timeout: cdk.Duration.seconds(900),
      tracing: lambda.Tracing.ACTIVE,
      snapStart: lambda.SnapStartConf.ON_PUBLISHED_VERSIONS,
      layers: [llamaCppLayer, webAdapterLayer],
      environment: {
        MODEL_BUCKET: modelBucket.bucketName,
        MODEL_KEY: modelKey.valueAsString,
        AWS_LAMBDA_EXEC_WRAPPER: '/opt/bootstrap',
        AWS_LWA_INVOKE_MODE: 'RESPONSE_STREAM',
        AWS_LWA_ASYNC_INIT: 'false',
        AWS_LWA_READINESS_CHECK_PATH: '/healthz',
        AWS_LAMBDA_LOG_LEVEL: 'debug',
        LD_LIBRARY_PATH: '/opt/lib',
      },
    });

    // Grant S3 read access
    modelBucket.grantRead(fn);

    const liveAlias = new lambda.Alias(this, 'QwenFunctionLiveAlias', {
      aliasName: 'live',
      version: fn.currentVersion,
    });

    // Function URL (IAM Auth + RESPONSE_STREAM) bound to versioned alias for SnapStart
    const fnUrl = liveAlias.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.AWS_IAM,
      invokeMode: lambda.InvokeMode.RESPONSE_STREAM,
    });

    // 同アカウントのIAMユーザー/ロールからのFunction URL呼び出しを許可
    liveAlias.addPermission('AllowAccountInvokeFunctionUrl', {
      principal: new iam.AccountPrincipal(this.account),
      action: 'lambda:InvokeFunctionUrl',
      functionUrlAuthType: lambda.FunctionUrlAuthType.AWS_IAM,
    });

    // Outputs
    new cdk.CfnOutput(this, 'FunctionUrl', { value: fnUrl.url, });

    new cdk.CfnOutput(this, 'ModelBucketName', { value: modelBucket.bucketName });
  }
}
