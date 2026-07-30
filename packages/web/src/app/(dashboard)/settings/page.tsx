"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useToast } from "@/components/toast";
import type { NotificationChannel } from "@kiro-scheduler/shared";

type Channel = NotificationChannel;

function newId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `ch_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

export default function SettingsPage() {
  const { t } = useI18n();
  const toast = useToast();
  const [apiKey, setApiKey] = useState("");
  const [maskedKey, setMaskedKey] = useState("");
  const [channels, setChannels] = useState<Channel[]>([]);
  const [notifSaved, setNotifSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.settings.getApiKey().then((r) => setMaskedKey(r.data.masked || "")).catch(() => {});
    api.settings.getNotifications().then((r) => {
      // Backfill ids for any legacy channel that predates stable ids
      const withIds = (r.data || []).map((ch) => (ch.id ? ch : { ...ch, id: newId() }));
      setChannels(withIds as Channel[]);
    }).catch(() => {});
  }, []);

  const saveApiKey = async () => {
    if (!apiKey) return;
    await api.settings.updateApiKey(apiKey);
    setMaskedKey(apiKey.slice(0, 4) + "****" + apiKey.slice(-4));
    setApiKey("");
    toast.success(t("settings.apiKeySaved"));
  };

  const addLark = () => setChannels((prev) => [...prev, { id: newId(), type: "lark", name: "", webhookUrl: "" }]);
  const addTelegram = () => setChannels((prev) => [...prev, { id: newId(), type: "telegram", name: "", botToken: "", chatId: "" }]);
  const removeChannel = (id: string) => setChannels((prev) => prev.filter((c) => c.id !== id));
  const updateChannel = (id: string, patch: Partial<Channel>) =>
    setChannels((prev) => prev.map((c) => (c.id === id ? ({ ...c, ...patch } as Channel) : c)));

  const saveNotifications = async () => {
    // Validate: every channel needs a name and its type-specific fields
    for (const ch of channels) {
      if (!ch.name?.trim()) return toast.error(t("settings.channelNameRequired"));
      if (ch.type === "lark" && !ch.webhookUrl?.trim()) return toast.error(t("settings.larkWebhookRequired"));
      if (ch.type === "telegram" && (!ch.botToken?.trim() || !ch.chatId?.trim())) return toast.error(t("settings.tgFieldsRequired"));
    }
    // Drop empty optional secret so it isn't persisted as ""
    const cleaned = channels.map((ch) =>
      ch.type === "lark" && !ch.secret ? { id: ch.id, type: ch.type, name: ch.name, webhookUrl: ch.webhookUrl } : ch,
    ) as Channel[];

    setSaving(true);
    try {
      const r = await api.settings.updateNotifications(cleaned);
      setChannels((r.data as Channel[]) ?? cleaned);
      setNotifSaved(true);
      setTimeout(() => setNotifSaved(false), 3000);
    } catch {
      toast.error(t("settings.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  const larkChannels = channels.filter((c) => c.type === "lark");
  const tgChannels = channels.filter((c) => c.type === "telegram");

  return (
    <div className="space-y-8 max-w-2xl">
      <h1 className="text-2xl font-semibold">{t("settings.title")}</h1>

      <section className="space-y-3 border rounded-lg p-4">
        <h2 className="text-lg font-medium">{t("settings.apiKeyTitle")}</h2>
        <p className="text-sm text-muted-foreground">{t("settings.apiKeyDesc")} <a href="https://app.kiro.dev" target="_blank" className="underline text-primary">app.kiro.dev</a>.</p>
        {maskedKey && <p className="text-sm font-mono bg-muted px-3 py-2 rounded">{t("settings.currentKey")} {maskedKey}</p>}
        <div className="flex gap-2">
          <input type="password" placeholder="ksk_..." value={apiKey} onChange={(e) => setApiKey(e.target.value)} className="flex-1 rounded-md border bg-background px-3 py-2 text-sm" />
          <button onClick={saveApiKey} className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90">{t("settings.saveKey")}</button>
        </div>
      </section>

      <section className="space-y-4 border rounded-lg p-4">
        <div>
          <h2 className="text-lg font-medium">{t("settings.notifTitle")}</h2>
          <p className="text-sm text-muted-foreground">{t("settings.notifDescMulti")}</p>
        </div>

        {/* Lark channels */}
        <div className="space-y-3 border-b pb-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium">{t("settings.larkTitle")}</h3>
            <button onClick={addLark} className="text-xs px-2 py-1 rounded border hover:bg-accent">{t("settings.addLark")}</button>
          </div>
          {larkChannels.length === 0 && <p className="text-xs text-muted-foreground">{t("settings.noChannelsOfType")}</p>}
          {larkChannels.map((ch) => (
            <div key={ch.id} className="rounded-md border bg-muted/30 p-3 space-y-2">
              <div className="flex items-center gap-2">
                <input
                  value={ch.name}
                  onChange={(e) => updateChannel(ch.id, { name: e.target.value })}
                  placeholder={t("settings.channelNamePlaceholder")}
                  className="flex-1 rounded-md border bg-background px-3 py-2 text-sm font-medium"
                />
                <button onClick={() => removeChannel(ch.id)} className="text-xs px-2 py-1 rounded border text-destructive hover:bg-destructive/10">{t("common.delete")}</button>
              </div>
              <div>
                <label className="text-xs text-muted-foreground">{t("settings.larkWebhookUrl")}</label>
                <input type="url" placeholder="https://open.feishu.cn/open-apis/bot/v2/hook/..." value={ch.webhookUrl}
                  onChange={(e) => updateChannel(ch.id, { webhookUrl: e.target.value })}
                  className="w-full mt-1 rounded-md border bg-background px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">{t("settings.larkSecret")}</label>
                <input type="password" placeholder="SEC..." value={ch.secret ?? ""}
                  onChange={(e) => updateChannel(ch.id, { secret: e.target.value })}
                  className="w-full mt-1 rounded-md border bg-background px-3 py-2 text-sm" />
                <p className="text-xs text-muted-foreground mt-1">{t("settings.larkSecretHint")}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Telegram channels */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium">{t("settings.tgTitle")}</h3>
            <button onClick={addTelegram} className="text-xs px-2 py-1 rounded border hover:bg-accent">{t("settings.addTelegram")}</button>
          </div>
          {tgChannels.length === 0 && <p className="text-xs text-muted-foreground">{t("settings.noChannelsOfType")}</p>}
          {tgChannels.map((ch) => (
            <div key={ch.id} className="rounded-md border bg-muted/30 p-3 space-y-2">
              <div className="flex items-center gap-2">
                <input
                  value={ch.name}
                  onChange={(e) => updateChannel(ch.id, { name: e.target.value })}
                  placeholder={t("settings.channelNamePlaceholder")}
                  className="flex-1 rounded-md border bg-background px-3 py-2 text-sm font-medium"
                />
                <button onClick={() => removeChannel(ch.id)} className="text-xs px-2 py-1 rounded border text-destructive hover:bg-destructive/10">{t("common.delete")}</button>
              </div>
              <div>
                <label className="text-xs text-muted-foreground">{t("settings.tgBotToken")}</label>
                <input type="password" placeholder="123456:ABC-DEF..." value={ch.botToken}
                  onChange={(e) => updateChannel(ch.id, { botToken: e.target.value })}
                  className="w-full mt-1 rounded-md border bg-background px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">{t("settings.tgChatId")}</label>
                <input type="text" placeholder="-1001234567890" value={ch.chatId}
                  onChange={(e) => updateChannel(ch.id, { chatId: e.target.value })}
                  className="w-full mt-1 rounded-md border bg-background px-3 py-2 text-sm" />
              </div>
            </div>
          ))}
        </div>

        <div className="flex items-center gap-3 pt-2">
          <button onClick={saveNotifications} disabled={saving} className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50">
            {t("settings.saveNotif")}
          </button>
          {notifSaved && <span className="text-sm text-green-600">{t("settings.saved")}</span>}
        </div>
      </section>
    </div>
  );
}
