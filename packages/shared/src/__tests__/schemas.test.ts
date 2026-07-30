import { describe, it, expect } from "vitest";
import {
  CreateSkillSchema,
  CreateMcpServerSchema,
  CreateAgentConfigSchema,
  CreateJobSchema,
  NotificationChannelSchema,
  resolveJobChannels,
} from "../index";

describe("CreateSkillSchema", () => {
  it("validates a valid skill", () => {
    const result = CreateSkillSchema.safeParse({
      name: "code-review",
      description: "Code review guidelines",
      content: "---\nname: code-review\ndescription: Review guidelines\n---\n# Guidelines",
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty name", () => {
    const result = CreateSkillSchema.safeParse({ name: "", description: "", content: "x" });
    expect(result.success).toBe(false);
  });
});

describe("CreateMcpServerSchema", () => {
  it("validates stdio server", () => {
    const result = CreateMcpServerSchema.safeParse({
      type: "stdio",
      name: "github",
      command: "mcp-server-github",
      args: ["--stdio"],
      env: { GITHUB_TOKEN: "$GITHUB_TOKEN" },
    });
    expect(result.success).toBe(true);
  });

  it("validates http server", () => {
    const result = CreateMcpServerSchema.safeParse({
      type: "http",
      name: "remote-api",
      url: "https://mcp.example.com/sse",
      headers: { Authorization: "Bearer token" },
    });
    expect(result.success).toBe(true);
  });

  it("rejects stdio without command", () => {
    const result = CreateMcpServerSchema.safeParse({ type: "stdio", name: "x" });
    expect(result.success).toBe(false);
  });
});

describe("CreateAgentConfigSchema", () => {
  it("validates a full agent config", () => {
    const result = CreateAgentConfigSchema.safeParse({
      name: "daily-reporter",
      description: "Reports daily status",
      prompt: "You are a daily reporter...",
      model: "claude-sonnet-4",
      tools: ["fs_read", "grep"],
      skillIds: ["550e8400-e29b-41d4-a716-446655440000"],
      mcpServerIds: [],
    });
    expect(result.success).toBe(true);
  });

  it("applies defaults", () => {
    const result = CreateAgentConfigSchema.parse({ name: "minimal", prompt: "Hello" });
    expect(result.tools).toEqual(["*"]);
    expect(result.allowedTools).toEqual(["*"]);
    expect(result.skillIds).toEqual([]);
  });
});

describe("CreateJobSchema", () => {
  it("validates a job", () => {
    const result = CreateJobSchema.safeParse({
      name: "Daily Review",
      prompt: "Review yesterday's code changes",
      agentId: "550e8400-e29b-41d4-a716-446655440000",
      cronExpression: "0 9 * * MON-FRI",
      enabled: true,
    });
    expect(result.success).toBe(true);
  });

  it("defaults notification mode to inherit and channel ids to empty", () => {
    const result = CreateJobSchema.parse({
      name: "Daily Review",
      prompt: "Review yesterday's code changes",
      agentId: "550e8400-e29b-41d4-a716-446655440000",
      cronExpression: "0 9 * * MON-FRI",
    });
    expect(result.notificationMode).toBe("inherit");
    expect(result.notificationChannelIds).toEqual([]);
  });

  it("accepts string channel ids and a select mode", () => {
    const result = CreateJobSchema.safeParse({
      name: "Selective",
      prompt: "do things",
      agentId: "550e8400-e29b-41d4-a716-446655440000",
      cronExpression: "0 9 * * *",
      notificationMode: "select",
      notificationChannelIds: ["ch-1", "ch-2"],
    });
    expect(result.success).toBe(true);
  });

  it("rejects an invalid notification mode", () => {
    const result = CreateJobSchema.safeParse({
      name: "Bad",
      prompt: "x",
      agentId: "550e8400-e29b-41d4-a716-446655440000",
      cronExpression: "0 9 * * *",
      notificationMode: "everyone",
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing agentId", () => {
    const result = CreateJobSchema.safeParse({
      name: "Test",
      prompt: "Hello",
      cronExpression: "0 9 * * *",
    });
    expect(result.success).toBe(false);
  });
});

describe("NotificationChannelSchema", () => {
  it("validates lark channel", () => {
    const result = NotificationChannelSchema.safeParse({
      type: "lark",
      id: "ch-1",
      name: "Dev Team",
      webhookUrl: "https://open.larksuite.com/open-apis/bot/v2/hook/abc123",
    });
    expect(result.success).toBe(true);
  });

  it("validates telegram channel", () => {
    const result = NotificationChannelSchema.safeParse({
      type: "telegram",
      id: "ch-2",
      name: "Alerts",
      botToken: "123456:ABC-DEF",
      chatId: "-100123456",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a channel without an id", () => {
    const result = NotificationChannelSchema.safeParse({
      type: "lark",
      name: "No Id",
      webhookUrl: "https://open.larksuite.com/open-apis/bot/v2/hook/abc123",
    });
    expect(result.success).toBe(false);
  });
});

describe("resolveJobChannels", () => {
  const channels = [
    { id: "a", type: "lark" },
    { id: "b", type: "telegram" },
    { id: "c", type: "lark" },
  ];

  it("inherit returns all channels", () => {
    expect(resolveJobChannels(channels, "inherit", [])).toEqual(channels);
  });

  it("undefined mode is treated as inherit (backward compatible)", () => {
    expect(resolveJobChannels(channels, undefined, undefined)).toEqual(channels);
  });

  it("none returns no channels", () => {
    expect(resolveJobChannels(channels, "none", ["a", "b"])).toEqual([]);
  });

  it("select returns only the chosen channels", () => {
    expect(resolveJobChannels(channels, "select", ["a", "c"])).toEqual([
      { id: "a", type: "lark" },
      { id: "c", type: "lark" },
    ]);
  });

  it("select with no ids returns nothing", () => {
    expect(resolveJobChannels(channels, "select", [])).toEqual([]);
  });

  it("select ignores ids that don't match any channel", () => {
    expect(resolveJobChannels(channels, "select", ["a", "zzz"])).toEqual([{ id: "a", type: "lark" }]);
  });
});
