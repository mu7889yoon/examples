import * as path from "node:path";
import * as cdk from "aws-cdk-lib";
import * as bedrockagentcore from "aws-cdk-lib/aws-bedrockagentcore";
import * as iam from "aws-cdk-lib/aws-iam";
import * as s3 from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";

export interface AgentCoreRuntimeConstructProps {
  bedrockModelId: string;
  docsBucket: s3.IBucket;
}

export class AgentCoreRuntimeConstruct extends Construct {
  public readonly agentRuntimeArn: string;
  public readonly role: iam.Role;
  public readonly runtime: bedrockagentcore.Runtime;

  constructor(scope: Construct, id: string, props: AgentCoreRuntimeConstructProps) {
    super(scope, id);

    this.runtime = new bedrockagentcore.Runtime(this, "Runtime", {
      runtimeName: "discordDocsBot",
      description: "Discord docs bot AgentCore runtime.",
      networkConfiguration: bedrockagentcore.RuntimeNetworkConfiguration.usingPublicNetwork(),
      agentRuntimeArtifact: bedrockagentcore.AgentRuntimeArtifact.fromCodeAsset({
        path: path.join(__dirname, "../../../../src"),
        runtime: bedrockagentcore.AgentCoreRuntime.PYTHON_3_12,
        entrypoint: ["app.py"],
        exclude: [
          "__pycache__",
          "**/__pycache__/**",
          "*.pyc",
          ".pytest_cache",
          ".venv",
          "tests",
          "Dockerfile",
        ],
        bundling: {
          image: cdk.DockerImage.fromRegistry("public.ecr.aws/docker/library/python:3.12-slim"),
          platform: "linux/arm64",
          command: [
            "bash", "-c",
            [
              "pip install --no-cache-dir -r requirements.txt -t /asset-output",
              "cp -a *.py /asset-output",
              "find /asset-output -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true",
            ].join(" && "),
          ],
        },
      }),
      environmentVariables: {
        BEDROCK_MODEL_ID: props.bedrockModelId,
        DOCS_BUCKET: props.docsBucket.bucketName,
      },
    });

    this.role = this.runtime.role as iam.Role;
    props.docsBucket.grantRead(this.role, "docs/*");
    this.role.addToPolicy(
      new iam.PolicyStatement({
        actions: ["s3:ListBucket"],
        resources: [props.docsBucket.bucketArn],
        conditions: {
          StringLike: {
            "s3:prefix": ["docs/*"],
          },
        },
      }),
    );
    this.role.addToPolicy(
      new iam.PolicyStatement({
        actions: ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"],
        resources: ["*"],
      }),
    );

    this.agentRuntimeArn = this.runtime.agentRuntimeArn;
  }
}
