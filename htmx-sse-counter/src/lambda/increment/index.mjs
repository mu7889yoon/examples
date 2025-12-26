import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, UpdateCommand } from "@aws-sdk/lib-dynamodb";

const TABLE_NAME = process.env.TABLE_NAME || "CounterTable";
const PARTITION_KEY = "COUNTER";

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

/**
 * Atomically increments the counter value in DynamoDB using ADD operation.
 * @returns {Promise<number>} The updated count value
 */
export async function incrementCounter() {
  const command = new UpdateCommand({
    TableName: TABLE_NAME,
    Key: { pk: PARTITION_KEY },
    UpdateExpression: "ADD #count :inc SET #updatedAt = :now",
    ExpressionAttributeNames: {
      "#count": "count",
      "#updatedAt": "updatedAt",
    },
    ExpressionAttributeValues: {
      ":inc": 1,
      ":now": new Date().toISOString(),
    },
    ReturnValues: "ALL_NEW",
  });

  const result = await docClient.send(command);
  return result.Attributes?.count ?? 0;
}

/**
 * Lambda handler for POST /api/increment
 * @param {import('aws-lambda').APIGatewayProxyEvent} event
 * @returns {Promise<import('aws-lambda').APIGatewayProxyResult>}
 */
export async function handler(event) {
  try {
    const count = await incrementCounter();

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
      body: JSON.stringify({ count }),
    };
  } catch (error) {
    console.error("Error incrementing counter:", error);

    return {
      statusCode: 500,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
      body: JSON.stringify({
        error: "Failed to increment counter",
        message: error instanceof Error ? error.message : "Unknown error",
      }),
    };
  }
}
