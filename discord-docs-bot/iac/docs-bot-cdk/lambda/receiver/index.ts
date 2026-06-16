import { StartExecutionCommand, SFNClient } from "@aws-sdk/client-sfn";
import nacl from "tweetnacl";

const STATE_MACHINE_ARN = process.env.STATE_MACHINE_ARN;
const DISCORD_PUBLIC_KEY = process.env.DISCORD_PUBLIC_KEY;
const sfn = new SFNClient({});

type ApiGatewayEventV2 = {
  headers: Record<string, string | undefined>;
  body?: string;
  requestContext: {
    requestId?: string;
  };
};

type ApiGatewayResultV2 = {
  statusCode: number;
  headers?: Record<string, string>;
  body: string;
};

type DiscordInteraction = {
  type?: number;
  application_id?: string;
  token?: string;
  guild_id?: string;
  channel_id?: string;
  member?: { user?: { id?: string } };
  user?: { id?: string };
  data?: {
    name?: string;
    options?: Array<{ name?: string; value?: string }>;
  };
};

function json(statusCode: number, payload: unknown): ApiGatewayResultV2 {
  return {
    statusCode,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  };
}

function getUserId(body: DiscordInteraction): string | undefined {
  return body.member?.user?.id ?? body.user?.id;
}

function getQuestion(body: DiscordInteraction): string {
  const option = body.data?.options?.find((candidate) => candidate.name === "question");
  return typeof option?.value === "string" ? option.value.trim() : "";
}

function rawEd25519PublicKeyToSpkiDer(hexKey: string): Buffer {
  const rawKey = Buffer.from(hexKey, "hex");
  const prefix = Buffer.from("302a300506032b6570032100", "hex");
  return Buffer.concat([prefix, rawKey]);
}

export async function handler(
  event: ApiGatewayEventV2,
): Promise<ApiGatewayResultV2> {
  if (!STATE_MACHINE_ARN) {
    throw new Error("STATE_MACHINE_ARN is not configured");
  }

  if (!verifyDiscordRequest(event)) {
    return { statusCode: 401, body: "invalid request signature" };
  }

  const body = JSON.parse(event.body ?? "{}") as DiscordInteraction;

  if (body.type === 1) {
    return json(200, { type: 1 });
  }

  if (body.type !== 2 || body.data?.name !== "ask") {
    return json(400, {
      type: 4,
      data: { content: "このエンドポイントは /ask コマンド専用です。" },
    });
  }

  const question = getQuestion(body);
  if (!question) {
    return json(400, {
      type: 4,
      data: { content: "question を指定してください。" },
    });
  }

  const input = {
    question,
    discord: {
      applicationId: body.application_id,
      interactionToken: body.token,
      guildId: body.guild_id,
      channelId: body.channel_id,
      userId: getUserId(body),
    },
  };

  console.log(
    JSON.stringify({
      level: "info",
      msg: "Starting async workflow for Discord interaction",
      requestId: event.requestContext.requestId,
      guildId: body.guild_id,
      channelId: body.channel_id,
      userId: getUserId(body),
      questionLength: question.length,
    }),
  );

  await startStepFunctionsExecution({
    stateMachineArn: STATE_MACHINE_ARN,
    input,
  });

  return json(200, {
    type: 5,
    data: {
      content: "ドキュメントを確認しています...",
    },
  });
}

function verifyDiscordRequest(event: ApiGatewayEventV2): boolean {
  if (!DISCORD_PUBLIC_KEY) {
    throw new Error("DISCORD_PUBLIC_KEY is not configured");
  }

  const signature =
    event.headers["x-signature-ed25519"] ?? event.headers["X-Signature-Ed25519"];
  const timestamp =
    event.headers["x-signature-timestamp"] ?? event.headers["X-Signature-Timestamp"];
  const body = event.body ?? "";

  if (!signature || !timestamp) {
    return false;
  }

  return nacl.sign.detached.verify(
    Buffer.from(timestamp + body),
    Buffer.from(signature, "hex"),
    Buffer.from(DISCORD_PUBLIC_KEY, "hex"),
  );
}

async function startStepFunctionsExecution(params: {
  stateMachineArn: string;
  input: unknown;
}): Promise<void> {
  await sfn.send(
    new StartExecutionCommand({
      stateMachineArn: params.stateMachineArn,
      input: JSON.stringify(params.input),
    }),
  );
}
