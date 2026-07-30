"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { useEffect } from "react";
import { LayoutDashboard, CalendarClock, Bot, Sparkles, Server, Settings, LogOut } from "lucide-react";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "@/components/theme-toggle";
import { LocaleToggle } from "@/components/locale-toggle";

const navItems = [
  { href: "/dashboard", key: "nav.dashboard", icon: LayoutDashboard },
  { href: "/jobs", key: "nav.jobs", icon: CalendarClock },
  { href: "/agents", key: "nav.agents", icon: Bot },
  { href: "/skills", key: "nav.skills", icon: Sparkles },
  { href: "/mcp-servers", key: "nav.mcpServers", icon: Server },
  { href: "/settings", key: "nav.settings", icon: Settings },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { user, isAuthenticated, isLoading, logout } = useAuth();
  const { t } = useI18n();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.replace("/login");
    }
  }, [isAuthenticated, isLoading, router]);

  if (!isLoading && !isAuthenticated) return null;

  return (
    <div className="flex h-screen">
      <aside className="hidden md:flex w-60 flex-col border-r bg-card">
        <div className="p-4 font-semibold text-lg border-b">Kiro Scheduler</div>
        <nav className="flex-1 p-2 space-y-1">
          {navItems.map(({ href, key, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium hover:bg-accent",
                pathname === href && "bg-accent text-accent-foreground"
              )}
            >
              <Icon className="h-4 w-4" />
              {t(key)}
            </Link>
          ))}
        </nav>
      </aside>
      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="h-14 border-b flex items-center justify-between px-6">
          <div className="md:hidden font-semibold">Kiro Scheduler</div>
          <div className="ml-auto flex items-center gap-4">
            <LocaleToggle />
            <ThemeToggle />
            <span className="text-sm text-muted-foreground">{user?.email}</span>
            <button onClick={async () => { await logout(); router.push("/login"); }} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
              <LogOut className="h-4 w-4" /> {t("nav.logout")}
            </button>
          </div>
        </header>
        <main className="flex-1 overflow-auto p-6">{children}</main>
      </div>
    </div>
  );
}
