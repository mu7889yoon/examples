import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import { AgentCoreRuntimeConstruct } from "./constructs/agentcore-runtime";
import { DocsBucket } from "./constructs/docs-bucket";
import { InteractionApi } from "./constructs/interaction-api";
import { ReceiverFunction } from "./constructs/receiver-function";
import { DocsBotWorkflow } from "./constructs/workflow";

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required. Copy .env.example to .env and set it before running CDK.`);
  }
  return value;
}

export class DocsBotCdkStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const discordPublicKey = requireEnv("DISCORD_PUBLIC_KEY");
    const bedrockModelId =
      process.env.BEDROCK_MODEL_ID?.trim() || "anthropic.claude-3-5-sonnet-20241022-v2:0";

    const docsBucket = new DocsBucket(this, "DocsBucket");
    const agentCore = new AgentCoreRuntimeConstruct(this, "AgentCore", {
      bedrockModelId,
      docsBucket: docsBucket.bucket,
    });
    const workflow = new DocsBotWorkflow(this, "Workflow", {
      agentRuntimeArn: agentCore.agentRuntimeArn,
    });
    const receiver = new ReceiverFunction(this, "ReceiverFunction", {
      discordPublicKey,
      stateMachine: workflow.stateMachine,
    });
    const api = new InteractionApi(this, "InteractionApi", {
      handler: receiver.function,
    });

    new cdk.CfnOutput(this, "InteractionEndpointUrl", {
      value: api.url,
    });
    new cdk.CfnOutput(this, "DocsBucketName", {
      value: docsBucket.bucket.bucketName,
    });
    new cdk.CfnOutput(this, "AgentRuntimeRoleArn", {
      value: agentCore.role.roleArn,
    });
    new cdk.CfnOutput(this, "AgentRuntimeArn", {
      value: agentCore.agentRuntimeArn,
    });
  }
}
