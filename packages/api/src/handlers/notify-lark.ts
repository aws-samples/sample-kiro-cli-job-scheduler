import type { SNSEvent } from "aws-lambda";
import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { SecretsManagerClient, GetSecretValueCommand, ResourceNotFoundException } from "@aws-sdk/client-secrets-manager";
import { createHmac } from "crypto";
import { resolveJobChannels } from "@kiro-scheduler/shared";
import { ddb, TABLES } from "../lib/common";

const sm = new SecretsManagerClient({});

interface ExecutionResult {
  jobId: string;
  executionId: string;
  userId: string;
  status: string;
  exitCode: number;
  output?: string;
}

export async function handler(event: SNSEvent): Promise<void> {
  for (const record of event.Records) {
    const result: ExecutionResult = JSON.parse(record.Sns.Message);
    await sendLarkNotification(result);
  }
}

async function sendLarkNotification(result: ExecutionResult): Promise<void> {
  // Fetch notification channels from Secrets Manager (the user's global channel pool)
  let channels: Array<{ id?: string; type: string; webhookUrl?: string; secret?: string; name?: string }> = [];
  try {
    const secretResult = await sm.send(new GetSecretValueCommand({ SecretId: `kiro-scheduler/users/${result.userId}/notifications` }));
    channels = JSON.parse(secretResult.SecretString ?? "[]");
  } catch (err) {
    if (err instanceof ResourceNotFoundException) return;
    throw err;
  }

  // Fetch job (used for both the display name and the per-job notification config)
  const jobResult = await ddb.send(new GetCommand({
    TableName: TABLES.jobs,
    Key: { userId: result.userId, jobId: result.jobId },
  }));
  const job = jobResult.Item;
  const jobName = job?.name ?? result.jobId;

  // Resolve the job's effective channels (inherit / select / none), then keep only Lark
  const effective = resolveJobChannels(
    channels,
    job?.notificationMode as "inherit" | "select" | "none" | undefined,
    job?.notificationChannelIds as string[] | undefined,
  );
  const larkChannels = effective.filter((ch) => ch.type === "lark");
  if (!larkChannels.length) return;

  const statusEmoji = result.status === "succeeded" ? "✅" : "❌";
  const card = buildLarkCard(jobName, result, statusEmoji);

  for (const channel of larkChannels) {
    await postToLark(channel.webhookUrl!, card, channel.secret);
  }
}

function buildLarkCard(jobName: string, result: ExecutionResult, emoji: string) {
  const elements: unknown[] = [
    {
      tag: "div",
      fields: [
        { is_short: true, text: { tag: "lark_md", content: `**Status:** ${result.status}` } },
        { is_short: true, text: { tag: "lark_md", content: `**Exit Code:** ${result.exitCode}` } },
      ],
    },
  ];

  if (result.output) {
    const truncated = result.output.length > 20000 ? result.output.slice(0, 20000) + "\n..." : result.output;
    const clean = truncated
      .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "")
      .replace(/\\u001b\[[0-9;]*[a-zA-Z]/g, "")
      .replace(/\\n/g, "\n");
    elements.push({ tag: "hr" });
    elements.push({ tag: "div", text: { tag: "lark_md", content: clean } });
  }

  return {
    header: {
      title: { tag: "plain_text", content: `${emoji} Job: ${jobName}` },
      template: result.status === "succeeded" ? "green" : "red",
    },
    elements,
  };
}

function generateSign(secret: string): { timestamp: string; sign: string } {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const stringToSign = `${timestamp}\n${secret}`;
  const hmac = createHmac("sha256", stringToSign);
  hmac.update("");
  const sign = hmac.digest("base64");
  return { timestamp, sign };
}

async function postToLark(webhookUrl: string, card: unknown, secret?: string): Promise<void> {
  const body: Record<string, unknown> = { msg_type: "interactive", card };

  // Add signature if secret is configured
  if (secret) {
    const { timestamp, sign } = generateSign(secret);
    body.timestamp = timestamp;
    body.sign = sign;
  }

  const resp = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    console.error(`Lark webhook failed: ${resp.status} ${await resp.text()}`);
  }
}
