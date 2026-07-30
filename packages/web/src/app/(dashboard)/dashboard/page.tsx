"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import type { Job, ExecutionLog } from "@kiro-scheduler/shared";

const PAGE_SIZE = 10;

export default function DashboardPage() {
  const { t } = useI18n();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [executions, setExecutions] = useState<ExecutionLog[]>([]);
  const [filterName, setFilterName] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [page, setPage] = useState(0);

  useEffect(() => {
    api.jobs.list().then((r) => {
      setJobs(r.data);
      Promise.all(r.data.map((j) => api.jobs.executions(j.jobId)))
        .then((results) => setExecutions(results.flatMap((r) => r.data).sort((a, b) => b.startTime.localeCompare(a.startTime))))
        .catch(() => {});
    }).catch(() => {});
  }, []);

  const filtered = useMemo(() => {
    return executions.filter((e) => {
      const job = jobs.find((j) => j.jobId === e.jobId);
      const name = job?.name || e.jobId;
      if (filterName && !name.toLowerCase().includes(filterName.toLowerCase())) return false;
      if (filterStatus && e.status !== filterStatus) return false;
      return true;
    });
  }, [executions, jobs, filterName, filterStatus]);

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paged = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  // Reset page when filter changes
  useEffect(() => { setPage(0); }, [filterName, filterStatus]);

  const activeSchedules = jobs.filter((j) => j.enabled).length;
  const today = new Date().toISOString().slice(0, 10);
  const executionsToday = executions.filter((e) => e.startTime.slice(0, 10) === today).length;

  const stats = [
    { label: t("dashboard.totalJobs"), value: jobs.length },
    { label: t("dashboard.activeSchedules"), value: activeSchedules },
    { label: t("dashboard.executionsToday"), value: executionsToday },
  ];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">{t("dashboard.title")}</h1>
      <div className="grid gap-4 sm:grid-cols-3">
        {stats.map((s) => (
          <div key={s.label} className="rounded-lg border bg-card p-4">
            <p className="text-sm text-muted-foreground">{s.label}</p>
            <p className="text-3xl font-bold">{s.value}</p>
          </div>
        ))}
      </div>
      <div>
        <h2 className="text-lg font-medium mb-3">{t("dashboard.recentExecutions")}</h2>
        {/* Filters */}
        <div className="flex gap-3 mb-3">
          <input
            type="text"
            placeholder={t("dashboard.filterByName")}
            value={filterName}
            onChange={(e) => setFilterName(e.target.value)}
            className="px-3 py-1.5 border rounded-md text-sm bg-background w-48"
          />
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="px-3 py-1.5 border rounded-md text-sm bg-background"
          >
            <option value="">{t("dashboard.allStatuses")}</option>
            <option value="succeeded">{t("common.status.succeeded")}</option>
            <option value="failed">{t("common.status.failed")}</option>
            <option value="running">{t("common.status.running")}</option>
          </select>
        </div>
        <div className="rounded-lg border overflow-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left p-3 font-medium">{t("dashboard.job")}</th>
                <th className="text-left p-3 font-medium">{t("dashboard.status")}</th>
                <th className="text-left p-3 font-medium">{t("dashboard.trigger")}</th>
                <th className="text-left p-3 font-medium">{t("dashboard.started")}</th>
              </tr>
            </thead>
            <tbody>
              {paged.length === 0 && (
                <tr><td colSpan={4} className="p-3 text-center text-muted-foreground">{t("dashboard.noExecutions")}</td></tr>
              )}
              {paged.map((e) => {
                const job = jobs.find((j) => j.jobId === e.jobId);
                return (
                <tr key={e.executionId} className="border-t">
                  <td className="p-3 font-medium">{job?.name || e.jobId.slice(0, 8)}</td>
                  <td className="p-3">
                    <span className={cn("px-2 py-0.5 rounded text-xs font-medium", e.status === "succeeded" ? "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300" : e.status === "failed" ? "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300" : "bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300")}>{t(`common.status.${e.status}` as any) || e.status}</span>
                  </td>
                  <td className="p-3">{t(`common.trigger.${e.triggerType}` as any) || e.triggerType}</td>
                  <td className="p-3">{new Date(e.startTime).toLocaleString()}</td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between mt-3 text-sm">
            <span className="text-muted-foreground">{t("dashboard.showing")} {page * PAGE_SIZE + 1}-{Math.min((page + 1) * PAGE_SIZE, filtered.length)} / {filtered.length}</span>
            <div className="flex gap-2">
              <button onClick={() => setPage(p => p - 1)} disabled={page === 0} className="px-3 py-1 border rounded disabled:opacity-40">{t("dashboard.prev")}</button>
              <button onClick={() => setPage(p => p + 1)} disabled={page >= totalPages - 1} className="px-3 py-1 border rounded disabled:opacity-40">{t("dashboard.next")}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function cn(...classes: (string | boolean | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}
