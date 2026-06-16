import * as apigwv2 from "aws-cdk-lib/aws-apigatewayv2";
import * as integrations from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { Construct } from "constructs";

export interface InteractionApiProps {
  handler: lambda.IFunction;
}

export class InteractionApi extends Construct {
  public readonly api: apigwv2.HttpApi;
  public readonly url: string;

  constructor(scope: Construct, id: string, props: InteractionApiProps) {
    super(scope, id);

    this.api = new apigwv2.HttpApi(this, "HttpApi", {
      apiName: "discord-docs-bot-interactions",
    });

    this.api.addRoutes({
      path: "/interactions",
      methods: [apigwv2.HttpMethod.POST],
      integration: new integrations.HttpLambdaIntegration("ReceiverIntegration", props.handler),
    });

    this.url = `${this.api.url!}interactions`;
  }
}

