"""AgentCore エージェント: Amazon Nova を Bedrock Converse API で呼び出し、SSE でストリーミング応答する。"""

import json
import os

import boto3
from bedrock_agentcore.runtime import BedrockAgentCoreApp

app = BedrockAgentCoreApp()

MODEL_ID = os.environ.get("BEDROCK_MODEL_ID", "amazon.nova-lite-v1:0")
AWS_REGION = os.environ.get("AWS_REGION", "ap-northeast-1")

bedrock = boto3.client("bedrock-runtime", region_name=AWS_REGION)


@app.entrypoint
async def invoke(payload, context):
    prompt = payload.get("prompt", "Hello!")
    messages = [{"role": "user", "content": [{"text": prompt}]}]

    response = bedrock.converse_stream(modelId=MODEL_ID, messages=messages)

    for event in response["stream"]:
        if "contentBlockDelta" in event:
            delta = event["contentBlockDelta"]["delta"]
            if "text" in delta:
                yield json.dumps({"chunk": delta["text"]})

    yield json.dumps({"done": True})


if __name__ == "__main__":
    app.run()
