import { pipeline } from 'node:stream/promises'
import { BedrockAgentCoreClient, InvokeAgentRuntimeCommand } from '@aws-sdk/client-bedrock-agentcore'

export const handler = awslambda.streamifyResponse(async (event, responseStream, _context) => {
  const client = new BedrockAgentCoreClient({ region: "ap-northeast-1" })

  const prompt = JSON.parse(event.body).prompt
  const command = new InvokeAgentRuntimeCommand({
    agentRuntimeArn: process.env.AGENT_CORE_RUNTIME,
    runtimeSessionId: crypto.randomUUID(),
    payload: JSON.stringify({
      prompt: prompt
    }),
    qualifier: 'DEFAULT',
  })
  
  const response = await client.send(command)

  responseStream = awslambda.HttpResponseStream.from(responseStream, {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    }
  })

  await pipeline(response.response, responseStream)

  responseStream.end()
})
