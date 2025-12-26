import * as cdk from 'aws-cdk-lib/core'
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb'
import * as lambda from 'aws-cdk-lib/aws-lambda'
import * as s3 from 'aws-cdk-lib/aws-s3'
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment'
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront'
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins'
import * as apigateway from 'aws-cdk-lib/aws-apigateway'
import { Construct } from 'constructs'
import {
  INCREMENT_LAMBDA_ROOT,
  STREAMING_LAMBDA_ROOT,
  FRONTEND_ROOT
} from './const'

export class HtmxSseCounterCdkStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props)

    const counterTable = new dynamodb.Table(this, 'CounterTable', {
      partitionKey: {
        name: 'pk',
        type: dynamodb.AttributeType.STRING
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    })


    const incrementLambda = new lambda.Function(this, 'IncrementLambda', {
      runtime: lambda.Runtime.NODEJS_24_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(INCREMENT_LAMBDA_ROOT),
      environment: {
        TABLE_NAME: counterTable.tableName,
      },
    })
    counterTable.grantReadWriteData(incrementLambda)

    const sseLambda = new lambda.Function(this, 'SseLambda', {
      runtime: lambda.Runtime.NODEJS_24_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(STREAMING_LAMBDA_ROOT),
      environment: {
        TABLE_NAME: counterTable.tableName,
      },
      timeout: cdk.Duration.seconds(29)
    })
    counterTable.grantReadData(sseLambda)

    const restApi = new apigateway.RestApi(this, 'CounterApi', {
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: ['GET', 'POST', 'OPTIONS'],
        allowHeaders: apigateway.Cors.DEFAULT_HEADERS,
      },
    })

    const apiResource = restApi.root.addResource('api')

    const incrementResource = apiResource.addResource('increment')
    const incrementIntegration = new apigateway.LambdaIntegration(incrementLambda)
    incrementResource.addMethod('POST', incrementIntegration, {
      authorizationType: apigateway.AuthorizationType.NONE,
    })

    const eventsResource = apiResource.addResource('events')
    const sseIntegration = new apigateway.LambdaIntegration(sseLambda, {
      responseTransferMode: apigateway.ResponseTransferMode.STREAM,
    })
    eventsResource.addMethod('GET', sseIntegration, {
      authorizationType: apigateway.AuthorizationType.NONE,
    })

    const websiteBucket = new s3.Bucket(this, 'WebsiteBucket', {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
    })

    // Deploy frontend files to S3
    new s3deploy.BucketDeployment(this, 'DeployWebsite', {
      sources: [s3deploy.Source.asset(FRONTEND_ROOT)],
      destinationBucket: websiteBucket,
    })

    // CloudFront Distribution - Requirement 7.3
    const distribution = new cloudfront.Distribution(this, 'Distribution', {
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(websiteBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
      },
      additionalBehaviors: {
        '/api/*': {
          origin: new origins.RestApiOrigin(restApi),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
        },
      },
      defaultRootObject: 'index.html',
    })

    new cdk.CfnOutput(this, 'CloudFrontUrl', {
      value: `https://${distribution.distributionDomainName}`,
      description: 'CloudFront Distribution URL',
    })
  }
}
