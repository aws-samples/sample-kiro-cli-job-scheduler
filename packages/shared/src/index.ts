import { z } from "zod";

// ─── Notification Channels ───────────────────────────────────────────────────

export const LarkChannelSchema = z.object({
  type: z.literal("lark"),
  id: z.string().min(1),
  webhookUrl: z.string().url(),
  name: z.string().min(1).max(100),
  secret: z.string().max(200).optional(),
});

export const TelegramChannelSchema = z.object({
  type: z.literal("telegram"),
  id: z.string().min(1),
  botToken: z.string().min(1),
  chatId: z.string().min(1),
  name: z.string().min(1).max(100),
});

export const NotificationChannelSchema = z.discriminatedUnion("type", [
  LarkChannelSchema,
  TelegramChannelSchema,
]);

export type LarkChannel = z.infer<typeof LarkChannelSchema>;
export type TelegramChannel = z.infer<typeof TelegramChannelSchema>;
export type NotificationChannel = z.infer<typeof NotificationChannelSchema>;

// ─── Per-job notification resolution ─────────────────────────────────────────

/**
 * How a job selects notification channels from the user's global channel pool:
 * - "inherit": use ALL global channels (default; backward compatible)
 * - "select":  use only the channels whose id is in notificationChannelIds
 * - "none":    send no notifications
 */
export const NotificationMode = z.enum(["inherit", "select", "none"]);
export type NotificationModeType = z.infer<typeof NotificationMode>;

/**
 * Resolves the effective set of channels for a job given the global channel pool,
 * the job's notification mode, and its selected channel ids. Pure function shared
 * by the notify-lark and notify-telegram Lambdas so the semantics stay identical.
 */
export function resolveJobChannels<T extends { id?: string }>(
  allChannels: T[],
  mode: NotificationModeType | undefined,
  selectedIds: string[] | undefined,
): T[] {
  const effectiveMode: NotificationModeType = mode ?? "inherit";
  if (effectiveMode === "none") return [];
  if (effectiveMode === "select") {
    const ids = new Set(selectedIds ?? []);
    return allChannels.filter((ch) => ch.id !== undefined && ids.has(ch.id));
  }
  return allChannels; // inherit
}

// ─── User ────────────────────────────────────────────────────────────────────

export const UserSchema = z.object({
  userId: z.string().uuid(),
  email: z.string().email(),
  hasApiKey: z.boolean().default(false),
  notificationChannels: z.array(NotificationChannelSchema).default([]),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type User = z.infer<typeof UserSchema>;

// ─── Skill ───────────────────────────────────────────────────────────────────

export const CreateSkillSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500),
  content: z.string().min(1).max(50000),
});

export const SkillSchema = CreateSkillSchema.extend({
  skillId: z.string().uuid(),
  userId: z.string().uuid(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type Skill = z.infer<typeof SkillSchema>;
export type CreateSkillInput = z.infer<typeof CreateSkillSchema>;
export type UpdateSkillInput = CreateSkillInput;

// ─── MCP Server ──────────────────────────────────────────────────────────────

export const McpServerStdioSchema = z.object({
  type: z.literal("stdio"),
  name: z.string().min(1).max(100),
  description: z.string().max(500).default(""),
  command: z.string().min(1),
  args: z.array(z.string()).default([]),
  env: z.record(z.string()).default({}),
});

export const McpServerHttpSchema = z.object({
  type: z.literal("http"),
  name: z.string().min(1).max(100),
  description: z.string().max(500).default(""),
  url: z.string().url(),
  headers: z.record(z.string()).default({}),
});

export const CreateMcpServerSchema = z.discriminatedUnion("type", [
  McpServerStdioSchema,
  McpServerHttpSchema,
]);

export const McpServerSchema = z.object({
  mcpServerId: z.string().uuid(),
  userId: z.string().uuid(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
}).and(CreateMcpServerSchema);

export type McpServerConfig = z.infer<typeof McpServerSchema>;
export type CreateMcpServerInput = z.infer<typeof CreateMcpServerSchema>;
export type UpdateMcpServerInput = CreateMcpServerInput;

// ─── Agent Config ────────────────────────────────────────────────────────────

export const AVAILABLE_TOOLS = [
  "fs_read", "fs_write", "execute_bash", "grep", "glob", "code",
  "web_search", "web_fetch", "use_aws", "knowledge", "subagent",
] as const;

export const CreateAgentConfigSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).default(""),
  prompt: z.string().min(1).max(100000),
  model: z.string().max(100).optional(),
  tools: z.array(z.string()).default(["*"]),
  allowedTools: z.array(z.string()).default(["*"]),
  skillIds: z.array(z.string().uuid()).default([]),
  mcpServerIds: z.array(z.string().uuid()).default([]),
});

export const AgentConfigSchema = CreateAgentConfigSchema.extend({
  agentId: z.string().min(1),
  userId: z.string().uuid(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type AgentConfig = z.infer<typeof AgentConfigSchema>;
export type CreateAgentConfigInput = z.infer<typeof CreateAgentConfigSchema>;
export type UpdateAgentConfigInput = CreateAgentConfigInput;

// ─── Job ─────────────────────────────────────────────────────────────────────

export const CreateJobSchema = z.object({
  name: z.string().min(1).max(200),
  prompt: z.string().min(1).max(100000),
  agentId: z.string().min(1),
  cronExpression: z.string().min(1).max(100),
  timezone: z.string().max(50).default("Asia/Shanghai"),
  enabled: z.boolean().default(true),
  notificationMode: NotificationMode.default("inherit"),
  notificationChannelIds: z.array(z.string()).default([]),
});

export const JobSchema = CreateJobSchema.extend({
  jobId: z.string().uuid(),
  userId: z.string().uuid(),
  lastRunAt: z.string().datetime().optional(),
  lastStatus: z.enum(["succeeded", "failed"]).optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type Job = z.infer<typeof JobSchema>;
export type CreateJobInput = z.infer<typeof CreateJobSchema>;
export type UpdateJobInput = CreateJobInput;

// ─── Execution Log ───────────────────────────────────────────────────────────

export const ExecutionStatus = z.enum(["running", "succeeded", "failed"]);
export const TriggerType = z.enum(["scheduled", "manual"]);

export const ExecutionLogSchema = z.object({
  executionId: z.string().uuid(),
  jobId: z.string().uuid(),
  userId: z.string().uuid(),
  status: ExecutionStatus,
  triggerType: TriggerType,
  startTime: z.string().datetime(),
  endTime: z.string().datetime().optional(),
  outputS3Key: z.string().optional(),
  exitCode: z.number().int().optional(),
  error: z.string().optional(),
});

export type ExecutionLog = z.infer<typeof ExecutionLogSchema>;
export type ExecutionStatusType = z.infer<typeof ExecutionStatus>;
export type TriggerTypeType = z.infer<typeof TriggerType>;

// ─── Agent JSON Generation (for Kiro CLI) ────────────────────────────────────

export interface KiroAgentJson {
  name: string;
  description?: string;
  prompt: string;
  model?: string;
  tools: string[];
  allowedTools: string[];
  resources?: string[];
  mcpServers?: Record<string, KiroMcpServerEntry>;
}

export interface KiroMcpServerEntry {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
}

// ─── API Response Types ──────────────────────────────────────────────────────

export interface ApiResponse<T> {
  data: T;
}

export interface ApiListResponse<T> {
  data: T[];
  count: number;
}

export interface ApiErrorResponse {
  error: string;
  message: string;
}
