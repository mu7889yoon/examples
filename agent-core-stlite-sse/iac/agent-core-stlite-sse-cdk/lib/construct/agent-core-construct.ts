import { Construct } from 'constructs'
import * as iam from 'aws-cdk-lib/aws-iam'
import { WEATHER_AGENT_CORE_ROOT, AWS_REGION, BEDROCK_MODEL_ID } from '../agent-core-stlite-ses-const'

// alpha release
import * as agentCore from '@aws-cdk/aws-bedrock-agentcore-alpha'

export class AgentCoreConstruct extends Construct {
    public readonly agentCoreRuntime: agentCore.Runtime

    constructor(scope: Construct, id: string) {
        super(scope, id)

        const weatherAgentRuntime = new agentCore.Runtime(this, 'WeatherAgentCoreRuntime', {
            runtimeName: 'weatherAgent',
            agentRuntimeArtifact: agentCore.AgentRuntimeArtifact.fromAsset(WEATHER_AGENT_CORE_ROOT),
            environmentVariables: {
                BEDROCK_MODEL_ID: BEDROCK_MODEL_ID,
                AWS_REGION: AWS_REGION,
            }
        })
        
        weatherAgentRuntime.addToRolePolicy(
            new iam.PolicyStatement({
                effect: iam.Effect.ALLOW,
                actions: [
                    'bedrock:InvokeModel',
                    "bedrock:InvokeModelWithResponseStream"
                ],
                resources: ['*'],
            })
        )

        this.agentCoreRuntime = weatherAgentRuntime
    }
}