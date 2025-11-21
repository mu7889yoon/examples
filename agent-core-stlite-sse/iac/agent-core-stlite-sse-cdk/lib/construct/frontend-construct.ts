import { Construct } from 'constructs'
import * as s3 from 'aws-cdk-lib/aws-s3'
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront'
import * as cloudfrontOrigins from 'aws-cdk-lib/aws-cloudfront-origins'
import * as cdk from 'aws-cdk-lib/core'
import * as apigateway from 'aws-cdk-lib/aws-apigateway'
import * as s3Deployment from 'aws-cdk-lib/aws-s3-deployment'
import { FRONTEND_ROOT } from '../agent-core-stlite-ses-const'

export interface FrontendConstructProps {
    apiGateway: apigateway.RestApi
}

export class FrontendConstruct extends Construct {
    constructor(scope: Construct, id: string, props: FrontendConstructProps) {
        super(scope, id)

        const s3Bucket = new s3.Bucket(this, 'FrontendBucket', {
            removalPolicy: cdk.RemovalPolicy.DESTROY,
        })
        new s3Deployment.BucketDeployment(this, 'FrontendDeployment', {
            sources: [s3Deployment.Source.asset(FRONTEND_ROOT)],
            destinationBucket: s3Bucket,
        })

        const frontendDistribution = new cloudfront.Distribution(this, 'FrontendDistribution', {
            defaultBehavior: {
                origin: cloudfrontOrigins.S3BucketOrigin.withOriginAccessControl(
                    s3Bucket,
                    {
                        originAccessLevels: [
                            cloudfront.AccessLevel.READ,
                            cloudfront.AccessLevel.LIST,
                        ],
                    },
                ),                
            },
            defaultRootObject: 'index.html',
        })

        new cdk.CfnOutput(this, 'FrontendDistributionDomainName', {
            value: frontendDistribution.domainName,
        })
    }
}