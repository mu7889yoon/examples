"""AgentCore Runtime entrypoint for household accounting analysis agent.

This module provides the BedrockAgentCoreApp wrapper for deploying
the household accounting analysis agent to AgentCore Runtime.
"""

import os
import sys

# Add the agent directory to the path for imports
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# Bypass tool consent for automated execution
os.environ["BYPASS_TOOL_CONSENT"] = "true"

from bedrock_agentcore.runtime import BedrockAgentCoreApp
from strands import Agent
from strands.models import BedrockModel

from tools import query_transactions
from prompts import SYSTEM_PROMPT


def create_agent() -> Agent:
    """Create and configure the household accounting analysis agent.
    
    Returns:
        Configured Strands Agent instance
    """
    model = BedrockModel(
        model_id=os.environ.get('MODEL_ID', 'apac.amazon.nova-pro-v1:0'),
        region_name=os.environ.get('AWS_REGION', 'ap-northeast-1')
    )
    
    agent = Agent(
        model=model,
        tools=[query_transactions],
        system_prompt=SYSTEM_PROMPT,
        callback_handler=None  # Disable callback handler for streaming
    )
    
    return agent


# Initialize AgentCore app
app = BedrockAgentCoreApp()

# Create a single agent instance
agent = create_agent()


@app.entrypoint
async def invoke(payload: dict, context: dict):
    """AgentCore Runtime entrypoint with SSE streaming.
    
    Args:
        payload: Request payload containing 'prompt' key
        context: AgentCore runtime context
        
    Yields:
        Streaming response events from the agent
    """
    user_message = payload.get(
        "prompt", 
        "質問が見つかりませんでした。'prompt'キーにメッセージを入力してください。"
    )
    
    print(f"Context: {context}")
    print(f"Processing message: {user_message}")
    
    # Stream the agent response
    agent_stream = agent.stream_async(user_message)
    
    async for event in agent_stream:
        if "event" in event:
            yield event


if __name__ == "__main__":
    app.run()
