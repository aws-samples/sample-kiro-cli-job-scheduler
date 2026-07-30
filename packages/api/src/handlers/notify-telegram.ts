import type { SNSEvent } from "aws-lambda";
import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { SecretsManagerClient, GetSecretValueCommand, ResourceNotFoundException } from "@aws-sdk/client-secrets-manager";
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
    await sendTelegramNotification(result);
  }
}

async function sendTelegramNotification(result: ExecutionResult): Promise<void> {
  // Fetch notification channels from Secrets Manager (the user's global channel pool)
  let channels: Array<{ id?: string; type: string; botToken?: string; chatId?: string; name?: string }> = [];
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

  // Resolve the job's effective channels (inherit / select / none), then keep only Telegram
  const effective = resolveJobChannels(
    channels,
    job?.notificationMode as "inherit" | "select" | "none" | undefined,
    job?.notificationChannelIds as string[] | undefined,
  );
  const telegramChannels = effective.filter((ch) => ch.type === "telegram");
  if (!telegramChannels.length) return;

  const emoji = result.status === "succeeded" ? "✅" : "❌";
  const lines = [
    `${emoji} <b>Kiro Job: ${jobName}</b>`,
    `Status: ${result.status}`,
  ];
  if (result.output) {
    const truncated = result.output.length > 20000 ? result.output.slice(0, 20000) + "\n..." : result.output;
    const clean = truncated
      .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "")
      .replace(/\\u001b\[[0-9;]*[a-zA-Z]/g, "")
      .replace(/\\n/g, "\n");
    lines.push("");
    lines.push(clean);
  }
  const text = lines.join("\n");

  for (const channel of telegramChannels) {
    // Telegram has 4096 char limit per message, split if needed
    const chunks = splitMessage(text, 4000);
    for (const chunk of chunks) {
      await sendMessage(channel.botToken!, channel.chatId!, chunk);
    }
  }
}

function splitMessage(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }
    // Try to split at a newline
    let splitAt = remaining.lastIndexOf("\n", maxLen);
    if (splitAt < maxLen * 0.5) splitAt = maxLen;
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt);
  }
  return chunks;
}

function escapeMarkdown(text: string): string {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!]/g, "\\$&");
}

async function sendMessage(botToken: string, chatId: string, text: string): Promise<void> {
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true }),
  });
  if (!resp.ok) {
    console.error(`Telegram send failed: ${resp.status} ${await resp.text()}`);
  }
}
