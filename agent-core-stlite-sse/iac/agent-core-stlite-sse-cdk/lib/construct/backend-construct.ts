import { Construct } from 'constructs'
import { LAMBDA_ROOT, AWS_REGION, BEDROCK_MODEL_ID } from '../agent-core-stlite-ses-const'
import * as agentCore from '@aws-cdk/aws-bedrock-agentcore-alpha'
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs'
import * as lambda from 'aws-cdk-lib/aws-lambda'
import * as iam from 'aws-cdk-lib/aws-iam'
import * as apigateway from 'aws-cdk-lib/aws-apigateway'
import * as cdk from 'aws-cdk-lib/core'

interface BackendConstructProps {
    weatherAgentCoreRuntime: agentCore.Runtime    
}

export class BackendConstruct extends Construct {
    public readonly apiGateway: apigateway.RestApi

    constructor(scope: Construct, id: string, props: BackendConstructProps) {
        super(scope, id)

        const proxyLambda = new lambdaNodejs.NodejsFunction(this, 'ProxyLambda', {
            runtime: lambda.Runtime.NODEJS_20_X,
            architecture: lambda.Architecture.ARM_64,
            code: lambda.Code.fromAsset(LAMBDA_ROOT),
            handler: 'index.handler',
            timeout: cdk.Duration.seconds(300),
            environment: {
                AGENT_CORE_RUNTIME: props.weatherAgentCoreRuntime.agentRuntimeArn,                                
            },
        })
        proxyLambda.addToRolePolicy(
            new iam.PolicyStatement({
                effect: iam.Effect.ALLOW,
                actions: ['bedrock-agentcore:InvokeAgentRuntime'],                
                resources: ['*'],
            })
        )

        const apiGateway = new apigateway.RestApi(this, 'ApiGateway')        
        apiGateway.root.addCorsPreflight({
            allowOrigins: ['*'],                
            allowMethods: ['OPTION', 'POST'],
            allowHeaders: apigateway.Cors.DEFAULT_HEADERS,
        })

        const apiGatewayResource = apiGateway.root.addResource('agent-core-invoke',{
            defaultCorsPreflightOptions: {
                allowOrigins: ['*'],                
                allowMethods: ['OPTION', 'POST'],
                allowHeaders: apigateway.Cors.DEFAULT_HEADERS,
            },
        })

        const proxyLambdaIntegration = new apigateway.LambdaIntegration(proxyLambda)
        const apiGatewayMethod = apiGatewayResource.addMethod('POST', proxyLambdaIntegration, {
            authorizationType: apigateway.AuthorizationType.NONE,
        })
        const cfnApiGatewayMethod = apiGatewayMethod.node.defaultChild as apigateway.CfnMethod

        const region = cdk.Stack.of(this).region
        const streamingUri = `arn:aws:apigateway:${region}:lambda:path/2021-11-15/functions/${proxyLambda.functionArn}/response-streaming-invocations`

        cfnApiGatewayMethod.addPropertyOverride('Integration.Uri', streamingUri)
        cfnApiGatewayMethod.addPropertyOverride('Integration.ResponseTransferMode', 'STREAM')

        this.apiGateway = apiGateway
    }
}