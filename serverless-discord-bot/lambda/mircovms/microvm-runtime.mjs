import http from "node:http";
import { DiscordEchoBot } from "./discord-echo-bot.mjs";

const port = Number.parseInt(process.env.PORT ?? "9000", 10);
const gatewayUrl =
  process.env.DISCORD_GATEWAY_URL ?? "wss://gateway.discord.gg/?v=10&encoding=json";

let bot = null;
let botRunPromise = null;
let lastRunConfig = null;

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/health") {
      sendJson(res, 200, { ok: true, botRunning: Boolean(bot) });
      return;
    }

    if (req.method === "POST" && isHook(req.url, "ready")) {
      sendJson(res, 200, { ready: true });
      return;
    }

    if (req.method === "POST" && isHook(req.url, "validate")) {
      sendJson(res, 200, { valid: true });
      return;
    }

    if (req.method === "POST" && isHook(req.url, "run")) {
      const body = await readJsonBody(req);
      await startBot(resolveRuntimeConfig(body));
      sendJson(res, 200, { started: true });
      return;
    }

    if (req.method === "POST" && isHook(req.url, "suspend")) {
      stopBot("MicroVM suspending");
      sendJson(res, 200, { stopped: true });
      return;
    }

    if (req.method === "POST" && isHook(req.url, "resume")) {
      if (lastRunConfig) {
        await startBot(lastRunConfig);
      }
      sendJson(res, 200, { resumed: Boolean(lastRunConfig) });
      return;
    }

    if (req.method === "POST" && isHook(req.url, "terminate")) {
      stopBot("MicroVM terminating");
      sendJson(res, 200, { stopped: true });
      return;
    }

    sendJson(res, 404, { error: "not_found" });
  } catch (error) {
    console.error("Runtime hook failed", error);
    sendJson(res, 500, { error: error.message });
  }
});

server.listen(port, "0.0.0.0", () => {
  console.log(`MicroVM runtime listening on ${port}`);
});

function isHook(url, name) {
  return url === `/${name}` || url === `/aws/lambda-microvms/runtime/v1/${name}`;
}

function resolveRuntimeConfig(body) {
  const payload = parseRunHookPayload(body?.runHookPayload);
  const token = payload.DISCORD_BOT_TOKEN ?? payload.discordBotToken ?? process.env.DISCORD_BOT_TOKEN;
  if (!token) {
    throw new Error("DISCORD_BOT_TOKEN is required via environment or runHookPayload");
  }

  const maxRuntimeSeconds = Number.parseInt(
    String(payload.MAX_RUNTIME_SECONDS ?? payload.maxRuntimeSeconds ?? process.env.MAX_RUNTIME_SECONDS ?? ""),
    10,
  );

  return {
    token,
    gatewayUrl: payload.DISCORD_GATEWAY_URL ?? payload.discordGatewayUrl ?? gatewayUrl,
    getShutdownDelayMs: Number.isFinite(maxRuntimeSeconds)
      ? () => Math.max(maxRuntimeSeconds * 1_000 - 5_000, 1_000)
      : undefined,
  };
}

async function startBot(config) {
  if (bot) {
    return;
  }

  lastRunConfig = config;
  bot = new DiscordEchoBot(config);
  botRunPromise = bot.run().finally(() => {
    bot = null;
    botRunPromise = null;
  });
}

function stopBot(reason) {
  if (bot) {
    bot.stop(reason);
  }
}

function parseRunHookPayload(payload) {
  if (!payload) {
    return {};
  }
  if (typeof payload !== "string") {
    return payload;
  }
  try {
    return JSON.parse(payload);
  } catch {
    return { DISCORD_BOT_TOKEN: payload };
  }
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function sendJson(res, statusCode, body) {
  res.writeHead(statusCode, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}
