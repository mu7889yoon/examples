import { CONFIG } from "./config.js";
import { getIdToken } from "./auth.js";

const LIST_CURRENT_LOCATIONS = `
query ListCurrentLocations($limit: Int) {
  listCurrentLocations(limit: $limit) {
    deviceId
    lat
    lng
    speed
    heading
    accuracy
    capturedAt
    updatedAt
  }
}`;

const ON_LOCATION_UPDATE = `
subscription OnLocationUpdate {
  onLocationUpdate {
    deviceId
    lat
    lng
    speed
    heading
    accuracy
    capturedAt
    updatedAt
  }
}`;

function toRealtimeUrl(graphqlEndpoint) {
  const url = new URL(graphqlEndpoint);
  const host = url.host.replace("appsync-api", "appsync-realtime-api");
  return `wss://${host}/graphql`;
}

function base64url(input) {
  return btoa(input).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

export async function graphqlRequest(query, variables = {}) {
  const token = getIdToken();
  if (!token) {
    throw new Error("No ID token found. Please log in.");
  }

  const response = await fetch(CONFIG.graphqlEndpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: token,
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    throw new Error(`GraphQL request failed: ${response.status}`);
  }

  const payload = await response.json();
  if (payload.errors && payload.errors.length > 0) {
    throw new Error(payload.errors.map((x) => x.message).join("; "));
  }

  return payload.data;
}

export async function listCurrentLocations(limit = 500) {
  const data = await graphqlRequest(LIST_CURRENT_LOCATIONS, { limit });
  return data.listCurrentLocations;
}

export function subscribeOnLocationUpdate({ onData, onError, onConnected }) {
  const token = getIdToken();
  if (!token) {
    onError(new Error("No ID token found. Please log in."));
    return { close() {} };
  }

  const host = new URL(CONFIG.graphqlEndpoint).host;
  const header = base64url(JSON.stringify({ host, Authorization: token }));
  const payload = base64url("{}");

  const websocketUrl = `${toRealtimeUrl(CONFIG.graphqlEndpoint)}?header=${header}&payload=${payload}`;
  const ws = new WebSocket(websocketUrl, "graphql-ws");
  const subscriptionId = `sub-${Date.now()}`;

  ws.onopen = () => {
    ws.send(JSON.stringify({ type: "connection_init" }));
  };

  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);

    if (message.type === "connection_ack") {
      if (onConnected) {
        onConnected();
      }
      ws.send(
        JSON.stringify({
          id: subscriptionId,
          type: "start",
          payload: {
            data: JSON.stringify({ query: ON_LOCATION_UPDATE, variables: {} }),
            extensions: {
              authorization: {
                host,
                Authorization: token,
              },
            },
          },
        })
      );
      return;
    }

    if (message.type === "data" && message.payload?.data?.onLocationUpdate) {
      onData(message.payload.data.onLocationUpdate);
      return;
    }

    if (message.type === "error") {
      onError(new Error(JSON.stringify(message.payload)));
      return;
    }
  };

  ws.onerror = (event) => {
    onError(new Error(`WebSocket error: ${event.type}`));
  };

  ws.onclose = () => {
    onError(new Error("Subscription closed"));
  };

  return {
    close() {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ id: subscriptionId, type: "stop" }));
      }
      ws.close();
    },
  };
}
