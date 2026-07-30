import { describe, it, expect, vi, beforeEach } from "vitest";
import type { APIGatewayProxyEvent } from "aws-lambda";

// Mock AWS SDK clients — use vi.hoisted to avoid TDZ issues with vi.mock hoisting
const { mockDdbSend, mockSchedulerSend } = vi.hoisted(() => {
  process.env.IS_LOCAL = "true";
  process.env.DISPATCHER_LAMBDA_ARN = "arn:aws:lambda:us-east-1:123:function:dispatcher";
  process.env.SCHEDULER_ROLE_ARN = "arn:aws:iam::123:role/scheduler";
  return {
    mockDdbSend: vi.fn().mockResolvedValue({}),
    mockSchedulerSend: vi.fn().mockResolvedValue({}),
  };
});

vi.mock("@aws-sdk/client-dynamodb", () => ({
  DynamoDBClient: vi.fn().mockImplementation(() => ({})),
}));
vi.mock("@aws-sdk/lib-dynamodb", () => ({
  DynamoDBDocumentClient: { from: () => ({ send: mockDdbSend }) },
  GetCommand: vi.fn().mockImplementation((input) => ({ _type: "Get", input })),
  PutCommand: vi.fn().mockImplementation((input) => ({ _type: "Put", input })),
  DeleteCommand: vi.fn().mockImplementation((input) => ({ _type: "Delete", input })),
  QueryCommand: vi.fn().mockImplementation((input) => ({ _type: "Query", input })),
}));
vi.mock("@aws-sdk/client-scheduler", () => ({
  SchedulerClient: vi.fn().mockImplementation(() => ({ send: mockSchedulerSend })),
  CreateScheduleCommand: vi.fn().mockImplementation((input) => ({ _type: "CreateSchedule", input })),
  UpdateScheduleCommand: vi.fn().mockImplementation((input) => ({ _type: "UpdateSchedule", input })),
  DeleteScheduleCommand: vi.fn().mockImplementation((input) => ({ _type: "DeleteSchedule", input })),
  GetScheduleCommand: vi.fn().mockImplementation((input) => ({ _type: "GetSchedule", input })),
}));
vi.mock("@aws-sdk/client-lambda", () => ({
  LambdaClient: vi.fn().mockImplementation(() => ({ send: vi.fn() })),
  InvokeCommand: vi.fn(),
}));

import { handler } from "../handlers/jobs";

function makeEvent(overrides: Partial<APIGatewayProxyEvent> = {}): APIGatewayProxyEvent {
  return {
    httpMethod: "GET",
    path: "/jobs",
    resource: "/jobs",
    pathParameters: null,
    body: null,
    headers: { "x-user-id": "user-123" },
    multiValueHeaders: {},
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    isBase64Encoded: false,
    stageVariables: null,
    requestContext: { authorizer: null } as any,
    ...overrides,
  } as APIGatewayProxyEvent;
}

describe("jobs handler", () => {
  beforeEach(() => {
    mockDdbSend.mockClear();
    mockDdbSend.mockResolvedValue({});
    mockSchedulerSend.mockClear();
    mockSchedulerSend.mockResolvedValue({});
  });

  describe("OPTIONS", () => {
    it("returns 200 for OPTIONS", async () => {
      const res = await handler(makeEvent({ httpMethod: "OPTIONS" }));
      expect(res.statusCode).toBe(200);
    });
  });

  describe("POST /jobs — create", () => {
    it("creates a job with valid input", async () => {
      const res = await handler(makeEvent({
        httpMethod: "POST",
        resource: "/jobs",
        body: JSON.stringify({
          name: "Daily Review",
          prompt: "Review code changes",
          agentId: "550e8400-e29b-41d4-a716-446655440000",
          cronExpression: "0 9 * * MON-FRI",
          enabled: true,
        }),
      }));

      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.body);
      expect(body.data.name).toBe("Daily Review");
      expect(body.data.userId).toBe("user-123");
      expect(body.data.jobId).toBeDefined();
    });

    it("rejects invalid input (missing required fields)", async () => {
      const res = await handler(makeEvent({
        httpMethod: "POST",
        resource: "/jobs",
        body: JSON.stringify({ name: "Test" }),
      }));

      expect(res.statusCode).toBe(500);
    });

    it("skips schedule creation when disabled", async () => {
      mockDdbSend.mockResolvedValueOnce({});

      await handler(makeEvent({
        httpMethod: "POST",
        resource: "/jobs",
        body: JSON.stringify({
          name: "Disabled Job",
          prompt: "test",
          agentId: "550e8400-e29b-41d4-a716-446655440000",
          cronExpression: "0 9 * * *",
          enabled: false,
        }),
      }));

      expect(mockSchedulerSend).not.toHaveBeenCalled();
    });
  });

  describe("GET /jobs — list", () => {
    it("returns jobs for the user", async () => {
      mockDdbSend.mockResolvedValueOnce({
        Items: [{ jobId: "j1", name: "Job 1" }],
        Count: 1,
      });

      const res = await handler(makeEvent({ httpMethod: "GET", resource: "/jobs" }));
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.data).toHaveLength(1);
      expect(body.count).toBe(1);
    });
  });

  describe("GET /jobs/{id}", () => {
    it("returns a job by id", async () => {
      mockDdbSend.mockResolvedValueOnce({ Item: { jobId: "j1", name: "My Job" } });

      const res = await handler(makeEvent({
        httpMethod: "GET",
        resource: "/jobs/{id}",
        pathParameters: { id: "j1" },
      }));
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body).data.name).toBe("My Job");
    });

    it("returns 404 when job not found", async () => {
      mockDdbSend.mockResolvedValueOnce({ Item: null });

      const res = await handler(makeEvent({
        httpMethod: "GET",
        resource: "/jobs/{id}",
        pathParameters: { id: "nonexistent" },
      }));
      expect(res.statusCode).toBe(404);
    });
  });

  describe("DELETE /jobs/{id}", () => {
    it("deletes job and schedule", async () => {
      mockDdbSend.mockResolvedValueOnce({}); // DeleteCommand
      mockSchedulerSend.mockResolvedValueOnce({}); // DeleteScheduleCommand

      const res = await handler(makeEvent({
        httpMethod: "DELETE",
        resource: "/jobs/{id}",
        pathParameters: { id: "j1" },
      }));
      expect(res.statusCode).toBe(204);
    });

    it("succeeds even when schedule does not exist (ResourceNotFoundException)", async () => {
      mockDdbSend.mockResolvedValueOnce({});
      const notFoundErr = new Error("Schedule not found");
      Object.defineProperty(notFoundErr, "name", { value: "ResourceNotFoundException" });
      mockSchedulerSend.mockRejectedValueOnce(notFoundErr);

      const res = await handler(makeEvent({
        httpMethod: "DELETE",
        resource: "/jobs/{id}",
        pathParameters: { id: "j1" },
      }));
      expect(res.statusCode).toBe(204);
    });

    it("propagates non-ResourceNotFoundException errors from deleteSchedule", async () => {
      mockDdbSend.mockResolvedValueOnce({});
      mockSchedulerSend.mockImplementationOnce(() => {
        const err = new Error("Access denied");
        Object.defineProperty(err, "name", { value: "AccessDeniedException" });
        return Promise.reject(err);
      });

      const res = await handler(makeEvent({
        httpMethod: "DELETE",
        resource: "/jobs/{id}",
        pathParameters: { id: "j1" },
      }));
      expect(mockSchedulerSend).toHaveBeenCalled();
      expect(res.statusCode).toBe(500);
    });
  });

  describe("cron expression conversion", () => {
    it("converts 5-field cron to AWS 6-field format", async () => {
      await handler(makeEvent({
        httpMethod: "POST",
        resource: "/jobs",
        body: JSON.stringify({
          name: "Test Cron",
          prompt: "test",
          agentId: "550e8400-e29b-41d4-a716-446655440000",
          cronExpression: "30 8 * * MON-FRI",
          enabled: true,
        }),
      }));

      // GetSchedule (index 0) succeeds → UpdateSchedule (index 1) is called
      const updateCall = mockSchedulerSend.mock.calls[1][0];
      expect(updateCall.input.ScheduleExpression).toBe("cron(30 8 ? * MON-FRI *)");
    });

    it("sets dow=? when dom is specified", async () => {
      await handler(makeEvent({
        httpMethod: "POST",
        resource: "/jobs",
        body: JSON.stringify({
          name: "Monthly",
          prompt: "test",
          agentId: "550e8400-e29b-41d4-a716-446655440000",
          cronExpression: "0 9 1 * *",
          enabled: true,
        }),
      }));

      const updateCall = mockSchedulerSend.mock.calls[1][0];
      expect(updateCall.input.ScheduleExpression).toBe("cron(0 9 1 * ? *)");
    });

    it("passes through 6-field cron unchanged", async () => {
      await handler(makeEvent({
        httpMethod: "POST",
        resource: "/jobs",
        body: JSON.stringify({
          name: "AWS Format",
          prompt: "test",
          agentId: "550e8400-e29b-41d4-a716-446655440000",
          cronExpression: "0 9 ? * MON *",
          enabled: true,
        }),
      }));

      const updateCall = mockSchedulerSend.mock.calls[1][0];
      expect(updateCall.input.ScheduleExpression).toBe("cron(0 9 ? * MON *)");
    });

    it("rejects invalid cron with wrong field count", async () => {
      const res = await handler(makeEvent({
        httpMethod: "POST",
        resource: "/jobs",
        body: JSON.stringify({
          name: "Bad Cron",
          prompt: "test",
          agentId: "550e8400-e29b-41d4-a716-446655440000",
          cronExpression: "0 9 *",
          enabled: true,
        }),
      }));

      expect(res.statusCode).toBe(500);
      expect(JSON.parse(res.body).message).toContain("Invalid cron expression");
    });
  });

  describe("routing — 404", () => {
    it("returns 404 for unknown method/path combo", async () => {
      const res = await handler(makeEvent({
        httpMethod: "PATCH",
        resource: "/jobs",
      }));
      expect(res.statusCode).toBe(404);
    });
  });

  describe("authentication", () => {
    it("returns 401 when no user identity", async () => {
      const res = await handler(makeEvent({
        headers: {},
        requestContext: { authorizer: null } as any,
      }));
      expect(res.statusCode).toBe(401);
    });
  });
});
