import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useAuth } from "@/hooks/useAuth";
import { useSubscription } from "@/hooks/useSubscription";
import { isStudioGateTestBypassed, isStudioGateLocalPaidBypassed } from "@/lib/subscription-status";
import { BuilderWorkspace, type BuilderTab } from "@/components/builder/BuilderWorkspace";

/**
 * Phase 5A-5A — the auth-gate + tab-state shell shared by `/builder` and
 * `/builder/$id`. Extracted verbatim out of `src/routes/builder.tsx`'s own
 * `BuilderRoute` (Phase 5A-1) so a second route can reuse the EXACT same
 * gate logic instead of a copy — both routes already run the identical
 * `beforeLoad`/`checkStudioAccess` policy in their own `Route` config; this
 * component is only the client-side "auth/subscription changed while
 * already mounted" watch plus the tab-state Phase 5A-1 already required to
 * live above `BuilderWorkspace`.
 *
 * `indicatorId` is the one thing that differs between the two routes: `/builder`
 * renders this with it `undefined` (a brand-new project), `/builder/$id`
 * passes the route's own `params.id` (Phase 5A-5A's reopen entry point) —
 * threaded straight into `useBuilderProject` via `BuilderWorkspace`.
 */
export function BuilderGate({ indicatorId }: { indicatorId?: string }) {
  const navigate = useNavigate();
  const testBypassed = isStudioGateTestBypassed();
  const localPaidBypassed = isStudioGateLocalPaidBypassed();
  const { user, loading: authLoading } = useAuth();
  const { isActive: isPaid, loading: subLoading } = useSubscription();
  const ready = !authLoading && !subLoading;
  const effectivelyPaid = isPaid || localPaidBypassed;
  const authorized = testBypassed || (ready && !!user && effectivelyPaid);

  useEffect(() => {
    if (testBypassed || !ready) return;
    if (!user) {
      navigate({ to: "/auth", replace: true });
      return;
    }
    if (!effectivelyPaid) {
      navigate({ to: "/pricing", replace: true });
    }
  }, [testBypassed, ready, user, effectivelyPaid, navigate]);

  // Active mobile/tablet tab lives at the route level (not inside
  // BuilderWorkspace or any individual panel) so it survives whatever
  // BuilderWorkspace itself does internally, per the Phase 5A-1 brief.
  const [activeTab, setActiveTab] = useState<BuilderTab>("chat");

  if (!authorized) return <BuilderLoadingScreen />;
  return <BuilderWorkspace activeTab={activeTab} onTabChange={setActiveTab} signedIn={!!user} initialIndicatorId={indicatorId} />;
}

export function BuilderLoadingScreen() {
  return (
    <div className="flex h-screen w-screen items-center justify-center bg-background text-foreground">
      <div className="flex flex-col items-center gap-3">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-border border-t-brand" />
        <p className="text-sm text-muted-foreground">Loading Indicator Builder…</p>
      </div>
    </div>
  );
}
