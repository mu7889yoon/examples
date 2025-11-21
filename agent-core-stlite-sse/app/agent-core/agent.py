from strands import Agent, tool
from strands.models import BedrockModel
from bedrock_agentcore.runtime import BedrockAgentCoreApp
import os
import boto3
import json

system_prompt = """
あなたは親切なAIアシスタントです。天気に関する質問がある場合は、get_weatherツールを使用して、天気を取得してください。
"""

MODEL_ID = os.getenv('MODEL_ID', 'apac.amazon.nova-lite-v1:0')
AWS_REGION = os.getenv('AWS_REGION', 'ap-northeast-1')
bedrock_client = boto3.client('bedrock-runtime', region_name=AWS_REGION)

app = BedrockAgentCoreApp()

@app.entrypoint
async def entrypoint(payload):
    message = payload.get("prompt", "")    

    @tool
    def get_weather() -> str:
        """
        天気を取得します。
        
        Returns:
            天気
        """
        return "晴れ"
    
    model = BedrockModel(
        model_id=MODEL_ID,
        params={"max_tokens": 4096, "temperature": 0.85},    
    )

    agent = Agent(
        model=model,
        tools=[get_weather],
        system_prompt=system_prompt,
    )
        
    stream_messages = agent.stream_async(message)
    async for event in stream_messages:
        if "event" in event:
            yield event

if __name__ == "__main__":
    app.run()
