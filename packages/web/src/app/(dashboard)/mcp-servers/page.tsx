"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useToast } from "@/components/toast";
import { CreateMcpServerSchema } from "@kiro-scheduler/shared";

interface McpServer { mcpServerId: string; name: string; type: string; command?: string; url?: string; description?: string; args?: string[]; env?: Record<string, string>; headers?: Record<string, string>; }

type CreateMode = "form" | "json";

export default function McpServersPage() {
  const { t } = useI18n();
  const toast = useToast();
  const [servers, setServers] = useState<McpServer[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [editingItem, setEditingItem] = useState<McpServer | null>(null);
  const [mode, setMode] = useState<CreateMode>("form");
  const [jsonInput, setJsonInput] = useState("");
  const [form, setForm] = useState({ type: "stdio" as "stdio" | "http", name: "", description: "", command: "", url: "", args: "", env: "", headers: "" });

  useEffect(() => {
    api.mcpServers.list().then((r) => setServers(r.data)).catch(() => {});
  }, []);

  const handleEdit = (server: McpServer) => {
    setEditingItem(server);
    setForm({
      type: server.type as "stdio" | "http",
      name: server.name,
      description: server.description || "",
      command: server.command || "",
      url: server.url || "",
      args: server.args?.join("\n") || "",
      env: server.env ? Object.entries(server.env).map(([k, v]) => `${k}=${v}`).join("\n") : "",
      headers: server.headers ? Object.entries(server.headers).map(([k, v]) => `${k}=${v}`).join("\n") : "",
    });
    setMode("form");
    setShowCreate(true);
  };

  const handleSubmit = async () => {
    if (mode === "json") {
      try {
        const parsed = JSON.parse(jsonInput);
        const result = CreateMcpServerSchema.safeParse(parsed);
        if (!result.success) {
          const errors = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("\n");
          toast.error(`Validation failed:\n${errors}`);
          return;
        }
        if (editingItem) {
          const res = await api.mcpServers.update(editingItem.mcpServerId, result.data);
          setServers((prev) => prev.map((s) => s.mcpServerId === editingItem.mcpServerId ? res.data : s));
        } else {
          const res = await api.mcpServers.create(result.data);
          setServers((prev) => [...prev, res.data]);
        }
        closeModal();
      } catch (e) { toast.error(`Invalid JSON: ${e instanceof Error ? e.message : e}`); }
      return;
    }
    if (!form.name) return toast.error(t("mcp.nameRequired"));
    if (form.type === "stdio" && !form.command) return toast.error(t("mcp.commandRequired"));
    if (form.type === "http" && !form.url) return toast.error(t("mcp.urlRequired"));

    const envObj = form.env ? Object.fromEntries(form.env.split("\n").filter(Boolean).map((l) => { const [k, ...v] = l.split("="); return [k.trim(), v.join("=").trim()]; })) : {};
    const headersObj = form.headers ? Object.fromEntries(form.headers.split("\n").filter(Boolean).map((l) => { const [k, ...v] = l.split("="); return [k.trim(), v.join("=").trim()]; })) : {};
    const argsArr = form.args ? form.args.split("\n").filter(Boolean) : [];

    const payload = form.type === "stdio"
      ? { type: "stdio" as const, name: form.name, description: form.description, command: form.command, args: argsArr, env: envObj }
      : { type: "http" as const, name: form.name, description: form.description, url: form.url, headers: headersObj };

    if (editingItem) {
      const res = await api.mcpServers.update(editingItem.mcpServerId, payload);
      setServers((prev) => prev.map((s) => s.mcpServerId === editingItem.mcpServerId ? res.data : s));
    } else {
      const res = await api.mcpServers.create(payload);
      setServers((prev) => [...prev, res.data]);
    }
    closeModal();
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm(t("mcp.deleteConfirm"))) return;
    await api.mcpServers.delete(id);
    setServers((prev) => prev.filter((s) => s.mcpServerId !== id));
  };

  const closeModal = () => {
    setShowCreate(false);
    setEditingItem(null);
    setJsonInput("");
    setForm({ type: "stdio", name: "", description: "", command: "", url: "", args: "", env: "", headers: "" });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{t("mcp.title")}</h1>
        <button onClick={() => setShowCreate(true)} className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:opacity-90">{t("mcp.add")}</button>
      </div>

      {showCreate && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 overflow-auto py-8" onClick={closeModal}>
          <div className="bg-card border rounded-lg p-6 w-full max-w-2xl space-y-4 max-h-[90vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">{editingItem ? t("common.edit") : t("mcp.addTitle")}</h2>
              <div className="flex border rounded-md text-xs">
                <button onClick={() => setMode("form")} className={`px-3 py-1 ${mode === "form" ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}>{t("common.form")}</button>
                <button onClick={() => { setMode("json"); setJsonInput(JSON.stringify(form.type === "stdio" ? { type: "stdio", name: form.name, description: form.description, command: form.command, args: form.args ? form.args.split("\n").filter(Boolean) : [], env: Object.fromEntries((form.env || "").split("\n").filter(Boolean).map((l: string) => { const [k, ...v] = l.split("="); return [k.trim(), v.join("=").trim()]; })) } : { type: "http", name: form.name, description: form.description, url: form.url, headers: Object.fromEntries((form.headers || "").split("\n").filter(Boolean).map((l: string) => { const [k, ...v] = l.split("="); return [k.trim(), v.join("=").trim()]; })) }, null, 2)); }} className={`px-3 py-1 ${mode === "json" ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}>{t("common.json")}</button>
              </div>
            </div>

            {mode === "json" ? (
              <div className="space-y-3">
                <p className="text-xs text-muted-foreground">{t("mcp.jsonHint")}</p>
                <textarea value={jsonInput} onChange={(e) => setJsonInput(e.target.value)} rows={12} placeholder={`{\n  "type": "stdio",\n  "name": "github",\n  "command": "mcp-server-github",\n  "args": ["--stdio"],\n  "env": {\n    "GITHUB_TOKEN": "$GITHUB_TOKEN"\n  }\n}`} className="w-full px-3 py-2 border rounded-md bg-background text-sm font-mono" />
              </div>
            ) : (
              <div className="space-y-3">
                <div>
                  <label className="text-sm font-medium">{t("mcp.type")}</label>
                  <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as "stdio" | "http" })} className="w-full mt-1 px-3 py-2 border rounded-md bg-background text-sm">
                    <option value="stdio">{t("mcp.stdioDesc")}</option>
                    <option value="http">{t("mcp.httpDesc")}</option>
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-sm font-medium">{t("common.name")} *</label>
                    <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="github" className="w-full mt-1 px-3 py-2 border rounded-md bg-background text-sm" />
                  </div>
                  <div>
                    <label className="text-sm font-medium">{t("common.description")}</label>
                    <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="GitHub integration" className="w-full mt-1 px-3 py-2 border rounded-md bg-background text-sm" />
                  </div>
                </div>
                {form.type === "stdio" ? (
                  <>
                    <div>
                      <label className="text-sm font-medium">{t("mcp.command")} *</label>
                      <input value={form.command} onChange={(e) => setForm({ ...form, command: e.target.value })} placeholder="mcp-server-github" className="w-full mt-1 px-3 py-2 border rounded-md bg-background text-sm font-mono" />
                    </div>
                    <div>
                      <label className="text-sm font-medium">{t("mcp.args")}</label>
                      <textarea value={form.args} onChange={(e) => setForm({ ...form, args: e.target.value })} placeholder={"--stdio"} rows={2} className="w-full mt-1 px-3 py-2 border rounded-md bg-background text-sm font-mono" />
                    </div>
                    <div>
                      <label className="text-sm font-medium">{t("mcp.env")}</label>
                      <textarea value={form.env} onChange={(e) => setForm({ ...form, env: e.target.value })} placeholder={"GITHUB_TOKEN=$GITHUB_TOKEN\nGIT_DIR=/path/to/repo"} rows={3} className="w-full mt-1 px-3 py-2 border rounded-md bg-background text-sm font-mono" />
                    </div>
                  </>
                ) : (
                  <>
                    <div>
                      <label className="text-sm font-medium">{t("mcp.url")} *</label>
                      <input value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="https://mcp.example.com/sse" className="w-full mt-1 px-3 py-2 border rounded-md bg-background text-sm" />
                    </div>
                    <div>
                      <label className="text-sm font-medium">{t("mcp.headers")}</label>
                      <textarea value={form.headers} onChange={(e) => setForm({ ...form, headers: e.target.value })} placeholder={"Authorization=Bearer $API_TOKEN"} rows={3} className="w-full mt-1 px-3 py-2 border rounded-md bg-background text-sm font-mono" />
                    </div>
                  </>
                )}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <button onClick={closeModal} className="px-4 py-2 border rounded-md text-sm hover:bg-accent">{t("common.cancel")}</button>
              <button onClick={handleSubmit} className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:opacity-90">{editingItem ? t("common.save") : t("common.create")}</button>
            </div>
          </div>
        </div>
      )}

      <div className="rounded-lg border overflow-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="text-left p-3 font-medium">{t("common.name")}</th>
              <th className="text-left p-3 font-medium">{t("mcp.type")}</th>
              <th className="text-left p-3 font-medium">{t("mcp.commandUrl")}</th>
              <th className="text-left p-3 font-medium">{t("common.actions")}</th>
            </tr>
          </thead>
          <tbody>
            {servers.length === 0 && <tr><td colSpan={4} className="p-3 text-center text-muted-foreground">{t("mcp.noServers")}</td></tr>}
            {servers.map((s) => (
              <tr key={s.mcpServerId} className="border-t">
                <td className="p-3 font-medium">{s.name}</td>
                <td className="p-3"><span className={`px-2 py-0.5 rounded text-xs font-medium ${s.type === "stdio" ? "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300" : "bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300"}`}>{s.type}</span></td>
                <td className="p-3 font-mono text-xs">{s.command || s.url || "—"}</td>
                <td className="p-3 space-x-2">
                  <button onClick={() => handleEdit(s)} className="text-xs px-2 py-1 rounded border hover:bg-accent">{t("common.edit")}</button>
                  <button onClick={() => handleDelete(s.mcpServerId)} className="text-xs px-2 py-1 rounded border text-destructive hover:bg-destructive/10">{t("common.delete")}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
