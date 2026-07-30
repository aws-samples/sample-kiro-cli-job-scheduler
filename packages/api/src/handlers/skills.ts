import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { GetCommand, PutCommand, DeleteCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { v4 as uuid } from "uuid";
import { CreateSkillSchema } from "@kiro-scheduler/shared";
import { ddb, TABLES, getUserId, jsonResponse, parseBody, getPathParam } from "../lib/common";

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  if (event.httpMethod === "OPTIONS") return jsonResponse(200, {});

  try {
    const userId = getUserId(event);
    const method = event.httpMethod;
    const path = event.resource;

    if (method === "GET" && path === "/skills") return await list(userId);
    if (method === "POST" && path === "/skills") return await create(userId, event);
    if (method === "GET" && path === "/skills/{id}") return await get(userId, event);
    if (method === "PUT" && path === "/skills/{id}") return await update(userId, event);
    if (method === "DELETE" && path === "/skills/{id}") return await remove(userId, event);

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
    TableName: TABLES.skills,
    KeyConditionExpression: "userId = :uid",
    ExpressionAttributeValues: { ":uid": userId },
  }));
  return jsonResponse(200, { data: result.Items ?? [], count: result.Count ?? 0 });
}

async function create(userId: string, event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const input = CreateSkillSchema.parse(parseBody(event));
  const now = new Date().toISOString();
  const item = { ...input, skillId: uuid(), userId, createdAt: now, updatedAt: now };

  await ddb.send(new PutCommand({ TableName: TABLES.skills, Item: item }));
  return jsonResponse(201, { data: item });
}

async function get(userId: string, event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const skillId = getPathParam(event, "id");
  const result = await ddb.send(new GetCommand({
    TableName: TABLES.skills,
    Key: { userId, skillId },
  }));
  if (!result.Item) throw new Error("Not found");
  return jsonResponse(200, { data: result.Item });
}

async function update(userId: string, event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const skillId = getPathParam(event, "id");
  const input = CreateSkillSchema.parse(parseBody(event));

  const existing = await ddb.send(new GetCommand({ TableName: TABLES.skills, Key: { userId, skillId } }));
  if (!existing.Item) throw new Error("Not found");

  const item = { ...existing.Item, ...input, updatedAt: new Date().toISOString() };
  await ddb.send(new PutCommand({ TableName: TABLES.skills, Item: item }));
  return jsonResponse(200, { data: item });
}

async function remove(userId: string, event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const skillId = getPathParam(event, "id");
  await ddb.send(new DeleteCommand({ TableName: TABLES.skills, Key: { userId, skillId } }));
  return jsonResponse(204, {});
}
