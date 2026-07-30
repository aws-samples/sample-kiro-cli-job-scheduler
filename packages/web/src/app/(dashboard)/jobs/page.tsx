"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useToast } from "@/components/toast";
import type { Job, AgentConfig, NotificationChannel } from "@kiro-scheduler/shared";

type NotificationMode = "inherit" | "select" | "none";

const emptyForm = {
  name: "",
  prompt: "",
  agentId: "",
  cronExpression: "0 9 * * MON-FRI",
  timezone: "Asia/Shanghai",
  enabled: true,
  notificationMode: "inherit" as NotificationMode,
  notificationChannelIds: [] as string[],
};

export default function JobsPage() {
  const { t } = useI18n();
  const toast = useToast();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [agents, setAgents] = useState<AgentConfig[]>([]);
  const [channels, setChannels] = useState<NotificationChannel[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [editingItem, setEditingItem] = useState<Job | null>(null);
  const [form, setForm] = useState({ ...emptyForm });
  const [hasApiKey, setHasApiKey] = useState<boolean | null>(null);
  const [hasNotifications, setHasNotifications] = useState<boolean | null>(null);

  useEffect(() => {
    api.jobs.list().then((r) => setJobs(r.data)).catch(() => {});
    api.agents.list().then((r) => setAgents(r.data)).catch(() => {});
    api.settings.getApiKey().then((r) => setHasApiKey(!!(r?.data?.configured || r?.data?.masked))).catch(() => setHasApiKey(false));
    api.settings.getNotifications().then((r) => {
      const list = r.data || [];
      setChannels(list);
      setHasNotifications(list.length > 0);
    }).catch(() => setHasNotifications(false));
  }, []);

  const handleEdit = (job: Job) => {
    setEditingItem(job);
    setForm({
      name: job.name,
      prompt: job.prompt,
      agentId: job.agentId,
      cronExpression: job.cronExpression,
      timezone: (job as any).timezone || "Asia/Shanghai",
      enabled: job.enabled,
      notificationMode: ((job as any).notificationMode as NotificationMode) || "inherit",
      notificationChannelIds: (job.notificationChannelIds as string[]) || [],
    });
    setShowCreate(true);
  };

  const toggleChannel = (id: string) => {
    setForm((prev) => ({
      ...prev,
      notificationChannelIds: prev.notificationChannelIds.includes(id)
        ? prev.notificationChannelIds.filter((c) => c !== id)
        : [...prev.notificationChannelIds, id],
    }));
  };

  const handleSubmit = async () => {
    if (!hasApiKey) return toast.error(t("jobs.apiKeyWarning"));
    if (form.notificationMode !== "none" && !hasNotifications) return toast.error(t("jobs.notificationWarning"));
    if (!form.name || !form.prompt || !form.agentId) return toast.error(t("jobs.fillRequired"));
    if (form.notificationMode === "select" && form.notificationChannelIds.length === 0) {
      return toast.error(t("jobs.selectChannelWarning"));
    }

    const payload = {
      name: form.name,
      prompt: form.prompt,
      agentId: form.agentId,
      cronExpression: form.cronExpression,
      timezone: form.timezone,
      enabled: form.enabled,
      notificationMode: form.notificationMode,
      notificationChannelIds: form.notificationMode === "select" ? form.notificationChannelIds : [],
    };

    if (editingItem) {
      const res = await api.jobs.update(editingItem.jobId, payload);
      setJobs((prev) => prev.map((j) => j.jobId === editingItem.jobId ? res.data : j));
    } else {
      const res = await api.jobs.create(payload);
      setJobs((prev) => [...prev, res.data]);
    }
    closeModal();
  };

  const handleRun = async (id: string) => {
    await api.jobs.run(id);
    toast.success(t("jobs.triggered"));
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm(t("jobs.deleteConfirm"))) return;
    await api.jobs.delete(id);
    setJobs((prev) => prev.filter((j) => j.jobId !== id));
  };

  const closeModal = () => {
    setShowCreate(false);
    setEditingItem(null);
    setForm({ ...emptyForm });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{t("jobs.title")}</h1>
        <button onClick={() => setShowCreate(true)} className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:opacity-90">
          {t("jobs.create")}
        </button>
      </div>

      {(hasApiKey === false || hasNotifications === false) && (
        <div className="border border-yellow-300 bg-yellow-50 dark:bg-yellow-950 dark:border-yellow-800 rounded-lg p-4 space-y-1">
          <p className="text-sm font-medium text-yellow-800 dark:text-yellow-200">{t("jobs.setupRequired")}</p>
          <ul className="text-sm text-yellow-700 dark:text-yellow-300 list-disc list-inside">
            {hasApiKey === false && <li>{t("jobs.noApiKey")} <a href="/settings" className="underline font-medium">{t("common.goToSettings")}</a></li>}
            {hasNotifications === false && <li>{t("jobs.noNotification")} <a href="/settings" className="underline font-medium">{t("common.goToSettings")}</a></li>}
          </ul>
        </div>
      )}

      {showCreate && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={closeModal}>
          <div className="bg-card border rounded-lg p-6 w-full max-w-lg space-y-4 max-h-[90vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold">{editingItem ? t("common.edit") : t("jobs.createTitle")}</h2>
            <div className="space-y-3">
              <div>
                <label className="text-sm font-medium">{t("jobs.name")} *</label>
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Daily code review" className="w-full mt-1 px-3 py-2 border rounded-md bg-background text-sm" />
              </div>
              <div>
                <label className="text-sm font-medium">{t("jobs.prompt")} *</label>
                <textarea value={form.prompt} onChange={(e) => setForm({ ...form, prompt: e.target.value })} placeholder="Review yesterday's code changes and summarize..." rows={4} className="w-full mt-1 px-3 py-2 border rounded-md bg-background text-sm" />
              </div>
              <div>
                <label className="text-sm font-medium">{t("jobs.agent")} *</label>
                <select value={form.agentId} onChange={(e) => setForm({ ...form, agentId: e.target.value })} className="w-full mt-1 px-3 py-2 border rounded-md bg-background text-sm">
                  <option value="">{t("jobs.selectAgent")}</option>
                  <option value="default-kiro">kiro_default ({t("agents.builtIn")})</option>
                  <option value="default-planner">kiro_planner ({t("agents.builtIn")})</option>
                  {agents.map((a) => <option key={a.agentId} value={a.agentId}>{a.name}</option>)}
                </select>
                {agents.length === 0 && <p className="text-xs text-muted-foreground mt-1">{t("jobs.noAgents")}</p>}
              </div>
              <div>
                <label className="text-sm font-medium">{t("jobs.cron")}</label>
                <input value={form.cronExpression} onChange={(e) => setForm({ ...form, cronExpression: e.target.value })} placeholder="0 9 * * MON-FRI" className="w-full mt-1 px-3 py-2 border rounded-md bg-background text-sm font-mono" />
                <p className="text-xs text-muted-foreground mt-1">{t("jobs.cronExamples")} <code>0 9 * * *</code> (daily 9am), <code>0 */2 * * *</code> (every 2h), <code>0 9 * * MON-FRI</code> (weekdays 9am)</p>
              </div>
              <div>
                <label className="text-sm font-medium">{t("jobs.timezone")}</label>
                <select value={form.timezone} onChange={(e) => setForm({ ...form, timezone: e.target.value })} className="w-full mt-1 px-3 py-2 border rounded-md bg-background text-sm">
                  <option value="Asia/Shanghai">Asia/Shanghai (GMT+8)</option>
                  <option value="Asia/Tokyo">Asia/Tokyo (GMT+9)</option>
                  <option value="America/New_York">America/New_York (EST)</option>
                  <option value="America/Los_Angeles">America/Los_Angeles (PST)</option>
                  <option value="Europe/London">Europe/London (GMT)</option>
                  <option value="UTC">UTC</option>
                </select>
              </div>

              <div>
                <label className="text-sm font-medium">{t("jobs.notification")}</label>
                <select value={form.notificationMode} onChange={(e) => setForm({ ...form, notificationMode: e.target.value as NotificationMode })} className="w-full mt-1 px-3 py-2 border rounded-md bg-background text-sm">
                  <option value="inherit">{t("jobs.notifyInherit")}</option>
                  <option value="select">{t("jobs.notifySelect")}</option>
                  <option value="none">{t("jobs.notifyNone")}</option>
                </select>
                <p className="text-xs text-muted-foreground mt-1">
                  {form.notificationMode === "inherit" && t("jobs.notifyInheritHint")}
                  {form.notificationMode === "select" && t("jobs.notifySelectHint")}
                  {form.notificationMode === "none" && t("jobs.notifyNoneHint")}
                </p>
                {form.notificationMode === "select" && (
                  <div className="mt-2 space-y-1 border rounded-md p-2 bg-muted/30">
                    {channels.length === 0 && (
                      <p className="text-xs text-muted-foreground">{t("jobs.noChannelsToSelect")} <a href="/settings" className="underline font-medium">{t("common.goToSettings")}</a></p>
                    )}
                    {channels.map((ch) => (
                      <label key={ch.id} className="flex items-center gap-2 text-sm py-0.5 cursor-pointer">
                        <input type="checkbox" checked={form.notificationChannelIds.includes(ch.id)} onChange={() => toggleChannel(ch.id)} />
                        <span className="font-medium">{ch.name}</span>
                        <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground uppercase">{ch.type}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex items-center gap-2">
                <input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} id="enabled" />
                <label htmlFor="enabled" className="text-sm">{t("jobs.enabled")}</label>
              </div>
            </div>
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
              <th className="text-left p-3 font-medium">{t("jobs.schedule")}</th>
              <th className="text-left p-3 font-medium">{t("jobs.lastStatus")}</th>
              <th className="text-left p-3 font-medium">{t("jobs.enabled")}</th>
              <th className="text-left p-3 font-medium">{t("common.actions")}</th>
            </tr>
          </thead>
          <tbody>
            {jobs.length === 0 && (
              <tr><td colSpan={5} className="p-3 text-center text-muted-foreground">{t("jobs.noJobs")}</td></tr>
            )}
            {jobs.map((job) => (
              <tr key={job.jobId} className="border-t">
                <td className="p-3 font-medium">{job.name}</td>
                <td className="p-3 font-mono text-xs">{job.cronExpression}</td>
                <td className="p-3">
                  {job.lastStatus ? (
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${job.lastStatus === "succeeded" ? "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300" : "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300"}`}>{t(`common.status.${job.lastStatus}` as any) || job.lastStatus}</span>
                  ) : <span className="text-muted-foreground">—</span>}
                </td>
                <td className="p-3">{job.enabled ? "✓" : "✗"}</td>
                <td className="p-3 space-x-2">
                  <button onClick={() => handleEdit(job)} className="text-xs px-2 py-1 rounded border hover:bg-accent">{t("common.edit")}</button>
                  <button onClick={() => handleRun(job.jobId)} className="text-xs px-2 py-1 rounded border hover:bg-accent">{t("jobs.runNow")}</button>
                  <button onClick={() => handleDelete(job.jobId)} className="text-xs px-2 py-1 rounded border text-destructive hover:bg-destructive/10">{t("common.delete")}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
