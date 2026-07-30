import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { GetCommand, PutCommand, DeleteCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { SchedulerClient, CreateScheduleCommand, UpdateScheduleCommand, DeleteScheduleCommand, GetScheduleCommand } from "@aws-sdk/client-scheduler";
import { v4 as uuid } from "uuid";
import { CreateJobSchema } from "@kiro-scheduler/shared";
import { ddb, TABLES, getUserId, jsonResponse, parseBody, getPathParam } from "../lib/common";

const scheduler = new SchedulerClient({ region: process.env.AWS_REGION });
const DISPATCHER_ARN = process.env.DISPATCHER_LAMBDA_ARN ?? "";
const SCHEDULER_ROLE_ARN = process.env.SCHEDULER_ROLE_ARN ?? "";

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  if (event.httpMethod === "OPTIONS") return jsonResponse(200, {});

  try {
    const userId = getUserId(event);
    const method = event.httpMethod;
    const path = event.resource;

    if (method === "GET" && path === "/jobs") return await list(userId);
    if (method === "POST" && path === "/jobs") return await create(userId, event);
    if (method === "GET" && path === "/jobs/{id}") return await get(userId, event);
    if (method === "PUT" && path === "/jobs/{id}") return await update(userId, event);
    if (method === "DELETE" && path === "/jobs/{id}") return await remove(userId, event);
    if (method === "POST" && path === "/jobs/{id}/run") return await runNow(userId, event);
    if (method === "GET" && path === "/jobs/{id}/executions") return await listExecutions(event);

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
    TableName: TABLES.jobs,
    KeyConditionExpression: "userId = :uid",
    ExpressionAttributeValues: { ":uid": userId },
  }));
  return jsonResponse(200, { data: result.Items ?? [], count: result.Count ?? 0 });
}

async function create(userId: string, event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const input = CreateJobSchema.parse(parseBody(event));
  const now = new Date().toISOString();
  const jobId = uuid();
  const item = { ...input, jobId, userId, createdAt: now, updatedAt: now };

  await ddb.send(new PutCommand({ TableName: TABLES.jobs, Item: item }));

  if (input.enabled) {
    await createOrUpdateSchedule(jobId, userId, input.cronExpression, true, input.timezone);
  }

  return jsonResponse(201, { data: item });
}

async function get(userId: string, event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const jobId = getPathParam(event, "id");
  const result = await ddb.send(new GetCommand({ TableName: TABLES.jobs, Key: { userId, jobId } }));
  if (!result.Item) throw new Error("Not found");
  return jsonResponse(200, { data: result.Item });
}

async function update(userId: string, event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const jobId = getPathParam(event, "id");
  const input = CreateJobSchema.parse(parseBody(event));

  const existing = await ddb.send(new GetCommand({ TableName: TABLES.jobs, Key: { userId, jobId } }));
  if (!existing.Item) throw new Error("Not found");

  const item = { ...existing.Item, ...input, updatedAt: new Date().toISOString() };
  await ddb.send(new PutCommand({ TableName: TABLES.jobs, Item: item }));

  await createOrUpdateSchedule(jobId, userId, input.cronExpression, input.enabled, input.timezone);

  return jsonResponse(200, { data: item });
}

async function remove(userId: string, event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const jobId = getPathParam(event, "id");
  await ddb.send(new DeleteCommand({ TableName: TABLES.jobs, Key: { userId, jobId } }));
  await deleteSchedule(jobId);
  return jsonResponse(204, {});
}

async function runNow(userId: string, event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const jobId = getPathParam(event, "id");
  const existing = await ddb.send(new GetCommand({ TableName: TABLES.jobs, Key: { userId, jobId } }));
  if (!existing.Item) throw new Error("Not found");

  // Import Lambda client dynamically to invoke dispatcher
  const { LambdaClient, InvokeCommand } = await import("@aws-sdk/client-lambda");
  const lambda = new LambdaClient({ region: process.env.AWS_REGION });
  const payload = JSON.stringify({ jobId, userId, triggerType: "manual" });

  await lambda.send(new InvokeCommand({
    FunctionName: DISPATCHER_ARN,
    InvocationType: "Event", // async
    Payload: Buffer.from(payload),
  }));

  return jsonResponse(202, { data: { message: "Job triggered", jobId } });
}

async function listExecutions(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const jobId = getPathParam(event, "id");
  const result = await ddb.send(new QueryCommand({
    TableName: TABLES.executions,
    KeyConditionExpression: "jobId = :jid",
    ExpressionAttributeValues: { ":jid": jobId },
    ScanIndexForward: false,
    Limit: 20,
  }));
  return jsonResponse(200, { data: result.Items ?? [], count: result.Count ?? 0 });
}

// ─── EventBridge Scheduler helpers ───────────────────────────────────────────

function scheduleName(jobId: string): string {
  return `kiro-job-${jobId}`;
}

async function createOrUpdateSchedule(jobId: string, userId: string, cron: string, enabled: boolean, timezone?: string): Promise<void> {
  if (!DISPATCHER_ARN || !SCHEDULER_ROLE_ARN) return; // skip in local mode

  const name = scheduleName(jobId);
  const scheduleExpression = toAwsCronExpression(cron);
  const input = {
    Name: name,
    ScheduleExpression: scheduleExpression,
    ScheduleExpressionTimezone: timezone || "Asia/Shanghai",
    State: enabled ? "ENABLED" as const : "DISABLED" as const,
    FlexibleTimeWindow: { Mode: "OFF" as const },
    Target: {
      Arn: DISPATCHER_ARN,
      RoleArn: SCHEDULER_ROLE_ARN,
      Input: JSON.stringify({ jobId, userId, triggerType: "scheduled" }),
    },
  };

  try {
    await scheduler.send(new GetScheduleCommand({ Name: name }));
    await scheduler.send(new UpdateScheduleCommand(input));
  } catch {
    await scheduler.send(new CreateScheduleCommand(input));
  }
}

async function deleteSchedule(jobId: string): Promise<void> {
  if (!DISPATCHER_ARN) return;
  try {
    await scheduler.send(new DeleteScheduleCommand({ Name: scheduleName(jobId) }));
  } catch (err: unknown) {
    const code = (err as { name?: string }).name;
    if (code === "ResourceNotFoundException") return;
    throw err;
  }
}

/**
 * Converts standard 5-field cron (min hour dom month dow) to AWS EventBridge 6-field format.
 * AWS format: cron(min hour dom month dow year)
 * - Adds wildcard year field
 * - Replaces day-of-week with ? if day-of-month is specified (and vice versa) to avoid conflict
 */
function toAwsCronExpression(cron: string): string {
  const parts = cron.trim().split(/\s+/);
  if (parts.length === 6) {
    // Already 6-field (user provided AWS format directly)
    return `cron(${parts.join(" ")})`;
  }
  if (parts.length !== 5) {
    throw new Error(`Invalid cron expression: expected 5 or 6 fields, got ${parts.length}`);
  }

  const [minute, hour, dom, month, dow] = parts;

  // AWS requires exactly one of day-of-month or day-of-week to be '?'
  let awsDom = dom;
  let awsDow = dow;
  if (dom !== "*" && dom !== "?") {
    awsDow = "?";
  } else if (dow !== "*" && dow !== "?") {
    awsDom = "?";
  } else {
    // Both are *, set dow to ?
    awsDow = "?";
  }

  return `cron(${minute} ${hour} ${awsDom} ${month} ${awsDow} *)`;
}
