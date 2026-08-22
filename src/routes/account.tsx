import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowLeft,
  Check,
  Crown,
  KeyRound,
  Loader2,
  LogOut,
  Mail,
  Sparkles,
  User as UserIcon,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useSubscription } from "@/hooks/useSubscription";
import { getStripeEnvironment } from "@/lib/stripe";
import { createPortalSession } from "@/lib/payments.functions";
import { getProfile, updateProfile } from "@/lib/profile.functions";
import { getAiUsageSummary } from "@/lib/ai-usage.functions";
import { PaymentTestModeBanner } from "@/components/PaymentTestModeBanner";

export const Route = createFileRoute("/account")({
  head: () => ({
    meta: [{ title: "Account settings — Signal Goat AI" }],
  }),
  component: AccountPage,
});

function AccountPage() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();

  useEffect(() => {
    if (!authLoading && !user) navigate({ to: "/auth", replace: true });
  }, [authLoading, user, navigate]);

  const signOut = async () => {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/" });
  };

  if (authLoading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border/60">
        <div className="mx-auto flex h-14 max-w-3xl items-center justify-between px-4">
          <Link to="/studio" className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" /> Back to Chart Studio
          </Link>
          <button
            onClick={signOut}
            className="flex items-center gap-1.5 rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <LogOut className="h-3.5 w-3.5" /> Sign out
          </button>
        </div>
      </header>

      <div className="mx-auto max-w-3xl px-4 py-10">
        <h1 className="text-2xl font-black tracking-tight">Account settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage your profile, email, password, subscription and AI usage.
        </p>

        <div className="mt-8 space-y-6">
          <ProfileSection userId={user.id} />
          <EmailSection email={user.email ?? ""} />
          <PasswordSection email={user.email ?? ""} />
          <SubscriptionSection />
          <UsageSection />
        </div>
      </div>
    </div>
  );
}

function Card({
  icon,
  title,
  description,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <div className="mb-4 flex items-start gap-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand/10 text-brand">
          {icon}
        </div>
        <div>
          <h2 className="text-sm font-semibold">{title}</h2>
          {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

function ProfileSection({ userId }: { userId: string }) {
  const getProfileFn = useServerFn(getProfile);
  const updateProfileFn = useServerFn(updateProfile);
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);

  const profileQuery = useQuery({
    queryKey: ["profile", userId],
    queryFn: () => getProfileFn(),
  });

  useEffect(() => {
    if (profileQuery.data && !dirty) {
      setName(profileQuery.data.display_name ?? "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileQuery.data]);

  const save = useMutation({
    mutationFn: (displayName: string) => updateProfileFn({ data: { displayName } }),
    onSuccess: () => {
      setDirty(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      qc.invalidateQueries({ queryKey: ["profile", userId] });
    },
  });

  const initial = (name || profileQuery.data?.display_name || "?").slice(0, 1).toUpperCase();

  return (
    <Card icon={<UserIcon className="h-4 w-4" />} title="Profile" description="Your display name, shown across Signal Goat AI.">
      <div className="flex items-center gap-4">
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-brand text-lg font-bold text-brand-foreground">
          {initial}
        </div>
        <div className="flex flex-1 items-center gap-2">
          <input
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setDirty(true);
            }}
            maxLength={80}
            placeholder="Display name"
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-brand"
          />
          <button
            onClick={() => save.mutate(name.trim())}
            disabled={!dirty || !name.trim() || save.isPending}
            className="flex items-center gap-1.5 rounded-md bg-brand px-3 py-2 text-sm font-semibold text-brand-foreground hover:opacity-90 disabled:opacity-40"
          >
            {save.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : saved ? <Check className="h-3.5 w-3.5" /> : null}
            {saved ? "Saved" : "Save"}
          </button>
        </div>
      </div>
      {save.isError && (
        <p className="mt-2 text-xs text-destructive">
          {save.error instanceof Error ? save.error.message : "Couldn't save your name."}
        </p>
      )}
    </Card>
  );
}

function EmailSection({ email }: { email: string }) {
  const [newEmail, setNewEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const trimmed = newEmail.trim();
    if (!trimmed || trimmed === email) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      // Supabase Auth supports changing email directly — it sends a
      // confirmation link to the new address before the change takes effect.
      const { error } = await supabase.auth.updateUser({ email: trimmed });
      if (error) throw error;
      setNotice("Check your new email address for a confirmation link.");
      setNewEmail("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't update email");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card icon={<Mail className="h-4 w-4" />} title="Email" description="Your account's sign-in email.">
      <p className="text-sm">{email}</p>
      <div className="mt-3 flex items-center gap-2">
        <input
          type="email"
          value={newEmail}
          onChange={(e) => setNewEmail(e.target.value)}
          placeholder="new-email@example.com"
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-brand"
        />
        <button
          onClick={submit}
          disabled={busy || !newEmail.trim()}
          className="shrink-0 rounded-md border border-border bg-background px-3 py-2 text-sm font-medium hover:bg-accent disabled:opacity-40"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Change email"}
        </button>
      </div>
      {notice && <p className="mt-2 text-xs text-emerald-500">{notice}</p>}
      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
    </Card>
  );
}

function PasswordSection({ email }: { email: string }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resetBusy, setResetBusy] = useState(false);
  const [resetSent, setResetSent] = useState(false);

  const changePassword = async () => {
    setError(null);
    setNotice(null);
    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    setBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      setNotice("Password updated.");
      setPassword("");
      setConfirm("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't update password");
    } finally {
      setBusy(false);
    }
  };

  const sendResetLink = async () => {
    if (!email) return;
    setResetBusy(true);
    try {
      await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/auth`,
      });
      setResetSent(true);
    } finally {
      setResetBusy(false);
    }
  };

  return (
    <Card icon={<KeyRound className="h-4 w-4" />} title="Password" description="Change your password, or email yourself a reset link.">
      <div className="grid gap-2 sm:grid-cols-2">
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="New password"
          minLength={6}
          className="rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-brand"
        />
        <input
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          placeholder="Confirm new password"
          minLength={6}
          className="rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-brand"
        />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          onClick={changePassword}
          disabled={busy || !password}
          className="rounded-md bg-brand px-3 py-2 text-sm font-semibold text-brand-foreground hover:opacity-90 disabled:opacity-40"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Update password"}
        </button>
        <button
          onClick={sendResetLink}
          disabled={resetBusy || resetSent}
          className="rounded-md border border-border bg-background px-3 py-2 text-sm font-medium hover:bg-accent disabled:opacity-60"
        >
          {resetBusy ? "Sending…" : resetSent ? "Reset link sent" : "Email me a reset link instead"}
        </button>
      </div>
      {notice && <p className="mt-2 text-xs text-emerald-500">{notice}</p>}
      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
    </Card>
  );
}

function SubscriptionSection() {
  const { subscription, isActive, loading } = useSubscription();
  const portal = useServerFn(createPortalSession);
  const [portalLoading, setPortalLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const openPortal = async () => {
    setError(null);
    try {
      setPortalLoading(true);
      const res = await portal({
        data: {
          environment: getStripeEnvironment(),
          returnUrl: `${window.location.origin}/account`,
        },
      });
      if ("error" in res) throw new Error(res.error);
      window.open(res.url, "_blank");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't open billing portal");
    } finally {
      setPortalLoading(false);
    }
  };

  return (
    <Card icon={<Crown className="h-4 w-4" />} title="Subscription" description="Your plan and billing.">
      <PaymentTestModeBanner />
      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : isActive ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-emerald-500">Pro — active</p>
            {subscription?.current_period_end && (
              <p className="text-xs text-muted-foreground">
                {subscription.cancel_at_period_end ? "Cancels" : "Renews"} on{" "}
                {new Date(subscription.current_period_end).toLocaleDateString()}
              </p>
            )}
          </div>
          <button
            onClick={openPortal}
            disabled={portalLoading}
            className="rounded-md border border-border bg-background px-3 py-2 text-sm font-medium hover:bg-accent disabled:opacity-60"
          >
            {portalLoading ? "Opening…" : "Manage billing"}
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">You're not on a paid plan.</p>
          <Link
            to="/pricing"
            className="rounded-md bg-brand px-3 py-2 text-sm font-semibold text-brand-foreground hover:opacity-90"
          >
            Upgrade to Pro
          </Link>
        </div>
      )}
      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
    </Card>
  );
}

function UsageSection() {
  const getUsageFn = useServerFn(getAiUsageSummary);
  const usageQuery = useQuery({
    queryKey: ["ai-usage-summary"],
    queryFn: () => getUsageFn(),
  });

  const usage = usageQuery.data;

  return (
    <Card
      icon={<Sparkles className="h-4 w-4" />}
      title="AI usage"
      description="A running record of your AI Builder activity (accounting only — nothing here is limited or billed by usage yet)."
    >
      {usageQuery.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : !usage || usage.totalCalls === 0 ? (
        <p className="text-sm text-muted-foreground">No AI activity recorded yet.</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Total calls" value={usage.totalCalls} />
            <Stat label="Last 30 days" value={usage.last30dCalls} />
            <Stat label="Successful" value={usage.successCount} />
            <Stat label="Failed" value={usage.failureCount} />
          </div>
          {usage.totalTokens > 0 && (
            <p className="mt-3 text-xs text-muted-foreground">
              {usage.totalTokens.toLocaleString()} tokens recorded (only counted when the provider reports them).
            </p>
          )}
          <div className="mt-4 space-y-1">
            <p className="text-xs font-medium text-muted-foreground">Recent activity</p>
            <div className="max-h-48 overflow-auto rounded-md border border-border">
              <table className="w-full text-left text-xs">
                <tbody>
                  {usage.recent.map((r) => (
                    <tr key={r.id} className="border-b border-border last:border-0">
                      <td className="px-2 py-1.5 capitalize">{r.operation.replace("_", " ")}</td>
                      <td className="px-2 py-1.5">
                        <span className={r.success ? "text-emerald-500" : "text-destructive"}>
                          {r.success ? "ok" : "failed"}
                        </span>
                      </td>
                      <td className="px-2 py-1.5 text-muted-foreground">{r.model ?? "—"}</td>
                      <td className="px-2 py-1.5 text-right text-muted-foreground">
                        {new Date(r.created_at).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-border bg-background px-3 py-2">
      <div className="text-lg font-bold">{value}</div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
    </div>
  );
}
