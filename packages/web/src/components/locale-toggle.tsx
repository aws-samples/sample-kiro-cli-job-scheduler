"use client";

import { useI18n } from "@/lib/i18n";

export function LocaleToggle() {
  const { locale, setLocale } = useI18n();

  return (
    <button
      onClick={() => setLocale(locale === "en" ? "zh" : "en")}
      className="p-2 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors text-sm font-medium"
      aria-label="Toggle language"
    >
      {locale === "en" ? "中" : "EN"}
    </button>
  );
}
