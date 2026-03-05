import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb'

const TABLE_NAME = process.env.TABLE_NAME || 'CounterTable'
const PARTITION_KEY = 'COUNTER'

const client = new DynamoDBClient({})
const docClient = DynamoDBDocumentClient.from(client)

export async function getCounterValue(): Promise<number> {
  const result = await docClient.send(new GetCommand({
    TableName: TABLE_NAME,
    Key: { pk: PARTITION_KEY }
  }))
  return result.Item?.count ?? 0
}

export async function incrementCounter(): Promise<number> {
  const result = await docClient.send(new UpdateCommand({
    TableName: TABLE_NAME,
    Key: { pk: PARTITION_KEY },
    UpdateExpression: 'ADD #count :inc SET #updatedAt = :now',
    ExpressionAttributeNames: { '#count': 'count', '#updatedAt': 'updatedAt' },
    ExpressionAttributeValues: { ':inc': 1, ':now': new Date().toISOString() },
    ReturnValues: 'ALL_NEW'
  }))
  return result.Attributes?.count ?? 0
}
