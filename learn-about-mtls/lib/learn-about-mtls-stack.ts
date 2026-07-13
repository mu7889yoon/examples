import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as cdk from 'aws-cdk-lib/core';
import { Construct } from 'constructs';

export class LearnAboutMtlsStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const siteBucket = new s3.Bucket(this, 'SiteBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    const caBundleKey = 'certs/trust-store/ca-bundle.pem';

    siteBucket.addToResourcePolicy(new iam.PolicyStatement({
      actions: ['s3:GetObject'],
      conditions: {
        StringEquals: {
          'aws:SourceAccount': cdk.Stack.of(this).account,
        },
      },
      principals: [new iam.ServicePrincipal('cloudfront.amazonaws.com')],
      resources: [siteBucket.arnForObjects(caBundleKey)],
    }));

    const caBundleDeployment = new s3deploy.BucketDeployment(this, 'CaBundleDeployment', {
      sources: [s3deploy.Source.asset('certs/trust-store')],
      destinationBucket: siteBucket,
      destinationKeyPrefix: 'certs/trust-store',
      contentType: 'text/plain',
      prune: false,
      retainOnDelete: false,
    });

    const trustStore = new cloudfront.CfnTrustStore(this, 'ClientCertificateTrustStore', {
      name: `${cdk.Stack.of(this).stackName}-client-ca`,
      caCertificatesBundleSource: {
        caCertificatesBundleS3Location: {
          bucket: siteBucket.bucketName,
          key: caBundleKey,
          region: cdk.Stack.of(this).region,
        },
      },
    });
    trustStore.node.addDependency(caBundleDeployment);

    const distribution = new cloudfront.Distribution(this, 'Distribution', {
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(siteBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
      },
      defaultRootObject: 'index.html',
      httpVersion: cloudfront.HttpVersion.HTTP2,
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
    });

    const cfnDistribution = distribution.node.defaultChild as cloudfront.CfnDistribution;
    cfnDistribution.addPropertyOverride('DistributionConfig.ViewerMtlsConfig', {
      Mode: 'required',
      TrustStoreConfig: {
        TrustStoreId: trustStore.attrId,
        AdvertiseTrustStoreCaNames: true,
        IgnoreCertificateExpiry: false,
      },
    });
    cfnDistribution.node.addDependency(trustStore);

    new s3deploy.BucketDeployment(this, 'SiteDeployment', {
      sources: [s3deploy.Source.asset('site')],
      destinationBucket: siteBucket,
      distribution,
      distributionPaths: ['/*'],
      prune: false,
      retainOnDelete: false,
    });

    new cdk.CfnOutput(this, 'CloudFrontDomainName', {
      value: distribution.distributionDomainName,
    });

    new cdk.CfnOutput(this, 'DistributionId', {
      value: distribution.distributionId,
    });

    new cdk.CfnOutput(this, 'CurlWithClientCertificate', {
      value: `curl -vk --cert .mtls-client/client.crt --key .mtls-client/client.key https://${distribution.distributionDomainName}/`,
    });

    new cdk.CfnOutput(this, 'CurlWithoutClientCertificate', {
      value: `curl -vk https://${distribution.distributionDomainName}/`,
    });
  }
}
