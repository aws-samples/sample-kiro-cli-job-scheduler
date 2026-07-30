"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useToast } from "@/components/toast";
import type { Skill } from "@kiro-scheduler/shared";

export default function SkillsPage() {
  const { t } = useI18n();
  const toast = useToast();
  const [skills, setSkills] = useState<Skill[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [editingItem, setEditingItem] = useState<Skill | null>(null);
  const [form, setForm] = useState({ name: "", description: "", content: "" });

  useEffect(() => {
    api.skills.list().then((r) => setSkills(r.data)).catch(() => {});
  }, []);

  const handleEdit = (skill: Skill) => {
    setEditingItem(skill);
    setForm({ name: skill.name, description: skill.description || "", content: skill.content || "" });
    setShowCreate(true);
  };

  const handleSubmit = async () => {
    if (!form.name || !form.content) return toast.error(t("skills.nameRequired"));
    if (editingItem) {
      const res = await api.skills.update(editingItem.skillId, form);
      setSkills((prev) => prev.map((s) => s.skillId === editingItem.skillId ? res.data : s));
    } else {
      const res = await api.skills.create(form);
      setSkills((prev) => [...prev, res.data]);
    }
    closeModal();
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm(t("skills.deleteConfirm"))) return;
    await api.skills.delete(id);
    setSkills((prev) => prev.filter((s) => s.skillId !== id));
  };

  const closeModal = () => {
    setShowCreate(false);
    setEditingItem(null);
    setForm({ name: "", description: "", content: "" });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{t("skills.title")}</h1>
        <button onClick={() => setShowCreate(true)} className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:opacity-90">
          {t("skills.create")}
        </button>
      </div>

      {showCreate && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={closeModal}>
          <div className="bg-card border rounded-lg p-6 w-full max-w-lg space-y-4" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold">{editingItem ? t("common.edit") : t("skills.createTitle")}</h2>
            <div className="space-y-3">
              <div>
                <label className="text-sm font-medium">{t("common.name")} *</label>
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="code-review-guidelines" className="w-full mt-1 px-3 py-2 border rounded-md bg-background text-sm" />
              </div>
              <div>
                <label className="text-sm font-medium">{t("common.description")}</label>
                <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Guidelines for code review" className="w-full mt-1 px-3 py-2 border rounded-md bg-background text-sm" />
              </div>
              <div>
                <label className="text-sm font-medium">{t("skills.content")} *</label>
                <textarea value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} placeholder={"---\nname: code-review-guidelines\ndescription: Guidelines for reviewing code. Use when reviewing PRs or code changes.\n---\n\n# Code Review Guidelines\n\n## Checklist\n- Check for security vulnerabilities\n- Verify error handling\n- Ensure tests are included\n..."} rows={12} className="w-full mt-1 px-3 py-2 border rounded-md bg-background text-sm font-mono" />
                <p className="text-xs text-muted-foreground mt-1">{t("skills.contentHint")}</p>
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
              <th className="text-left p-3 font-medium">{t("common.description")}</th>
              <th className="text-left p-3 font-medium">{t("common.actions")}</th>
            </tr>
          </thead>
          <tbody>
            {skills.length === 0 && <tr><td colSpan={3} className="p-3 text-center text-muted-foreground">{t("skills.noSkills")}</td></tr>}
            {skills.map((skill) => (
              <tr key={skill.skillId} className="border-t">
                <td className="p-3 font-medium">{skill.name}</td>
                <td className="p-3 text-muted-foreground">{skill.description || "—"}</td>
                <td className="p-3 space-x-2">
                  <button onClick={() => handleEdit(skill)} className="text-xs px-2 py-1 rounded border hover:bg-accent">{t("common.edit")}</button>
                  <button onClick={() => handleDelete(skill.skillId)} className="text-xs px-2 py-1 rounded border text-destructive hover:bg-destructive/10">{t("common.delete")}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
