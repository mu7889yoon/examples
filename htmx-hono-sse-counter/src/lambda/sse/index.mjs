import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand } from "@aws-sdk/lib-dynamodb";

const TABLE_NAME = process.env.TABLE_NAME || "CounterTable";
const PARTITION_KEY = "COUNTER";
const POLL_INTERVAL_MS = 1000;

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

/**
 * Retrieves the current counter value from DynamoDB.
 * Returns 0 if no record exists (per Requirement 6.4).
 * @returns {Promise<number>}
 */
export async function getCounterValue() {
  const command = new GetCommand({
    TableName: TABLE_NAME,
    Key: { pk: PARTITION_KEY },
  });

  const result = await docClient.send(command);
  return result.Item?.count ?? 0;
}

/**
 * Formats a counter value as an SSE event string.
 * Event name is "counter" and data contains an HTML element with id "counter".
 * @param {number} count
 * @returns {string}
 */
export function formatSSEEvent(count) {
  const htmlFragment = `<div id="counter">${count}</div>`;
  return `event: counter\ndata: ${htmlFragment}\n\n`;
}

/**
 * Sleep utility for polling interval.
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Lambda Response Streaming handler for SSE endpoint.
 * Uses awslambda.streamifyResponse for streaming responses.
 * 
 * - Sends current counter value immediately on connection
 * - Polls DynamoDB for changes and sends updates via SSE
 * - Maintains connection until client disconnects or timeout
 */
export const handler = awslambda.streamifyResponse(async (_event, responseStream, _context) => {
  // Set SSE headers via metadata
  responseStream = awslambda.HttpResponseStream.from(responseStream, {
    statusCode: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "Access-Control-Allow-Origin": "*",
    },
  });

  let lastCount = null;
  let isStreamOpen = true;

  // Handle stream close/error
  responseStream.on("close", () => {
    isStreamOpen = false;
  });

  responseStream.on("error", (err) => {
    console.error("Stream error:", err);
    isStreamOpen = false;
  });

  try {
    // Send initial counter value immediately (Requirement 3.3, 4.2)
    const initialCount = await getCounterValue();
    lastCount = initialCount;
    const initialEvent = formatSSEEvent(initialCount);
    responseStream.write(initialEvent);

    // Poll for changes and send updates (Requirement 2.2)
    while (isStreamOpen) {
      await sleep(POLL_INTERVAL_MS);

      if (!isStreamOpen) break;

      try {
        const currentCount = await getCounterValue();

        // Only send update if value changed
        if (currentCount !== lastCount) {
          lastCount = currentCount;
          const sseEvent = formatSSEEvent(currentCount);
          responseStream.write(sseEvent);
        }
      } catch (pollError) {
        console.error("Error polling DynamoDB:", pollError);
        // Continue polling despite errors
      }
    }
  } catch (error) {
    console.error("SSE handler error:", error);
    // Send error event before closing
    const errorEvent = `event: error\ndata: ${JSON.stringify({ error: "Internal server error" })}\n\n`;
    responseStream.write(errorEvent);
  } finally {
    responseStream.end();
  }
});
