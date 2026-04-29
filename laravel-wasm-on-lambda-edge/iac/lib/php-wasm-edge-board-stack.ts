import * as cdk from 'aws-cdk-lib';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import * as path from 'path';

export class PhpWasmEdgeBoardStack extends cdk.Stack {
  public readonly distribution: cloudfront.Distribution;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Aurora DSQL Cluster (L1 construct)
    const dsqlCluster = new cdk.CfnResource(this, 'DsqlCluster', {
      type: 'AWS::DSQL::Cluster',
      properties: {
        DeletionProtectionEnabled: false,
      },
    });

    // Output the DSQL endpoint
    new cdk.CfnOutput(this, 'DsqlEndpoint', {
      value: cdk.Fn.getAtt(dsqlCluster.logicalId, 'Endpoint').toString(),
      description: 'Aurora DSQL cluster endpoint',
    });

    // Dummy origin S3 bucket
    const originBucket = new s3.Bucket(this, 'OriginBucket', {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // Lambda@Edge function
    // IMPORTANT: Must use Code.fromAsset with pre-built dist directory
    // The dist directory contains handler.mjs + php/ files + node_modules for external deps
    const edgeFn = new cloudfront.experimental.EdgeFunction(this, 'EdgeHandler', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'handler.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../src/dist')),
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
    });

    // Grant DSQL access to Lambda
    edgeFn.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['dsql:DbConnectAdmin'],
      resources: ['*'],
    }));

    // CloudFront Distribution
    this.distribution = new cloudfront.Distribution(this, 'Distribution', {
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(originBucket),
        edgeLambdas: [
          {
            functionVersion: edgeFn.currentVersion,
            eventType: cloudfront.LambdaEdgeEventType.ORIGIN_REQUEST,
            includeBody: true,
          },
        ],
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
        cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
      },
    });

    // Outputs
    new cdk.CfnOutput(this, 'DistributionUrl', {
      value: `https://${this.distribution.distributionDomainName}`,
      description: 'CloudFront distribution URL',
    });
  }
}
