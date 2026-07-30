import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { APIGatewayProxyEvent } from "aws-lambda";

function makeEvent(overrides: Partial<APIGatewayProxyEvent> = {}): APIGatewayProxyEvent {
  return {
    httpMethod: "GET",
    path: "/test",
    resource: "/test",
    pathParameters: null,
    body: null,
    headers: {},
    multiValueHeaders: {},
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    isBase64Encoded: false,
    stageVariables: null,
    requestContext: {
      authorizer: null,
    } as any,
    ...overrides,
  } as APIGatewayProxyEvent;
}

describe("getUserId", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    delete process.env.IS_LOCAL;
  });

  it("returns sub from Cognito claims", async () => {
    const { getUserId } = await import("../lib/common");
    const event = makeEvent({
      requestContext: {
        authorizer: { claims: { sub: "user-123" } },
      } as any,
    });
    expect(getUserId(event)).toBe("user-123");
  });

  it("rejects x-user-id header in production", async () => {
    process.env.IS_LOCAL = "false";
    const { getUserId } = await import("../lib/common");
    const event = makeEvent({
      headers: { "x-user-id": "attacker-id" },
    });
    expect(() => getUserId(event)).toThrow("Unauthorized");
  });

  it("allows x-user-id header when IS_LOCAL=true", async () => {
    process.env.IS_LOCAL = "true";
    const { getUserId } = await import("../lib/common");
    const event = makeEvent({
      headers: { "x-user-id": "local-user" },
    });
    expect(getUserId(event)).toBe("local-user");
  });

  it("throws when no identity is present", async () => {
    const { getUserId } = await import("../lib/common");
    const event = makeEvent();
    expect(() => getUserId(event)).toThrow("Unauthorized");
  });

  it("prefers Cognito claims over x-user-id header", async () => {
    process.env.IS_LOCAL = "true";
    const { getUserId } = await import("../lib/common");
    const event = makeEvent({
      headers: { "x-user-id": "header-user" },
      requestContext: {
        authorizer: { claims: { sub: "cognito-user" } },
      } as any,
    });
    expect(getUserId(event)).toBe("cognito-user");
  });
});

describe("jsonResponse", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    delete process.env.ALLOWED_ORIGIN;
  });

  it("returns correct status code and JSON body", async () => {
    const { jsonResponse } = await import("../lib/common");
    const res = jsonResponse(200, { data: "test" });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ data: "test" });
  });

  it("uses ALLOWED_ORIGIN env var for CORS", async () => {
    process.env.ALLOWED_ORIGIN = "https://example.com";
    const { jsonResponse } = await import("../lib/common");
    const res = jsonResponse(200, {});
    expect(res.headers?.["Access-Control-Allow-Origin"]).toBe("https://example.com");
  });

  it("defaults to * when ALLOWED_ORIGIN is not set", async () => {
    const { jsonResponse } = await import("../lib/common");
    const res = jsonResponse(200, {});
    expect(res.headers?.["Access-Control-Allow-Origin"]).toBe("*");
  });

  it("does not include x-user-id in allowed headers", async () => {
    const { jsonResponse } = await import("../lib/common");
    const res = jsonResponse(200, {});
    const allowHeaders = res.headers?.["Access-Control-Allow-Headers"] as string;
    expect(allowHeaders).not.toContain("x-user-id");
  });
});

describe("parseBody", () => {
  it("parses valid JSON body", async () => {
    const { parseBody } = await import("../lib/common");
    const event = makeEvent({ body: '{"name":"test"}' });
    expect(parseBody(event)).toEqual({ name: "test" });
  });

  it("throws on missing body", async () => {
    const { parseBody } = await import("../lib/common");
    const event = makeEvent({ body: null });
    expect(() => parseBody(event)).toThrow("Missing request body");
  });

  it("throws on invalid JSON", async () => {
    const { parseBody } = await import("../lib/common");
    const event = makeEvent({ body: "not json" });
    expect(() => parseBody(event)).toThrow();
  });
});

describe("getPathParam", () => {
  it("returns existing path parameter", async () => {
    const { getPathParam } = await import("../lib/common");
    const event = makeEvent({ pathParameters: { id: "abc-123" } });
    expect(getPathParam(event, "id")).toBe("abc-123");
  });

  it("throws on missing path parameter", async () => {
    const { getPathParam } = await import("../lib/common");
    const event = makeEvent({ pathParameters: null });
    expect(() => getPathParam(event, "id")).toThrow("Missing path parameter: id");
  });
});
