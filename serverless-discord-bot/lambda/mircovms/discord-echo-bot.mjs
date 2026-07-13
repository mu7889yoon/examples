import WebSocket from "ws";

const DISCORD_API_BASE = "https://discord.com/api/v10";
const OPCODES = {
  DISPATCH: 0,
  HEARTBEAT: 1,
  IDENTIFY: 2,
  HELLO: 10,
  HEARTBEAT_ACK: 11,
};

const INTENTS = {
  GUILDS: 1 << 0,
  GUILD_MESSAGES: 1 << 9,
  MESSAGE_CONTENT: 1 << 15,
};

export class DiscordEchoBot {
  constructor({ token, gatewayUrl, getShutdownDelayMs }) {
    this.token = token;
    this.gatewayUrl = gatewayUrl;
    this.getShutdownDelayMs = getShutdownDelayMs;
    this.sequence = null;
    this.heartbeatTimer = null;
    this.shuttingDown = false;
    this.ws = null;
  }

  async run() {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.gatewayUrl);
      this.ws = ws;
      const shutdownDelayMs = this.getShutdownDelayMs?.();
      const shutdownTimer =
        typeof shutdownDelayMs === "number"
          ? setTimeout(() => {
              this.shuttingDown = true;
              ws.close(1000, "Execution window ending");
            }, Math.max(shutdownDelayMs, 1_000))
          : null;

      ws.on("open", () => {
        console.log("Discord Gateway WebSocket opened");
      });

      ws.on("message", async (data) => {
        try {
          await this.handleGatewayMessage(ws, data);
        } catch (error) {
          console.error("Failed to handle gateway message", error);
        }
      });

      ws.on("close", (code, reason) => {
        this.ws = null;
        if (shutdownTimer) {
          clearTimeout(shutdownTimer);
        }
        this.clearHeartbeat();
        console.log(`Discord Gateway WebSocket closed: ${code} ${reason.toString()}`);
        resolve({
          ok: true,
          reason: this.shuttingDown ? "shutdown_guard" : "websocket_closed",
          closeCode: code,
        });
      });

      ws.on("error", (error) => {
        this.ws = null;
        if (shutdownTimer) {
          clearTimeout(shutdownTimer);
        }
        this.clearHeartbeat();
        reject(error);
      });
    });
  }

  stop(reason = "Application requested shutdown") {
    this.shuttingDown = true;
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.close(1000, reason);
      return;
    }
    this.clearHeartbeat();
  }

  async handleGatewayMessage(ws, rawData) {
    const packet = JSON.parse(rawData.toString());
    if (typeof packet.s === "number") {
      this.sequence = packet.s;
    }

    switch (packet.op) {
      case OPCODES.HELLO:
        this.startHeartbeat(ws, packet.d.heartbeat_interval);
        this.identify(ws);
        break;
      case OPCODES.DISPATCH:
        if (packet.t === "READY") {
          console.log(`Logged in as ${packet.d.user.username}#${packet.d.user.discriminator}`);
        }
        if (packet.t === "MESSAGE_CREATE") {
          await this.echoMessage(packet.d);
        }
        break;
      case OPCODES.HEARTBEAT_ACK:
        break;
      default:
        console.log(`Unhandled opcode: ${packet.op}`);
    }
  }

  startHeartbeat(ws, intervalMs) {
    this.clearHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ op: OPCODES.HEARTBEAT, d: this.sequence }));
      }
    }, intervalMs);
  }

  clearHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  identify(ws) {
    ws.send(
      JSON.stringify({
        op: OPCODES.IDENTIFY,
        d: {
          token: this.token,
          intents: INTENTS.GUILDS | INTENTS.GUILD_MESSAGES | INTENTS.MESSAGE_CONTENT,
          properties: {
            os: "linux",
            browser: "serverless-discord-bot",
            device: "serverless-discord-bot",
          },
        },
      }),
    );
  }

  async echoMessage(message) {
    if (message.author?.bot || !message.content) {
      return;
    }

    const content = message.content.slice(0, 1900);
    const response = await fetch(`${DISCORD_API_BASE}/channels/${message.channel_id}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bot ${this.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        content,
        allowed_mentions: { parse: [] },
        message_reference: {
          message_id: message.id,
          channel_id: message.channel_id,
          guild_id: message.guild_id,
          fail_if_not_exists: false,
        },
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Discord REST API failed: ${response.status} ${body}`);
    }
  }
}
