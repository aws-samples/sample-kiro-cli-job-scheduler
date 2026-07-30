import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { handler as authHandler } from "./handlers/auth";
import { handler as apiKeyHandler } from "./handlers/api-key";
import { handler as agentsHandler } from "./handlers/agents";
import { handler as skillsHandler } from "./handlers/skills";
import { handler as mcpServersHandler } from "./handlers/mcp-servers";
import { handler as jobsHandler } from "./handlers/jobs";
import { handler as notificationsHandler } from "./handlers/notifications";

// Convert API Gateway v2 event to v1 format for handlers
function toV1Event(event: APIGatewayProxyEventV2): any {
  const method = event.requestContext.http.method;
  const path = event.rawPath;

  // Extract path parameters
  const pathParts = path.split("/").filter(Boolean);
  let resource = path;
  const pathParameters: Record<string, string> = {};

  // Match patterns like /agents/uuid -> /agents/{id}
  if (pathParts.length >= 2 && pathParts[1]?.match(/^[0-9a-f-]{36}$/i)) {
    pathParameters.id = pathParts[1];
    resource = `/${pathParts[0]}/{id}`;
    if (pathParts[2]) {
      resource += `/${pathParts[2]}`;
    }
  }

  return {
    httpMethod: method,
    resource,
    path,
    pathParameters: Object.keys(pathParameters).length ? pathParameters : null,
    body: event.body || null,
    headers: event.headers || {},
    requestContext: {
      authorizer: {
        claims: {
          sub: (event.requestContext as any).authorizer?.jwt?.claims?.sub,
          email: (event.requestContext as any).authorizer?.jwt?.claims?.email,
        },
      },
    },
  };
}

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const path = event.rawPath;
  const v1Event = toV1Event(event);

  try {
    if (path.startsWith("/auth")) {
      return await authHandler(v1Event) as any;
    }
    if (path.startsWith("/settings/api-key")) {
      return await apiKeyHandler(v1Event) as any;
    }
    if (path.startsWith("/agents")) {
      return await agentsHandler(v1Event) as any;
    }
    if (path.startsWith("/skills")) {
      return await skillsHandler(v1Event) as any;
    }
    if (path.startsWith("/mcp-servers")) {
      return await mcpServersHandler(v1Event) as any;
    }
    if (path.startsWith("/jobs")) {
      return await jobsHandler(v1Event) as any;
    }
    if (path.startsWith("/settings/notifications")) {
      return await notificationsHandler(v1Event) as any;
    }

    return { statusCode: 404, body: JSON.stringify({ error: "Not found" }) };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal error";
    console.error("API Error:", path, JSON.stringify(err instanceof Error ? { message: err.message, stack: err.stack } : err));
    return { statusCode: 500, body: JSON.stringify({ error: message }) };
  }
}
