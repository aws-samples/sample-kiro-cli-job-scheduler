import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { SecretsManagerClient, PutSecretValueCommand, GetSecretValueCommand, DeleteSecretCommand, CreateSecretCommand, ResourceNotFoundException } from "@aws-sdk/client-secrets-manager";
import { UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, TABLES, getUserId, jsonResponse, parseBody } from "../lib/common";

const sm = new SecretsManagerClient({ region: process.env.AWS_REGION });

function secretPath(userId: string): string {
  return `kiro-scheduler/users/${userId}/api-key`;
}

function maskKey(key: string): string {
  if (key.length <= 8) return "****";
  return key.slice(0, 4) + "****" + key.slice(-4);
}

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  if (event.httpMethod === "OPTIONS") return jsonResponse(200, {});

  try {
    const userId = getUserId(event);
    const method = event.httpMethod;

    if (method === "GET") return await getApiKey(userId);
    if (method === "PUT") return await putApiKey(userId, event);
    if (method === "DELETE") return await deleteApiKey(userId);

    return jsonResponse(405, { error: "Method not allowed" });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal error";
    if (message.startsWith("Unauthorized")) return jsonResponse(401, { error: message });
    return jsonResponse(500, { error: "Internal error", message });
  }
}

async function getApiKey(userId: string): Promise<APIGatewayProxyResult> {
  try {
    const result = await sm.send(new GetSecretValueCommand({ SecretId: secretPath(userId) }));
    const key = result.SecretString ?? "";
    return jsonResponse(200, { data: { configured: true, masked: maskKey(key) } });
  } catch (err) {
    if (err instanceof ResourceNotFoundException) {
      return jsonResponse(200, { data: { configured: false, masked: null } });
    }
    throw err;
  }
}

async function putApiKey(userId: string, event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const { apiKey } = parseBody<{ apiKey: string }>(event);
  if (!apiKey || !apiKey.startsWith("ksk_")) {
    return jsonResponse(400, { error: "Invalid API key format. Must start with ksk_" });
  }

  const name = secretPath(userId);
  try {
    await sm.send(new PutSecretValueCommand({ SecretId: name, SecretString: apiKey }));
  } catch (err) {
    if (err instanceof ResourceNotFoundException) {
      await sm.send(new CreateSecretCommand({ Name: name, SecretString: apiKey }));
    } else {
      throw err;
    }
  }

  // Update user record
  await ddb.send(new UpdateCommand({
    TableName: TABLES.users,
    Key: { userId },
    UpdateExpression: "SET hasApiKey = :v, updatedAt = :t",
    ExpressionAttributeValues: { ":v": true, ":t": new Date().toISOString() },
  }));

  return jsonResponse(200, { data: { configured: true, masked: maskKey(apiKey) } });
}

async function deleteApiKey(userId: string): Promise<APIGatewayProxyResult> {
  try {
    await sm.send(new DeleteSecretCommand({
      SecretId: secretPath(userId),
      ForceDeleteWithoutRecovery: true,
    }));
  } catch (err) {
    if (!(err instanceof ResourceNotFoundException)) throw err;
  }

  await ddb.send(new UpdateCommand({
    TableName: TABLES.users,
    Key: { userId },
    UpdateExpression: "SET hasApiKey = :v, updatedAt = :t",
    ExpressionAttributeValues: { ":v": false, ":t": new Date().toISOString() },
  }));

  return jsonResponse(200, { data: { configured: false, masked: null } });
}
