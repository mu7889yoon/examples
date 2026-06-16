import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as logs from "aws-cdk-lib/aws-logs";
import * as sfn from "aws-cdk-lib/aws-stepfunctions";
import * as tasks from "aws-cdk-lib/aws-stepfunctions-tasks";
import * as path from "node:path";
import { Construct } from "constructs";

export interface DocsBotWorkflowProps {
  agentRuntimeArn: string;
}

export class DocsBotWorkflow extends Construct {
  public readonly stateMachine: sfn.StateMachine;

  constructor(scope: Construct, id: string, props: DocsBotWorkflowProps) {
    super(scope, id);

    const followupFunction = new lambda.Function(this, "DiscordFollowupFunction", {
      runtime: lambda.Runtime.NODEJS_22_X,
      code: lambda.Code.fromAsset(path.join(__dirname, "../../lambda/followup")),
      handler: "index.handler",
    });

    const invokeAgent = new sfn.CustomState(this, "InvokeAgentCore", {
      stateJson: {
        Type: "Task",
        Resource: "arn:aws:states:::aws-sdk:bedrockagentcore:invokeAgentRuntime",
        Parameters: {
          AgentRuntimeArn: props.agentRuntimeArn,
          Payload: {
            "question.$": "$.question",
            discord: {
              "applicationId.$": "$.discord.applicationId",
              "interactionToken.$": "$.discord.interactionToken",
              "guildId.$": "$.discord.guildId",
              "channelId.$": "$.discord.channelId",
              "userId.$": "$.discord.userId",
            },
          },
        },
        ResultPath: "$.agent",
      },
    });

    const postFollowup = new tasks.LambdaInvoke(this, "PostDiscordFollowup", {
      lambdaFunction: followupFunction,
      payload: sfn.TaskInput.fromObject({
        discord: {
          "applicationId.$": "$.discord.applicationId",
          "interactionToken.$": "$.discord.interactionToken",
        },
        "agentResponse.$": "$.agent.Response",
      }),
      payloadResponseOnly: true,
    });

    const postFailure = new tasks.LambdaInvoke(this, "PostDiscordFailure", {
      lambdaFunction: followupFunction,
      payload: sfn.TaskInput.fromObject({
        discord: {
          "applicationId.$": "$.discord.applicationId",
          "interactionToken.$": "$.discord.interactionToken",
        },
        content: "回答に失敗しました。時間をおいて再試行してください。",
      }),
      payloadResponseOnly: true,
    });

    invokeAgent.addCatch(postFailure, { resultPath: "$.error" });
    postFollowup.addCatch(postFailure, { resultPath: "$.error" });

    this.stateMachine = new sfn.StateMachine(this, "StateMachine", {
      definitionBody: sfn.DefinitionBody.fromChainable(invokeAgent.next(postFollowup)),
      logs: {
        destination: new logs.LogGroup(this, "WorkflowLogs", {
          retention: logs.RetentionDays.ONE_WEEK,
        }),
        level: sfn.LogLevel.ERROR,
      },
      stateMachineType: sfn.StateMachineType.EXPRESS,
      tracingEnabled: true,
    });

    this.stateMachine.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["bedrock-agentcore:InvokeAgentRuntime"],
        resources: [
          props.agentRuntimeArn,
          `${props.agentRuntimeArn}/*`,
        ],
      }),
    );
  }
}
