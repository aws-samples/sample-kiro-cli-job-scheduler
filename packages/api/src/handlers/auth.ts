import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, TABLES, getUserId, jsonResponse } from "../lib/common";

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  if (event.httpMethod === "OPTIONS") {
    return jsonResponse(200, {});
  }

  try {
    const path = event.resource;
    const method = event.httpMethod;

    if (method === "GET" && path === "/auth/me") {
      return await getMe(event);
    }
    if (method === "POST" && path === "/auth/post-confirm") {
      return await postConfirm(event);
    }

    return jsonResponse(404, { error: "Not found" });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal error";
    if (message.startsWith("Unauthorized")) {
      return jsonResponse(401, { error: "Unauthorized", message });
    }
    return jsonResponse(500, { error: "Internal error", message });
  }
}

// GET /auth/me — returns current user profile
async function getMe(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const userId = getUserId(event);

  const result = await ddb.send(new GetCommand({
    TableName: TABLES.users,
    Key: { userId },
  }));

  if (!result.Item) {
    // Auto-create user record on first access
    const claims = event.requestContext.authorizer?.claims;
    const user = {
      userId,
      email: (claims?.email as string) ?? "unknown",
      hasApiKey: false,
      notificationChannels: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await ddb.send(new PutCommand({ TableName: TABLES.users, Item: user }));
    return jsonResponse(200, { data: user });
  }

  return jsonResponse(200, { data: result.Item });
}

// POST /auth/post-confirm — Cognito post-confirmation trigger to create user record
async function postConfirm(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const body = JSON.parse(event.body ?? "{}");
  const userId = body.userId ?? body.sub;
  const email = body.email ?? "unknown";

  if (!userId) return jsonResponse(400, { error: "Missing userId" });

  const user = {
    userId,
    email,
    hasApiKey: false,
    notificationChannels: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  await ddb.send(new PutCommand({
    TableName: TABLES.users,
    Item: user,
    ConditionExpression: "attribute_not_exists(userId)",
  })).catch(() => { /* user already exists, ignore */ });

  return jsonResponse(200, { data: user });
}
