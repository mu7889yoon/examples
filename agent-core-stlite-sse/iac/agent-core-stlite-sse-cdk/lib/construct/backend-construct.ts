import { Construct } from 'constructs'
import { LAMBDA_ROOT } from '../agent-core-stlite-ses-const'
import * as agentCore from '@aws-cdk/aws-bedrock-agentcore-alpha'
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs'
import * as lambda from 'aws-cdk-lib/aws-lambda'
import * as iam from 'aws-cdk-lib/aws-iam'
import * as apigateway from 'aws-cdk-lib/aws-apigateway'
import * as cdk from 'aws-cdk-lib/core'

interface BackendConstructProps {
   agentCoreRuntime: agentCore.Runtime
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
            timeout: cdk.Duration.seconds(900),
            environment: {
                AGENT_CORE_RUNTIME: props.agentCoreRuntime.agentRuntimeArn,                                
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

        const proxyLambdaIntegration = new apigateway.LambdaIntegration(proxyLambda, {
            responseTransferMode: apigateway.ResponseTransferMode.STREAM
        })
        apiGatewayResource.addMethod('POST', proxyLambdaIntegration, {
            authorizationType: apigateway.AuthorizationType.NONE,
        })                

        this.apiGateway = apiGateway
    }
}