"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useToast } from "@/components/toast";
import { CreateAgentConfigSchema } from "@kiro-scheduler/shared";
import type { AgentConfig, Skill, McpServerConfig } from "@kiro-scheduler/shared";

const AVAILABLE_TOOLS = [
  { id: "*", label: "All tools (wildcard)" },
  { id: "fs_read", label: "fs_read — Read files" },
  { id: "fs_write", label: "fs_write — Write files" },
  { id: "execute_bash", label: "execute_bash — Run shell commands" },
  { id: "grep", label: "grep — Search file contents" },
  { id: "glob", label: "glob — Find files by pattern" },
  { id: "code", label: "code — Code intelligence (AST/LSP)" },
  { id: "web_search", label: "web_search — Search the web" },
  { id: "web_fetch", label: "web_fetch — Fetch URL content" },
  { id: "use_aws", label: "use_aws — AWS CLI operations" },
  { id: "knowledge", label: "knowledge — Knowledge base search" },
  { id: "subagent", label: "subagent — Spawn sub-agents" },
  { id: "todo_list", label: "todo_list — Task tracking" },
];

const DEFAULT_AGENTS: Partial<AgentConfig>[] = [
  { agentId: "default-kiro", name: "kiro_default", description: "Default Kiro agent with all tools and skills", prompt: "You are Kiro, an AI agent.", skillIds: [], mcpServerIds: [] },
  { agentId: "default-planner", name: "kiro_planner", description: "Specialized planning agent for breaking down ideas", prompt: "You are a planning specialist.", skillIds: [], mcpServerIds: [] },
];

interface AgentForm {
  name: string;
  description: string;
  prompt: string;
  model: string;
  tools: string[];
  allowedTools: string[];
  skillIds: string[];
  mcpServerIds: string[];
}

type CreateMode = "form" | "json";

export default function AgentsPage() {
  const { t } = useI18n();
  const toast = useToast();
  const [agents, setAgents] = useState<AgentConfig[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [mcpServers, setMcpServers] = useState<McpServerConfig[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [editingItem, setEditingItem] = useState<AgentConfig | null>(null);
  const [mode, setMode] = useState<CreateMode>("form");
  const [jsonInput, setJsonInput] = useState("");
  const [form, setForm] = useState<AgentForm>({ name: "", description: "", prompt: "", model: "", tools: ["*"], allowedTools: ["*"], skillIds: [], mcpServerIds: [] });

  useEffect(() => {
    api.agents.list().then((r) => setAgents(r.data)).catch(() => {});
    api.skills.list().then((r) => setSkills(r.data)).catch(() => {});
    api.mcpServers.list().then((r) => setMcpServers(r.data)).catch(() => {});
  }, []);

  const toggleTool = (list: "tools" | "allowedTools", tool: string) => {
    setForm((f) => {
      const current = f[list];
      if (tool === "*") return { ...f, [list]: current.includes("*") ? [] : ["*"] };
      const without = current.filter((t) => t !== "*" && t !== tool);
      return { ...f, [list]: current.includes(tool) ? without : [...without, tool] };
    });
  };

  const handleEdit = (agent: AgentConfig) => {
    setEditingItem(agent);
    setForm({ name: agent.name, description: agent.description || "", prompt: agent.prompt, model: agent.model || "", tools: agent.tools || ["*"], allowedTools: agent.allowedTools || ["*"], skillIds: agent.skillIds || [], mcpServerIds: agent.mcpServerIds || [] });
    setMode("form");
    setShowCreate(true);
  };

  const handleSubmit = async () => {
    if (mode === "json") {
      try {
        const parsed = JSON.parse(jsonInput);
        const result = CreateAgentConfigSchema.safeParse(parsed);
        if (!result.success) {
          const errors = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("\n");
          toast.error(`Validation failed:\n${errors}`);
          return;
        }
        const payload = result.data;
        if (editingItem) {
          const res = await api.agents.update(editingItem.agentId, payload);
          setAgents((prev) => prev.map((a) => a.agentId === editingItem.agentId ? res.data : a));
        } else {
          const res = await api.agents.create(payload);
          setAgents((prev) => [...prev, res.data]);
        }
        closeModal();
      } catch (e) { toast.error(`Invalid JSON: ${e instanceof Error ? e.message : e}`); }
      return;
    }
    if (!form.name || !form.prompt) return toast.error(t("agents.nameRequired"));
    if (editingItem) {
      const res = await api.agents.update(editingItem.agentId, { ...form, model: form.model || undefined, skillIds: form.skillIds, mcpServerIds: form.mcpServerIds });
      setAgents((prev) => prev.map((a) => a.agentId === editingItem.agentId ? res.data : a));
    } else {
      const res = await api.agents.create({ ...form, model: form.model || undefined, skillIds: form.skillIds, mcpServerIds: form.mcpServerIds });
      setAgents((prev) => [...prev, res.data]);
    }
    closeModal();
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm(t("agents.deleteConfirm"))) return;
    await api.agents.delete(id);
    setAgents((prev) => prev.filter((a) => a.agentId !== id));
  };

  const closeModal = () => {
    setShowCreate(false);
    setEditingItem(null);
    setJsonInput("");
    setForm({ name: "", description: "", prompt: "", model: "", tools: ["*"], allowedTools: ["*"], skillIds: [], mcpServerIds: [] });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{t("agents.title")}</h1>
        <button onClick={() => setShowCreate(true)} className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:opacity-90">{t("agents.create")}</button>
      </div>

      {showCreate && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 overflow-auto py-8" onClick={closeModal}>
          <div className="bg-card border rounded-lg p-6 w-full max-w-2xl space-y-4 max-h-[90vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">{editingItem ? t("common.edit") : t("agents.createTitle")}</h2>
              <div className="flex border rounded-md text-xs">
                <button onClick={() => setMode("form")} className={`px-3 py-1 ${mode === "form" ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}>{t("common.form")}</button>
                <button onClick={() => { setMode("json"); setJsonInput(JSON.stringify({ name: form.name, description: form.description, prompt: form.prompt, ...(form.model ? { model: form.model } : {}), tools: form.tools, allowedTools: form.allowedTools }, null, 2)); }} className={`px-3 py-1 ${mode === "json" ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}>{t("common.json")}</button>
              </div>
            </div>
            {mode === "json" ? (
              <div className="space-y-3">
                <p className="text-xs text-muted-foreground">{t("agents.jsonHint")}</p>
                <textarea value={jsonInput} onChange={(e) => setJsonInput(e.target.value)} rows={14} placeholder={`{\n  "name": "my-agent",\n  "description": "Agent description",\n  "prompt": "You are an expert in...",\n  "model": "claude-sonnet-4",\n  "tools": ["fs_read", "fs_write", "execute_bash"],\n  "allowedTools": ["fs_read", "grep"]\n}`} className="w-full px-3 py-2 border rounded-md bg-background text-sm font-mono" />
              </div>
            ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-sm font-medium">{t("common.name")} *</label>
                  <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="my-agent" className="w-full mt-1 px-3 py-2 border rounded-md bg-background text-sm" />
                </div>
                <div>
                  <label className="text-sm font-medium">{t("agents.model")}</label>
                  <input value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} placeholder="claude-sonnet-4 (optional)" className="w-full mt-1 px-3 py-2 border rounded-md bg-background text-sm" />
                </div>
              </div>
              <div>
                <label className="text-sm font-medium">{t("common.description")}</label>
                <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="What this agent does" className="w-full mt-1 px-3 py-2 border rounded-md bg-background text-sm" />
              </div>
              <div>
                <label className="text-sm font-medium">{t("agents.systemPrompt")} *</label>
                <textarea value={form.prompt} onChange={(e) => setForm({ ...form, prompt: e.target.value })} placeholder="You are an expert in... Help with..." rows={5} className="w-full mt-1 px-3 py-2 border rounded-md bg-background text-sm" />
                <p className="text-xs text-muted-foreground mt-1">{t("agents.promptHint")}</p>
              </div>
              <div>
                <label className="text-sm font-medium">{t("agents.availableTools")}</label>
                <p className="text-xs text-muted-foreground mb-2">{t("agents.toolsHint")}</p>
                <div className="grid grid-cols-2 gap-1 max-h-40 overflow-auto border rounded-md p-2">
                  {AVAILABLE_TOOLS.map((tool) => (
                    <label key={tool.id} className="flex items-center gap-2 text-xs py-0.5 cursor-pointer hover:bg-accent rounded px-1">
                      <input type="checkbox" checked={form.tools.includes(tool.id)} onChange={() => toggleTool("tools", tool.id)} className="rounded" />
                      <span className={form.tools.includes("*") && tool.id !== "*" ? "text-muted-foreground" : ""}>{tool.label}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-sm font-medium">{t("agents.allowedTools")}</label>
                <p className="text-xs text-muted-foreground mb-2">{t("agents.allowedToolsHint")}</p>
                <div className="grid grid-cols-2 gap-1 max-h-40 overflow-auto border rounded-md p-2">
                  {AVAILABLE_TOOLS.map((tool) => (
                    <label key={tool.id} className="flex items-center gap-2 text-xs py-0.5 cursor-pointer hover:bg-accent rounded px-1">
                      <input type="checkbox" checked={form.allowedTools.includes(tool.id)} onChange={() => toggleTool("allowedTools", tool.id)} className="rounded" />
                      <span className={form.allowedTools.includes("*") && tool.id !== "*" ? "text-muted-foreground" : ""}>{tool.label}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-sm font-medium">{t("agents.skills")}</label>
                <p className="text-xs text-muted-foreground mb-2">{t("agents.skillsHint")}</p>
                <div className="border rounded-md p-2 max-h-32 overflow-auto">
                  {skills.length === 0 && <p className="text-xs text-muted-foreground">{t("agents.noSkills")}</p>}
                  {skills.map((s) => (
                    <label key={s.skillId} className="flex items-center gap-2 text-xs py-0.5 cursor-pointer hover:bg-accent rounded px-1">
                      <input type="checkbox" checked={form.skillIds.includes(s.skillId)} onChange={() => setForm((f) => ({ ...f, skillIds: f.skillIds.includes(s.skillId) ? f.skillIds.filter((id) => id !== s.skillId) : [...f.skillIds, s.skillId] }))} />
                      <span className="font-medium">{s.name}</span>
                      <span className="text-muted-foreground">— {s.description || "no description"}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-sm font-medium">{t("agents.mcpServers")}</label>
                <p className="text-xs text-muted-foreground mb-2">{t("agents.mcpServersHint")}</p>
                <div className="border rounded-md p-2 max-h-32 overflow-auto">
                  {mcpServers.length === 0 && <p className="text-xs text-muted-foreground">{t("agents.noMcpServers")}</p>}
                  {mcpServers.map((m) => (
                    <label key={m.mcpServerId} className="flex items-center gap-2 text-xs py-0.5 cursor-pointer hover:bg-accent rounded px-1">
                      <input type="checkbox" checked={form.mcpServerIds.includes(m.mcpServerId)} onChange={() => setForm((f) => ({ ...f, mcpServerIds: f.mcpServerIds.includes(m.mcpServerId) ? f.mcpServerIds.filter((id) => id !== m.mcpServerId) : [...f.mcpServerIds, m.mcpServerId] }))} />
                      <span className="font-medium">{m.name}</span>
                      <span className={`px-1.5 py-0 rounded text-[10px] ${m.type === "stdio" ? "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300" : "bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300"}`}>{m.type}</span>
                    </label>
                  ))}
                </div>
              </div>
              <details className="border rounded-md">
                <summary className="px-3 py-2 text-sm font-medium cursor-pointer hover:bg-accent">{t("agents.jsonPreview")}</summary>
                <pre className="p-3 text-xs overflow-auto bg-muted/50 rounded-b-md">{JSON.stringify({
                  name: form.name || "my-agent",
                  description: form.description,
                  prompt: form.prompt || "...",
                  ...(form.model ? { model: form.model } : {}),
                  tools: form.tools,
                  allowedTools: form.allowedTools,
                  ...(form.skillIds.length ? { resources: form.skillIds.map((id) => { const s = skills.find((sk) => sk.skillId === id); return `skill://.kiro/skills/${s?.name || id}/SKILL.md`; }) } : {}),
                  ...(form.mcpServerIds.length ? { mcpServers: Object.fromEntries(form.mcpServerIds.map((id) => { const m = mcpServers.find((ms) => ms.mcpServerId === id); return [m?.name || id, m?.type === "http" ? { url: (m as unknown as {url:string}).url } : { command: (m as unknown as {command:string}).command }]; })) } : {}),
                }, null, 2)}</pre>
              </details>
            </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <button onClick={closeModal} className="px-4 py-2 border rounded-md text-sm hover:bg-accent">{t("common.cancel")}</button>
              <button onClick={handleSubmit} className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:opacity-90">{editingItem ? t("common.save") : t("agents.createAgent")}</button>
            </div>
          </div>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {DEFAULT_AGENTS.map((agent) => (
          <div key={agent.agentId} className="border rounded-lg p-4 space-y-2 border-dashed">
            <div className="flex justify-between items-start">
              <h3 className="font-medium">{agent.name}</h3>
              <span className="text-xs px-2 py-0.5 bg-muted rounded">{t("agents.builtIn")}</span>
            </div>
            <p className="text-sm text-muted-foreground">{agent.description}</p>
          </div>
        ))}
        {agents.map((agent) => (
          <div key={agent.agentId} className="border rounded-lg p-4 space-y-2">
            <div className="flex justify-between items-start">
              <h3 className="font-medium">{agent.name}</h3>
              <div className="flex gap-2">
                <button onClick={() => handleEdit(agent)} className="text-xs text-primary hover:underline">{t("common.edit")}</button>
                <button onClick={() => handleDelete(agent.agentId)} className="text-xs text-destructive hover:underline">{t("common.delete")}</button>
              </div>
            </div>
            <p className="text-sm text-muted-foreground">{agent.description || t("agents.noDescription")}</p>
            <div className="flex flex-wrap gap-1 text-xs text-muted-foreground">
              {agent.model && <span className="px-2 py-0.5 bg-muted rounded">{agent.model}</span>}
              <span className="px-2 py-0.5 bg-muted rounded">{agent.tools?.includes("*") ? t("agents.allTools") : `${agent.tools?.length || 0} ${t("agents.tools")}`}</span>
              <span className="px-2 py-0.5 bg-muted rounded">{agent.skillIds?.length || 0} skills</span>
              <span className="px-2 py-0.5 bg-muted rounded">{agent.mcpServerIds?.length || 0} MCP</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
