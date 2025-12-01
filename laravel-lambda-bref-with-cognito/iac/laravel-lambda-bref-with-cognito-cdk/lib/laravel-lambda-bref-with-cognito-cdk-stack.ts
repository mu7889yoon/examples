import * as cdk from 'aws-cdk-lib/core'
import { Construct } from 'constructs'
import * as ec2 from 'aws-cdk-lib/aws-ec2'
import * as efs from 'aws-cdk-lib/aws-efs'
import * as lambda from 'aws-cdk-lib/aws-lambda'
import * as apigatewayv2 from 'aws-cdk-lib/aws-apigatewayv2'
import * as apigatewayv2integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations'
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront'
import * as cloudfrontOrigins from 'aws-cdk-lib/aws-cloudfront-origins'
import * as bref from '@bref.sh/constructs'
import * as custom_resources from 'aws-cdk-lib/custom-resources'
import * as iam from 'aws-cdk-lib/aws-iam'
import * as cognito from 'aws-cdk-lib/aws-cognito'
import path from 'path'

export class LaravelLambdaBrefWithCognitoCdkStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props)

    const vpc = new ec2.Vpc(this, 'Vpc', {
      maxAzs: 1,
      natGateways: 0,
      restrictDefaultSecurityGroup: true,
      subnetConfiguration: [
        {
          name: 'LaravelBrefPrivateSubnet',
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
          cidrMask: 28,
        },
      ],
      ipAddresses: ec2.IpAddresses.cidr('10.0.0.16/28'),
    })

    const fileSystem = new efs.FileSystem(this, 'Efs', {
      vpc: vpc,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      performanceMode: efs.PerformanceMode.GENERAL_PURPOSE,
      throughputMode: efs.ThroughputMode.BURSTING,
      oneZone: true,
    })
    
    const accessPoint = fileSystem.addAccessPoint('EfsAccessPoint', {
      path: '/bref',
      createAcl: {
        ownerUid: '1001',
        ownerGid: '1001',
        permissions: '750',
      },
      posixUser: {
        uid: '1001',
        gid: '1001',
      },
    })

    const laravelServeFunction = new bref.PhpFpmFunction(this, 'LaravelServeFunction', {      
      handler: 'public/index.php',      
      code: bref.packagePhpCode(path.join(__dirname, '../../../src'), {
        exclude: ['tests/**', 'var/**', 'docker/**'],
      }),
      architecture: lambda.Architecture.ARM_64,      
      timeout: cdk.Duration.seconds(29),
      memorySize: 256,
      vpc: vpc,
      filesystem: lambda.FileSystem.fromEfsAccessPoint(
        accessPoint,
        '/mnt/efs',
      ),
      environment: {        
        APP_ENV: 'production',
        LOG_CHANNEL: 'stderr',
        DB_CONNECTION: 'sqlite',
        DB_DATABASE: '/mnt/efs/database.sqlite',
      },
      phpVersion: '8.4',
    })

    const artisanFunction = new bref.ConsoleFunction(this, 'ArtisanCommandFunction', {
      handler: 'artisan',
      code: bref.packagePhpCode(path.join(__dirname, '../../../src'), {
        exclude: ['tests/**', 'var/**', 'docker/**'],
      }),
      architecture: lambda.Architecture.ARM_64,
      timeout: cdk.Duration.seconds(28),
      memorySize: 256,
      vpc: vpc,
      filesystem: lambda.FileSystem.fromEfsAccessPoint(
        accessPoint,
        '/mnt/efs',
      ),
      environment: {
        APP_ENV: 'production',
        LOG_CHANNEL: 'stderr',
        DB_CONNECTION: 'sqlite',
        DB_DATABASE: '/mnt/efs/database.sqlite',
      },
      phpVersion: '8.4',
    })

    const apiGateway = new apigatewayv2.HttpApi(this, 'ApiGateway', {
      defaultIntegration: new apigatewayv2integrations.HttpLambdaIntegration(
        'LaravelServeIntegration',
        laravelServeFunction,
      ),      
    })

    new custom_resources.AwsCustomResource(this, 'ArtisanMigrateCustomResource', {
      onCreate: {
        service: 'lambda',
        action: 'invoke',
        parameters: {
          FunctionName: artisanFunction.functionName,
          CliBinaryFormat: 'raw-in-base64-out',
          Payload: JSON.stringify('migrate --force'),
        },
        physicalResourceId: custom_resources.PhysicalResourceId.of(artisanFunction.functionName),
      },
      onUpdate: {
        service: 'lambda',
        action: 'invoke',
        parameters: {
          FunctionName: artisanFunction.functionName,
          CliBinaryFormat: 'raw-in-base64-out',
          Payload: JSON.stringify('migrate --force'),
        },
        physicalResourceId: custom_resources.PhysicalResourceId.of(artisanFunction.functionName),
      },
      policy: custom_resources.AwsCustomResourcePolicy.fromStatements(
        [
          new iam.PolicyStatement({
            actions: ['lambda:InvokeFunction'],
            resources: [artisanFunction.functionArn],
          }),
        ],
      ),
    })

    const apiGatewayUrl = apiGateway.url!
    const apiGatewayHost = apiGatewayUrl.replace('https://', '').split('/')[0]

    const userPool = new cognito.UserPool(this, 'UserPool')
    userPool.addClient('UserPoolClient', {

    })

    const lambdaEdgeFunction = new cloudfront.experimental.EdgeFunction(this, 'LambdaEdgeFunction', {
      code: lambda.Code.fromAsset(path.join(__dirname, '../../../edge')),
      handler: 'index.handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      architecture: lambda.Architecture.ARM_64,
      timeout: cdk.Duration.seconds(29),
      memorySize: 256,
    })
    
    const distribution = new cloudfront.Distribution(this, 'CloudFrontDistribution', {
      defaultBehavior: {
        origin: new cloudfrontOrigins.HttpOrigin(
          apiGatewayHost,
          {
            protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY,
            // customHeaders: {
            //   'X-Forwarded-Host': apiGatewayHost,
            // },
          }
        ),
        allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
        originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
      },
    })
    laravelServeFunction.addEnvironment('APP_URL', `https://${distribution.distributionDomainName}`)
    artisanFunction.addEnvironment('APP_URL', `https://${distribution.distributionDomainName}`)

    new cdk.CfnOutput(this, 'LaravelLambdaBrefApiEndpointUrl', {
      value: apiGateway.url ?? ''
    })
    new cdk.CfnOutput(this, 'CloudFrontDistributionUrl', {
      value: `https://${distribution.distributionDomainName}`
    })
    new cdk.CfnOutput(this, 'ArtisanFunctionName', {
      value: artisanFunction.functionName,
    })
  }
}
