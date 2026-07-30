import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { GetCommand, PutCommand, DeleteCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { v4 as uuid } from "uuid";
import { CreateAgentConfigSchema } from "@kiro-scheduler/shared";
import { ddb, TABLES, getUserId, jsonResponse, parseBody, getPathParam } from "../lib/common";

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  if (event.httpMethod === "OPTIONS") return jsonResponse(200, {});

  try {
    const userId = getUserId(event);
    const method = event.httpMethod;
    const path = event.resource;

    if (method === "GET" && path === "/agents") return await list(userId);
    if (method === "POST" && path === "/agents") return await create(userId, event);
    if (method === "GET" && path === "/agents/{id}") return await get(userId, event);
    if (method === "PUT" && path === "/agents/{id}") return await update(userId, event);
    if (method === "DELETE" && path === "/agents/{id}") return await remove(userId, event);

    return jsonResponse(404, { error: "Not found" });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal error";
    if (message.startsWith("Unauthorized")) return jsonResponse(401, { error: message });
    if (message === "Not found") return jsonResponse(404, { error: message });
    return jsonResponse(500, { error: "Internal error", message });
  }
}

async function list(userId: string): Promise<APIGatewayProxyResult> {
  const result = await ddb.send(new QueryCommand({
    TableName: TABLES.agents,
    KeyConditionExpression: "userId = :uid",
    ExpressionAttributeValues: { ":uid": userId },
  }));
  return jsonResponse(200, { data: result.Items ?? [], count: result.Count ?? 0 });
}

async function create(userId: string, event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const input = CreateAgentConfigSchema.parse(parseBody(event));
  const now = new Date().toISOString();
  const item = { ...input, agentId: uuid(), userId, createdAt: now, updatedAt: now };

  await ddb.send(new PutCommand({ TableName: TABLES.agents, Item: item }));
  return jsonResponse(201, { data: item });
}

async function get(userId: string, event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const agentId = getPathParam(event, "id");
  const result = await ddb.send(new GetCommand({
    TableName: TABLES.agents,
    Key: { userId, agentId },
  }));
  if (!result.Item) throw new Error("Not found");
  return jsonResponse(200, { data: result.Item });
}

async function update(userId: string, event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const agentId = getPathParam(event, "id");
  const input = CreateAgentConfigSchema.parse(parseBody(event));

  // Verify ownership
  const existing = await ddb.send(new GetCommand({ TableName: TABLES.agents, Key: { userId, agentId } }));
  if (!existing.Item) throw new Error("Not found");

  const item = { ...existing.Item, ...input, updatedAt: new Date().toISOString() };
  await ddb.send(new PutCommand({ TableName: TABLES.agents, Item: item }));
  return jsonResponse(200, { data: item });
}

async function remove(userId: string, event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const agentId = getPathParam(event, "id");
  await ddb.send(new DeleteCommand({ TableName: TABLES.agents, Key: { userId, agentId } }));
  return jsonResponse(204, {});
}
