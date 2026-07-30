"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";

type Mode = "login" | "register" | "confirm";

export default function LoginPage() {
  const { login, register, confirmRegistration } = useAuth();
  const { t } = useI18n();
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await login(email, password);
      router.push("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const result = await register(email, password);
      if (result.needsConfirmation) {
        setMode("confirm");
      } else {
        await login(email, password);
        router.push("/dashboard");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registration failed");
    } finally {
      setLoading(false);
    }
  };

  const handleConfirm = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await confirmRegistration(email, code);
      await login(email, password);
      router.push("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Confirmation failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-background">
      <div className="w-full max-w-sm border rounded-lg p-6 space-y-4">
        <h1 className="text-2xl font-bold text-center">Kiro Job Scheduler</h1>

        {mode === "login" && (
          <form onSubmit={handleLogin} className="space-y-3">
            <div>
              <label className="text-sm font-medium">{t("auth.email")}</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required className="w-full mt-1 px-3 py-2 border rounded-md bg-background text-sm" />
            </div>
            <div>
              <label className="text-sm font-medium">{t("auth.password")}</label>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required className="w-full mt-1 px-3 py-2 border rounded-md bg-background text-sm" />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <button type="submit" disabled={loading} className="w-full py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:opacity-90 disabled:opacity-50">
              {loading ? t("auth.signingIn") : t("auth.signIn")}
            </button>
            <p className="text-center text-sm text-muted-foreground">
              {t("auth.noAccount")} <button type="button" onClick={() => { setMode("register"); setError(""); }} className="text-primary underline">{t("auth.register")}</button>
            </p>
          </form>
        )}

        {mode === "register" && (
          <form onSubmit={handleRegister} className="space-y-3">
            <div>
              <label className="text-sm font-medium">{t("auth.email")}</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required className="w-full mt-1 px-3 py-2 border rounded-md bg-background text-sm" />
            </div>
            <div>
              <label className="text-sm font-medium">{t("auth.password")}</label>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} className="w-full mt-1 px-3 py-2 border rounded-md bg-background text-sm" />
              <p className="text-xs text-muted-foreground mt-1">{t("auth.passwordHint")}</p>
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <button type="submit" disabled={loading} className="w-full py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:opacity-90 disabled:opacity-50">
              {loading ? t("auth.registering") : t("auth.register")}
            </button>
            <p className="text-center text-sm text-muted-foreground">
              {t("auth.haveAccount")} <button type="button" onClick={() => { setMode("login"); setError(""); }} className="text-primary underline">{t("auth.signIn")}</button>
            </p>
          </form>
        )}

        {mode === "confirm" && (
          <form onSubmit={handleConfirm} className="space-y-3">
            <p className="text-sm text-muted-foreground">{t("auth.codeSent")} <strong>{email}</strong></p>
            <div>
              <label className="text-sm font-medium">{t("auth.verificationCode")}</label>
              <input type="text" value={code} onChange={(e) => setCode(e.target.value)} required className="w-full mt-1 px-3 py-2 border rounded-md bg-background text-sm" placeholder="123456" />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <button type="submit" disabled={loading} className="w-full py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:opacity-90 disabled:opacity-50">
              {loading ? t("auth.confirming") : t("auth.confirmSignIn")}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
