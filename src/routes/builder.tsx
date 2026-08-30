import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useSubscription } from "@/hooks/useSubscription";
import { checkStudioAccess, isStudioGateTestBypassed, isStudioGateLocalPaidBypassed } from "@/lib/subscription-status";
import { BuilderWorkspace, type BuilderTab } from "@/components/builder/BuilderWorkspace";

/**
 * Phase 5A-1 — Indicator Builder (`/builder`). Gated exactly like Studio/
 * Dashboard/Trade Explorer/Journal Analytics: same `beforeLoad`/
 * `checkStudioAccess` policy, copied verbatim from `journal.tsx`'s own
 * `Route` — no new auth architecture.
 *
 * This is a dedicated top-level workspace, NOT a Chart Studio tab/widget,
 * NOT a second rendering engine, and NOT a second indicator-generation
 * pipeline (see the Phase 5A audit's "one canonical chain" rule). Phase
 * 5A-1 is UI shell + routing only — no AI call, no persistence, no
 * SGScript/Pine execution, no chart renderer, no Add-to-Chart hand-off.
 * Those are wired in later 5A sub-phases against the exact same canonical
 * modules Chart Studio already uses, never a duplicate of them.
 */
export const Route = createFileRoute("/builder")({
  ssr: false,
  beforeLoad: async () => {
    const access = await checkStudioAccess();
    if (access === "unauthenticated") throw redirect({ to: "/auth" });
    if (access === "unpaid") throw redirect({ to: "/pricing" });
  },
  pendingComponent: BuilderLoadingScreen,
  head: () => ({
    meta: [
      { title: "Indicator Builder — Signal Goat AI" },
      { name: "description", content: "Describe, generate, preview, and refine trading indicators before sending them into Chart Studio." },
    ],
  }),
  component: BuilderRoute,
});

function BuilderLoadingScreen() {
  return (
    <div className="flex h-screen w-screen items-center justify-center bg-background text-foreground">
      <div className="flex flex-col items-center gap-3">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-border border-t-brand" />
        <p className="text-sm text-muted-foreground">Loading Indicator Builder…</p>
      </div>
    </div>
  );
}

/** Same two-layer gate shape as every other top-level route component in
 * this app: `beforeLoad` stops a fresh navigation, this additionally
 * watches auth/subscription state changing while already mounted. */
function BuilderRoute() {
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
  return <BuilderWorkspace activeTab={activeTab} onTabChange={setActiveTab} />;
}
