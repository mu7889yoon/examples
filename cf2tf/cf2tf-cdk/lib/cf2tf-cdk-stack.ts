import * as cdk from 'aws-cdk-lib/core';
import { Construct } from 'constructs';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambdaEventSources from 'aws-cdk-lib/aws-lambda-event-sources';
import * as path from 'path';

export class Cf2TfCdkStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // SQS Queue（デッドレターキュー付き）
    const dlq = new sqs.Queue(this, 'DeadLetterQueue', {
      retentionPeriod: cdk.Duration.days(14),
    });

    const queue = new sqs.Queue(this, 'RequestQueue', {
      visibilityTimeout: cdk.Duration.seconds(60),
      deadLetterQueue: {
        queue: dlq,
        maxReceiveCount: 3,
      },
    });

    // Lambda Function（SQS メッセージを処理）
    const processor = new lambdaNodejs.NodejsFunction(this, 'Processor', {
      entry: path.join(__dirname, '../lambda/processor.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      environment: {
        QUEUE_URL: queue.queueUrl,
      },
    });

    // SQS → Lambda のイベントソースマッピング
    processor.addEventSource(
      new lambdaEventSources.SqsEventSource(queue, {
        batchSize: 10,
        maxBatchingWindow: cdk.Duration.seconds(5),
      }),
    );

    // API Gateway（REST API）
    const api = new apigateway.RestApi(this, 'Api', {
      restApiName: 'SQS Integration API',
      description: 'API Gateway → SQS → Lambda',
    });

    // API Gateway が SQS にメッセージを送るための IAM ロール
    const integrationRole = new iam.Role(this, 'ApiGwSqsRole', {
      assumedBy: new iam.ServicePrincipal('apigateway.amazonaws.com'),
    });
    queue.grantSendMessages(integrationRole);

    // API Gateway → SQS の直接統合
    const sqsIntegration = new apigateway.AwsIntegration({
      service: 'sqs',
      path: `${cdk.Aws.ACCOUNT_ID}/${queue.queueName}`,
      integrationHttpMethod: 'POST',
      options: {
        credentialsRole: integrationRole,
        requestParameters: {
          'integration.request.header.Content-Type': "'application/x-www-form-urlencoded'",
        },
        requestTemplates: {
          'application/json': 'Action=SendMessage&MessageBody=$input.body',
        },
        integrationResponses: [
          {
            statusCode: '200',
            responseTemplates: {
              'application/json': '{"message": "Message sent to queue"}',
            },
          },
          {
            statusCode: '500',
            selectionPattern: '5\\d{2}',
            responseTemplates: {
              'application/json': '{"error": "Internal server error"}',
            },
          },
        ],
      },
    });

    // POST /messages エンドポイント
    const messages = api.root.addResource('messages');
    messages.addMethod('POST', sqsIntegration, {
      methodResponses: [
        { statusCode: '200' },
        { statusCode: '500' },
      ],
    });

    // Outputs
    new cdk.CfnOutput(this, 'ApiUrl', {
      value: api.url,
      description: 'API Gateway endpoint URL',
    });

    new cdk.CfnOutput(this, 'QueueUrl', {
      value: queue.queueUrl,
      description: 'SQS Queue URL',
    });

    new cdk.CfnOutput(this, 'QueueArn', {
      value: queue.queueArn,
      description: 'SQS Queue ARN',
    });
  }
}
