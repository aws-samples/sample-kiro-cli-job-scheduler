import { describe, it, expect, vi, beforeEach } from "vitest";
import type { APIGatewayProxyEventV2 } from "aws-lambda";

// Mock all handlers to isolate routing logic
vi.mock("../handlers/auth", () => ({ handler: vi.fn().mockResolvedValue({ statusCode: 200, body: '{"route":"auth"}' }) }));
vi.mock("../handlers/api-key", () => ({ handler: vi.fn().mockResolvedValue({ statusCode: 200, body: '{"route":"api-key"}' }) }));
vi.mock("../handlers/agents", () => ({ handler: vi.fn().mockResolvedValue({ statusCode: 200, body: '{"route":"agents"}' }) }));
vi.mock("../handlers/skills", () => ({ handler: vi.fn().mockResolvedValue({ statusCode: 200, body: '{"route":"skills"}' }) }));
vi.mock("../handlers/mcp-servers", () => ({ handler: vi.fn().mockResolvedValue({ statusCode: 200, body: '{"route":"mcp-servers"}' }) }));
vi.mock("../handlers/jobs", () => ({ handler: vi.fn().mockResolvedValue({ statusCode: 200, body: '{"route":"jobs"}' }) }));
vi.mock("../handlers/notifications", () => ({ handler: vi.fn().mockResolvedValue({ statusCode: 200, body: '{"route":"notifications"}' }) }));

import { handler } from "../router";

function makeV2Event(path: string, method = "GET"): APIGatewayProxyEventV2 {
  return {
    rawPath: path,
    body: undefined,
    headers: {},
    requestContext: {
      http: { method, path, protocol: "HTTP/1.1", sourceIp: "127.0.0.1", userAgent: "test" },
      accountId: "123",
      apiId: "test",
      domainName: "test",
      domainPrefix: "test",
      requestId: "test",
      routeKey: "ANY",
      stage: "$default",
      time: "",
      timeEpoch: 0,
      authorizer: { jwt: { claims: { sub: "user-1", email: "a@b.com" } } },
    },
    isBase64Encoded: false,
    routeKey: "ANY",
    version: "2.0",
  } as any;
}

describe("router", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("routes /auth to auth handler", async () => {
    const res = await handler(makeV2Event("/auth/me"));
    expect(JSON.parse(res.body as string).route).toBe("auth");
  });

  it("routes /settings/api-key to api-key handler", async () => {
    const res = await handler(makeV2Event("/settings/api-key", "PUT"));
    expect(JSON.parse(res.body as string).route).toBe("api-key");
  });

  it("routes /agents to agents handler", async () => {
    const res = await handler(makeV2Event("/agents"));
    expect(JSON.parse(res.body as string).route).toBe("agents");
  });

  it("routes /agents/:id to agents handler", async () => {
    const res = await handler(makeV2Event("/agents/550e8400-e29b-41d4-a716-446655440000"));
    expect(JSON.parse(res.body as string).route).toBe("agents");
  });

  it("routes /skills to skills handler", async () => {
    const res = await handler(makeV2Event("/skills"));
    expect(JSON.parse(res.body as string).route).toBe("skills");
  });

  it("routes /mcp-servers to mcp-servers handler", async () => {
    const res = await handler(makeV2Event("/mcp-servers"));
    expect(JSON.parse(res.body as string).route).toBe("mcp-servers");
  });

  it("routes /jobs to jobs handler", async () => {
    const res = await handler(makeV2Event("/jobs"));
    expect(JSON.parse(res.body as string).route).toBe("jobs");
  });

  it("routes /jobs/:id/executions to jobs handler", async () => {
    const res = await handler(makeV2Event("/jobs/550e8400-e29b-41d4-a716-446655440000/executions"));
    expect(JSON.parse(res.body as string).route).toBe("jobs");
  });

  it("routes /settings/notifications to notifications handler", async () => {
    const res = await handler(makeV2Event("/settings/notifications"));
    expect(JSON.parse(res.body as string).route).toBe("notifications");
  });

  it("returns 404 for unknown paths", async () => {
    const res = await handler(makeV2Event("/unknown"));
    expect(res.statusCode).toBe(404);
  });

  it("extracts UUID path parameters correctly", async () => {
    const { handler: agentsHandler } = await import("../handlers/agents");
    await handler(makeV2Event("/agents/550e8400-e29b-41d4-a716-446655440000", "GET"));
    expect(agentsHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        pathParameters: { id: "550e8400-e29b-41d4-a716-446655440000" },
        resource: "/agents/{id}",
      })
    );
  });

  it("extracts sub-resources after UUID", async () => {
    const { handler: jobsHandler } = await import("../handlers/jobs");
    await handler(makeV2Event("/jobs/550e8400-e29b-41d4-a716-446655440000/run", "POST"));
    expect(jobsHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        pathParameters: { id: "550e8400-e29b-41d4-a716-446655440000" },
        resource: "/jobs/{id}/run",
      })
    );
  });

  it("passes Cognito JWT claims as v1 authorizer claims", async () => {
    const { handler: authHandler } = await import("../handlers/auth");
    await handler(makeV2Event("/auth/me"));
    expect(authHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        requestContext: {
          authorizer: {
            claims: { sub: "user-1", email: "a@b.com" },
          },
        },
      })
    );
  });
});
