import { Link, useLocation } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Bell, Code2, Crown, History, LayoutDashboard, LineChart, LogOut, NotebookText, ScrollText, Wand2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useSubscription } from "@/hooks/useSubscription";
import { listAlertNotifications } from "@/lib/alerts.functions";

function RailIcon({
  icon,
  active,
  title,
  onClick,
}: {
  icon: React.ReactNode;
  active?: boolean;
  title: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={`flex h-9 w-9 items-center justify-center rounded-lg transition ${
        active
          ? "bg-accent text-foreground"
          : "text-muted-foreground hover:bg-accent hover:text-foreground"
      }`}
    >
      {icon}
    </button>
  );
}

/** Same look as `RailIcon`, but a real navigation `<Link>` rather than an
 * action button — for the two primary app-surface destinations (Studio,
 * Dashboard) that a route change (not a callback prop) should handle. */
function RailLink({ to, icon, active, title }: { to: string; icon: React.ReactNode; active: boolean; title: string }) {
  return (
    <Link
      to={to}
      title={title}
      className={`flex h-9 w-9 items-center justify-center rounded-lg transition ${
        active
          ? "bg-accent text-foreground"
          : "text-muted-foreground hover:bg-accent hover:text-foreground"
      }`}
    >
      {icon}
    </Link>
  );
}

/**
 * Global left-side application rail: brand/home link, the current Chart
 * Studio AI-Builder shortcuts (New / History / Alerts), plus account chrome
 * (upgrade CTA, avatar, sign out, or log in / sign up when signed out).
 *
 * This is the single shared shell every authenticated route should mount —
 * extracted from the legacy `/app` chat page's inline "Left rail" (see git
 * history of src/routes/app.tsx) so Chart Studio (`/studio`, now the
 * canonical landing surface per UI-5c-canonical-studio-route) and any future
 * route render the exact same nav instead of a page-specific copy.
 *
 * UI-5c-studio-shell-fix follow-up: /app's original top icon group (New
 * chat / Alerts bell / History) was dropped entirely in the first pass of
 * this extraction as "chat-specific local state, out of scope." That was
 * wrong — those are real, still-needed navigation actions, they just needed
 * to be re-pointed at Chart Studio's modern equivalents instead of the old
 * chat page's own state:
 *   - New chat -> New AI Builder project (`onNewProject`): resets the SAME
 *     AI build session Chart Studio's own "Pick a template" flow already
 *     resets (`onPickTemplate` in src/routes/studio.tsx) — not a second
 *     mechanism.
 *   - History -> the AI Builder's real persisted history surface, which is
 *     Chart Studio's "Saved" dock panel (per-project version history, see
 *     `historyFor`/`listVersions` in studio.tsx) — deliberately NOT the
 *     dock's own "history" tab, which is unrelated trade-order history.
 *   - Alerts bell -> there is no distinct site-wide notifications system in
 *     this codebase (confirmed by search); the old bell's real backing data
 *     (`alert_notifications` / `listAlertNotifications`, unread count) now
 *     lives entirely inside Chart Studio's own trading Alerts widget
 *     (AlertsSidePanel). Rather than fabricate a second notifications
 *     feature or duplicate that widget, this rail's Alerts icon is an
 *     honest shortcut that focuses the SAME Alerts widget instance, and its
 *     badge reads the exact same `["alert-notifications"]` query
 *     AlertsSidePanel itself uses (shared cache, not a parallel data path).
 * All three action props are optional so this rail still degrades cleanly
 * (icons simply become no-ops) on any future route that doesn't wire them.
 */
export function AppNavRail({
  onNewProject,
  onOpenHistory,
  onOpenAlerts,
}: {
  /** Starts a fresh AI Builder project — same reset Chart Studio's own "Pick a template" flow uses. */
  onNewProject?: () => void;
  /** Opens Chart Studio's persisted AI-project history (the Saved dock panel's per-project version history). */
  onOpenHistory?: () => void;
  /** Focuses Chart Studio's own trading Alerts widget — a shortcut, not a second widget. */
  onOpenAlerts?: () => void;
} = {}) {
  const { user } = useAuth();
  const { isActive: isPro } = useSubscription();
  const qc = useQueryClient();
  const listAlertNotificationsFn = useServerFn(listAlertNotifications);
  const { pathname } = useLocation();

  // Real, not fabricated: the same triggered-alert unread count Chart
  // Studio's AlertsSidePanel computes from this exact query, so the badge
  // and the widget it shortcuts to can never disagree.
  const notificationsQuery = useQuery({
    queryKey: ["alert-notifications"],
    queryFn: () => listAlertNotificationsFn(),
    enabled: Boolean(user),
    refetchInterval: 60_000,
  });
  const unreadAlertCount = (notificationsQuery.data ?? []).filter((n) => !n.read).length;

  const signOut = async () => {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
  };

  return (
    <aside className="flex w-14 shrink-0 flex-col items-center justify-between border-r border-border bg-sidebar py-4">
      <div className="flex flex-col items-center gap-3">
        <Link
          to="/"
          title="Home"
          className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand font-black text-brand-foreground"
        >
          G
        </Link>
        <RailLink to="/studio" icon={<LineChart className="h-4 w-4" />} active={pathname.startsWith("/studio")} title="Chart Studio" />
        <RailLink to="/builder" icon={<Code2 className="h-4 w-4" />} active={pathname.startsWith("/builder")} title="Indicator Builder" />
        <RailLink to="/dashboard" icon={<LayoutDashboard className="h-4 w-4" />} active={pathname.startsWith("/dashboard")} title="Trading Dashboard" />
        <RailLink to="/trades" icon={<ScrollText className="h-4 w-4" />} active={pathname.startsWith("/trades")} title="Trade Explorer" />
        <RailLink to="/journal" icon={<NotebookText className="h-4 w-4" />} active={pathname.startsWith("/journal")} title="Journal Analytics" />
        <div className="h-px w-6 bg-border" />
        <RailIcon icon={<Wand2 className="h-4 w-4" />} title="New AI Builder project" onClick={onNewProject} />
        <RailIcon icon={<History className="h-4 w-4" />} title="AI Builder history" onClick={onOpenHistory} />
        <div className="relative">
          <RailIcon icon={<Bell className="h-4 w-4" />} title="Alerts" onClick={onOpenAlerts} />
          {user && unreadAlertCount > 0 && (
            <span className="pointer-events-none absolute -right-0.5 -top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-brand px-0.5 text-[8px] font-semibold text-brand-foreground">
              {unreadAlertCount > 9 ? "9+" : unreadAlertCount}
            </span>
          )}
        </div>
      </div>
      <div className="flex flex-col items-center gap-3">
        {user ? (
          <>
            {isPro ? (
              <div
                title="Signal Goat AI Pro"
                className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-amber-400 to-brand text-brand-foreground"
              >
                <Crown className="h-4 w-4" />
              </div>
            ) : (
              <Link
                to="/pricing"
                title="Upgrade to Pro"
                className="flex h-8 w-8 items-center justify-center rounded-full border border-brand/40 text-brand hover:bg-brand/10"
              >
                <Crown className="h-4 w-4" />
              </Link>
            )}
            <Link
              to="/account"
              title="Account settings"
              className="flex h-8 w-8 items-center justify-center rounded-full bg-brand text-[11px] font-bold text-brand-foreground hover:opacity-90"
            >
              {(user.email ?? "?").slice(0, 1).toUpperCase()}
            </Link>
            <button
              onClick={signOut}
              title="Sign out"
              className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </>
        ) : (
          <>
            <Link to="/auth" className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:text-foreground">
              Log In
            </Link>
            <Link
              to="/auth"
              className="rounded-md bg-foreground px-3 py-1.5 text-xs font-semibold text-background hover:opacity-90"
            >
              Sign Up
            </Link>
          </>
        )}
      </div>
    </aside>
  );
}
