import type {
  AgentConfig, CreateAgentConfigInput, UpdateAgentConfigInput,
  Skill, CreateSkillInput, UpdateSkillInput,
  McpServerConfig, CreateMcpServerInput, UpdateMcpServerInput,
  Job, CreateJobInput, UpdateJobInput,
  ExecutionLog, User, NotificationChannel,
} from "@kiro-scheduler/shared";

const BASE_URL = process.env.NEXT_PUBLIC_API_URL!;

// ─── LocalStorage-backed store (used when API is unavailable) ────────────────

function localStore<T extends { [key: string]: unknown }>(key: string, idField: string) {
  const getAll = (): T[] => {
    if (typeof window === "undefined") return [];
    return JSON.parse(sessionStorage.getItem(`store_${key}`) || "[]");
  };
  const saveAll = (items: T[]) => sessionStorage.setItem(`store_${key}`, JSON.stringify(items));

  return {
    list: (): { data: T[]; count: number } => { const items = getAll(); return { data: items, count: items.length }; },
    get: (id: string): { data: T } => { const item = getAll().find((i) => i[idField] === id); if (!item) throw new Error("Not found"); return { data: item }; },
    create: (data: Partial<T>): { data: T } => {
      const item = { ...data, [idField]: crypto.randomUUID(), userId: "local", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } as unknown as T;
      const items = getAll(); items.push(item); saveAll(items); return { data: item };
    },
    update: (id: string, data: Partial<T>): { data: T } => {
      const items = getAll(); const idx = items.findIndex((i) => i[idField] === id);
      if (idx === -1) throw new Error("Not found");
      items[idx] = { ...items[idx], ...data, updatedAt: new Date().toISOString() }; saveAll(items); return { data: items[idx] };
    },
    delete: (id: string): void => { const items = getAll().filter((i) => i[idField] !== id); saveAll(items); },
  };
}

const localAgents = localStore<AgentConfig>("agents", "agentId");
const localSkills = localStore<Skill>("skills", "skillId");
const localMcpServers = localStore<McpServerConfig>("mcp-servers", "mcpServerId");
const localJobs = localStore<Job>("jobs", "jobId");

// ─── Remote API client ───────────────────────────────────────────────────────

let useLocalMode = false;

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  if (useLocalMode) throw new Error("local-mode");

  let token: string | null = null;
  try {
    const { Amplify } = await import("aws-amplify");
    const { fetchAuthSession } = await import("aws-amplify/auth");
    // Ensure configured
    try { Amplify.getConfig(); } catch {
      Amplify.configure({ Auth: { Cognito: { userPoolId: process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID!, userPoolClientId: process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID! } } });
    }
    const session = await fetchAuthSession();
    token = session.tokens?.idToken?.toString() || null;
  } catch {
    token = null;
  }
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers,
      },
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: res.statusText }));
      throw new Error(err.message || res.statusText);
    }
    if (res.status === 204) return undefined as T;
    return res.json();
  } catch (e) {
    // Only switch to local mode on network errors (not auth errors)
    if (e instanceof TypeError && (e.message.includes("fetch") || e.message.includes("network"))) {
      useLocalMode = true;
    }
    throw e;
  }
}

// ─── Exported API (falls back to sessionStorage when API unavailable) ──────────

export const api = {
  auth: {
    me: async () => ({ data: { userId: "local", email: "local@dev" } as User }),
  },
  agents: {
    list: async () => { try { return await request<{ data: AgentConfig[]; count: number }>("/agents"); } catch { return localAgents.list(); } },
    get: async (id: string) => { try { return await request<{ data: AgentConfig }>(`/agents/${id}`); } catch { return localAgents.get(id); } },
    create: async (data: CreateAgentConfigInput) => { try { return await request<{ data: AgentConfig }>("/agents", { method: "POST", body: JSON.stringify(data) }); } catch { return localAgents.create(data) as { data: AgentConfig }; } },
    update: async (id: string, data: UpdateAgentConfigInput) => { try { return await request<{ data: AgentConfig }>(`/agents/${id}`, { method: "PUT", body: JSON.stringify(data) }); } catch { return localAgents.update(id, data) as { data: AgentConfig }; } },
    delete: async (id: string) => { try { await request<void>(`/agents/${id}`, { method: "DELETE" }); } catch { localAgents.delete(id); } },
  },
  skills: {
    list: async () => { try { return await request<{ data: Skill[]; count: number }>("/skills"); } catch { return localSkills.list(); } },
    get: async (id: string) => { try { return await request<{ data: Skill }>(`/skills/${id}`); } catch { return localSkills.get(id); } },
    create: async (data: CreateSkillInput) => { try { return await request<{ data: Skill }>("/skills", { method: "POST", body: JSON.stringify(data) }); } catch { return localSkills.create(data) as { data: Skill }; } },
    update: async (id: string, data: UpdateSkillInput) => { try { return await request<{ data: Skill }>(`/skills/${id}`, { method: "PUT", body: JSON.stringify(data) }); } catch { return localSkills.update(id, data) as { data: Skill }; } },
    delete: async (id: string) => { try { await request<void>(`/skills/${id}`, { method: "DELETE" }); } catch { localSkills.delete(id); } },
  },
  mcpServers: {
    list: async () => { try { return await request<{ data: McpServerConfig[]; count: number }>("/mcp-servers"); } catch { return localMcpServers.list(); } },
    get: async (id: string) => { try { return await request<{ data: McpServerConfig }>(`/mcp-servers/${id}`); } catch { return localMcpServers.get(id); } },
    create: async (data: CreateMcpServerInput) => { try { return await request<{ data: McpServerConfig }>("/mcp-servers", { method: "POST", body: JSON.stringify(data) }); } catch { return localMcpServers.create(data) as { data: McpServerConfig }; } },
    update: async (id: string, data: UpdateMcpServerInput) => { try { return await request<{ data: McpServerConfig }>(`/mcp-servers/${id}`, { method: "PUT", body: JSON.stringify(data) }); } catch { return localMcpServers.update(id, data) as { data: McpServerConfig }; } },
    delete: async (id: string) => { try { await request<void>(`/mcp-servers/${id}`, { method: "DELETE" }); } catch { localMcpServers.delete(id); } },
  },
  jobs: {
    list: async () => { try { return await request<{ data: Job[]; count: number }>("/jobs"); } catch { return localJobs.list(); } },
    get: async (id: string) => { try { return await request<{ data: Job }>(`/jobs/${id}`); } catch { return localJobs.get(id); } },
    create: async (data: CreateJobInput) => { try { return await request<{ data: Job }>("/jobs", { method: "POST", body: JSON.stringify(data) }); } catch { return localJobs.create(data) as { data: Job }; } },
    update: async (id: string, data: UpdateJobInput) => { try { return await request<{ data: Job }>(`/jobs/${id}`, { method: "PUT", body: JSON.stringify(data) }); } catch { return localJobs.update(id, data) as { data: Job }; } },
    delete: async (id: string) => { try { await request<void>(`/jobs/${id}`, { method: "DELETE" }); } catch { localJobs.delete(id); } },
    run: async (id: string) => { try { return await request<{ data: ExecutionLog }>(`/jobs/${id}/run`, { method: "POST" }); } catch { return { data: { executionId: crypto.randomUUID(), jobId: id, status: "running" } as unknown as ExecutionLog }; } },
    executions: async (id: string) => { try { return await request<{ data: ExecutionLog[] }>(`/jobs/${id}/executions`); } catch { return { data: [] }; } },
  },
  settings: {
    getApiKey: async () => { try { return await request<{ data: { configured: boolean; masked: string | null } }>("/settings/api-key"); } catch { return { data: { configured: false, masked: null } }; } },
    updateApiKey: async (apiKey: string) => { try { await request<void>("/settings/api-key", { method: "PUT", body: JSON.stringify({ apiKey }) }); } catch { sessionStorage.setItem("kiro_api_key_configured", "true"); } },
    deleteApiKey: async () => { try { await request<void>("/settings/api-key", { method: "DELETE" }); } catch { sessionStorage.removeItem("kiro_api_key_configured"); } },
    getNotifications: async () => { try { return await request<{ data: NotificationChannel[] }>("/settings/notifications"); } catch { return { data: [] as NotificationChannel[] }; } },
    updateNotifications: async (channels: NotificationChannel[]) => { try { return await request<{ data: NotificationChannel[] }>("/settings/notifications", { method: "PUT", body: JSON.stringify({ channels }) }); } catch { return { data: channels }; } },
  },
};
