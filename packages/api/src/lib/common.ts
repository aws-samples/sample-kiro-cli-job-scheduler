import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";

const client = new DynamoDBClient({
  endpoint: process.env.DYNAMODB_ENDPOINT,
});
export const ddb = DynamoDBDocumentClient.from(client);

export const TABLES = {
  users: process.env.USERS_TABLE ?? "kiro-scheduler-users",
  jobs: process.env.JOBS_TABLE ?? "kiro-scheduler-jobs",
  agents: process.env.AGENTS_TABLE ?? "kiro-scheduler-agents",
  skills: process.env.SKILLS_TABLE ?? "kiro-scheduler-skills",
  mcpServers: process.env.MCP_SERVERS_TABLE ?? "kiro-scheduler-mcp-servers",
  executions: process.env.EXECUTIONS_TABLE ?? "kiro-scheduler-executions",
};

export function getUserId(event: APIGatewayProxyEvent): string {
  // Cognito authorizer puts claims in requestContext
  const claims = event.requestContext.authorizer?.claims;
  if (claims?.sub) return claims.sub as string;
  // x-user-id header only allowed in local development
  if (process.env.IS_LOCAL === "true") {
    const authHeader = event.headers?.["x-user-id"];
    if (authHeader) return authHeader;
  }
  throw new Error("Unauthorized: no user identity");
}

const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "*";

export function jsonResponse(statusCode: number, body: unknown): APIGatewayProxyResult {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
      "Access-Control-Allow-Headers": "Content-Type,Authorization",
      "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
    },
    body: JSON.stringify(body),
  };
}

export function parseBody<T>(event: APIGatewayProxyEvent): T {
  if (!event.body) throw new Error("Missing request body");
  return JSON.parse(event.body) as T;
}

export function getPathParam(event: APIGatewayProxyEvent, name: string): string {
  const value = event.pathParameters?.[name];
  if (!value) throw new Error(`Missing path parameter: ${name}`);
  return value;
}
