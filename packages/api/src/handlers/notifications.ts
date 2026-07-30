import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { SecretsManagerClient, GetSecretValueCommand, PutSecretValueCommand, CreateSecretCommand, ResourceNotFoundException } from "@aws-sdk/client-secrets-manager";
import { NotificationChannelSchema } from "@kiro-scheduler/shared";
import { randomUUID } from "crypto";
import { z } from "zod";
import { getUserId, jsonResponse, parseBody } from "../lib/common";

const sm = new SecretsManagerClient({ region: process.env.AWS_REGION });

function secretPath(userId: string): string {
  return `kiro-scheduler/users/${userId}/notifications`;
}

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  if (event.httpMethod === "OPTIONS") return jsonResponse(200, {});

  try {
    const userId = getUserId(event);
    const method = event.httpMethod;

    if (method === "GET") return await getChannels(userId);
    if (method === "PUT") return await updateChannels(userId, event);

    return jsonResponse(405, { error: "Method not allowed" });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal error";
    if (message.startsWith("Unauthorized")) return jsonResponse(401, { error: message });
    return jsonResponse(500, { error: "Internal error", message });
  }
}

async function getChannels(userId: string): Promise<APIGatewayProxyResult> {
  try {
    const result = await sm.send(new GetSecretValueCommand({ SecretId: secretPath(userId) }));
    const channels = JSON.parse(result.SecretString ?? "[]");
    return jsonResponse(200, { data: channels });
  } catch (err) {
    if (err instanceof ResourceNotFoundException) {
      return jsonResponse(200, { data: [] });
    }
    throw err;
  }
}

async function updateChannels(userId: string, event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const body = parseBody<{ channels: unknown[] }>(event);

  // Backfill a stable id for any channel that doesn't have one, so jobs can
  // reference channels reliably even across reorders/edits of the global pool.
  const withIds = (Array.isArray(body.channels) ? body.channels : []).map((ch) => {
    if (ch && typeof ch === "object" && !(ch as { id?: unknown }).id) {
      return { ...(ch as object), id: randomUUID() };
    }
    return ch;
  });

  const channels = z.array(NotificationChannelSchema).parse(withIds);
  const secretValue = JSON.stringify(channels);
  const name = secretPath(userId);

  try {
    await sm.send(new PutSecretValueCommand({ SecretId: name, SecretString: secretValue }));
  } catch (err) {
    if (err instanceof ResourceNotFoundException) {
      await sm.send(new CreateSecretCommand({ Name: name, SecretString: secretValue }));
    } else {
      throw err;
    }
  }

  return jsonResponse(200, { data: channels });
}
