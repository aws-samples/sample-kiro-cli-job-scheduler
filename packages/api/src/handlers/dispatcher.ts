import { GetCommand, PutCommand, BatchGetCommand } from "@aws-sdk/lib-dynamodb";
import { ECSClient, RunTaskCommand } from "@aws-sdk/client-ecs";
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { v4 as uuid } from "uuid";
import type { KiroAgentJson, KiroMcpServerEntry } from "@kiro-scheduler/shared";
import { ddb, TABLES } from "../lib/common";

const ecs = new ECSClient({ region: process.env.AWS_REGION });
const sm = new SecretsManagerClient({ region: process.env.AWS_REGION });
const s3 = new S3Client({ region: process.env.AWS_REGION });

const CLUSTER_ARN = process.env.CLUSTER_ARN ?? "";
const TASK_DEF_ARN = process.env.TASK_DEF_ARN ?? "";
const SUBNET_IDS = (process.env.SUBNET_IDS ?? "").split(",").filter(Boolean);
const S3_OUTPUT_BUCKET = process.env.S3_OUTPUT_BUCKET ?? "";
const SNS_TOPIC_ARN = process.env.SNS_TOPIC_ARN ?? "";

interface DispatchEvent {
  jobId: string;
  userId: string;
  triggerType: "scheduled" | "manual";
}

export async function handler(event: DispatchEvent): Promise<{ executionId: string }> {
  const { jobId, userId, triggerType } = event;

  // 1. Fetch job
  const jobResult = await ddb.send(new GetCommand({ TableName: TABLES.jobs, Key: { userId, jobId } }));
  const job = jobResult.Item;
  if (!job) throw new Error(`Job ${jobId} not found`);

  // 2. Fetch agent config (or use built-in defaults)
  const BUILTIN_AGENTS: Record<string, string> = {
    "default-kiro": "kiro_default",
    "default-planner": "kiro_planner",
  };

  let agent: Record<string, unknown>;
  let builtinAgentName: string | null = null;

  if (BUILTIN_AGENTS[job.agentId]) {
    builtinAgentName = BUILTIN_AGENTS[job.agentId];
    agent = { name: builtinAgentName, prompt: "", tools: ["*"], allowedTools: ["*"], skillIds: [], mcpServerIds: [] };
  } else {
    const agentResult = await ddb.send(new GetCommand({
      TableName: TABLES.agents,
      Key: { userId, agentId: job.agentId },
    }));
    agent = agentResult.Item as Record<string, unknown>;
    if (!agent) throw new Error(`Agent ${job.agentId} not found`);
  }

  // 3. Fetch referenced skills
  const skills: Array<{ name: string; content: string }> = [];
  if (agent.skillIds?.length) {
    const keys = agent.skillIds.map((skillId: string) => ({ userId, skillId }));
    const result = await ddb.send(new BatchGetCommand({
      RequestItems: { [TABLES.skills]: { Keys: keys } },
    }));
    const items = result.Responses?.[TABLES.skills] ?? [];
    for (const s of items) {
      skills.push({ name: s.name, content: s.content });
    }
  }

  // 4. Fetch referenced MCP servers
  const mcpServers: Record<string, KiroMcpServerEntry> = {};
  if (agent.mcpServerIds?.length) {
    const keys = agent.mcpServerIds.map((mcpServerId: string) => ({ userId, mcpServerId }));
    const result = await ddb.send(new BatchGetCommand({
      RequestItems: { [TABLES.mcpServers]: { Keys: keys } },
    }));
    const items = result.Responses?.[TABLES.mcpServers] ?? [];
    for (const m of items) {
      if (m.type === "stdio") {
        mcpServers[m.name] = { command: m.command, args: m.args ?? [], env: m.env ?? {} };
      } else {
        mcpServers[m.name] = { url: m.url, headers: m.headers ?? {} };
      }
    }
  }

  // 5. Generate Kiro agent JSON
  const agentJson: KiroAgentJson = {
    name: "job-agent",
    description: agent.description,
    prompt: agent.prompt,
    model: agent.model,
    tools: agent.tools ?? ["*"],
    allowedTools: agent.allowedTools ?? ["*"],
    resources: skills.length
      ? skills.map((s) => `skill://.kiro/skills/${s.name}/SKILL.md`)
      : undefined,
    mcpServers: Object.keys(mcpServers).length ? mcpServers : undefined,
  };

  const jobConfig = JSON.stringify({ agentConfig: agentJson, skills });

  // 6. Verify user's KIRO_API_KEY exists (actual value injected via ECS secrets)
  const secretArn = `arn:aws:secretsmanager:${process.env.AWS_REGION}:${process.env.AWS_ACCOUNT_ID}:secret:kiro-scheduler/users/${userId}/api-key`;
  try {
    await sm.send(new GetSecretValueCommand({ SecretId: `kiro-scheduler/users/${userId}/api-key` }));
  } catch {
    throw new Error("User has no KIRO_API_KEY configured");
  }

  // 7. Create execution record
  const executionId = uuid();
  const now = new Date().toISOString();
  await ddb.send(new PutCommand({
    TableName: TABLES.executions,
    Item: {
      executionId,
      jobId,
      userId,
      status: "running",
      triggerType,
      startTime: now,
    },
  }));

  // Upload config to S3 to avoid ECS container overrides 8192-byte limit
  const configKey = `configs/${executionId}.json`;
  await s3.send(new PutObjectCommand({
    Bucket: S3_OUTPUT_BUCKET,
    Key: configKey,
    Body: jobConfig,
  }));

  // 8. Launch ECS Fargate task
  await ecs.send(new RunTaskCommand({
    cluster: CLUSTER_ARN,
    taskDefinition: TASK_DEF_ARN,
    launchType: "FARGATE",
    networkConfiguration: {
      awsvpcConfiguration: {
        subnets: SUBNET_IDS,
        assignPublicIp: "ENABLED",
        securityGroups: (process.env.SECURITY_GROUP_IDS ?? "").split(",").filter(Boolean),
      },
    },
    overrides: {
      containerOverrides: [{
        name: "runner",
        environment: [
          { name: "JOB_ID", value: jobId },
          { name: "EXECUTION_ID", value: executionId },
          { name: "USER_ID", value: userId },
          { name: "PROMPT", value: job.prompt },
          { name: "JOB_CONFIG_S3_KEY", value: configKey },
          { name: "JOB_CONFIG_S3_BUCKET", value: S3_OUTPUT_BUCKET },
          { name: "S3_OUTPUT_BUCKET", value: S3_OUTPUT_BUCKET },
          { name: "EXECUTIONS_TABLE", value: TABLES.executions },
          { name: "SNS_TOPIC_ARN", value: SNS_TOPIC_ARN },
          // KIRO_API_KEY injected via KIRO_API_KEY_SECRET_ARN
          { name: "KIRO_API_KEY_SECRET_ARN", value: secretArn },
          ...(builtinAgentName ? [{ name: "BUILTIN_AGENT", value: builtinAgentName }] : []),
        ],
      }],
    },
  }));

  return { executionId };
}
