import * as cdk from "aws-cdk-lib";
import * as path from "node:path";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as sfn from "aws-cdk-lib/aws-stepfunctions";
import { Construct } from "constructs";

export interface ReceiverFunctionProps {
  discordPublicKey: string;
  stateMachine: sfn.IStateMachine;
}

export class ReceiverFunction extends Construct {
  public readonly function: lambda.Function;

  constructor(scope: Construct, id: string, props: ReceiverFunctionProps) {
    super(scope, id);

    this.function = new lambda.Function(this, "Function", {
      runtime: lambda.Runtime.NODEJS_22_X,
      code: lambda.Code.fromAsset(path.join(__dirname, "../../lambda/receiver")),
      handler: "index.handler",
      timeout: cdk.Duration.seconds(10),
      memorySize: 256,
      environment: {
        STATE_MACHINE_ARN: props.stateMachine.stateMachineArn,
        DISCORD_PUBLIC_KEY: props.discordPublicKey,
      },
    });

    this.function.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["states:StartExecution"],
        resources: [props.stateMachine.stateMachineArn],
      }),
    );
  }
}
