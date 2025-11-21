import * as cdk from 'aws-cdk-lib/core';
import { Construct } from 'constructs';
import { BackendConstruct } from './construct/backend-construct';
import { AgentCoreConstruct } from './construct/agent-core-construct';
import { FrontendConstruct } from './construct/frontend-construct';

export class AgentCoreStliteSseCdkStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const agentCoreConstruct = new AgentCoreConstruct(this, 'AgentCoreConstruct')


    const backendConstruct = new BackendConstruct(this, 'BackendConstruct', {
      weatherAgentCoreRuntime: agentCoreConstruct.weatherAgentRuntime
    })

    new FrontendConstruct(this, 'FrontendConstruct', {
      apiGateway: backendConstruct.apiGateway
    })


  }
}
