import { createFileRoute, redirect } from "@tanstack/react-router";
import { checkStudioAccess } from "@/lib/subscription-status";
import { BuilderGate, BuilderLoadingScreen } from "@/components/builder/BuilderGate";

/**
 * Phase 5A-1 — Indicator Builder (`/builder`). Gated exactly like Studio/
 * Dashboard/Trade Explorer/Journal Analytics: same `beforeLoad`/
 * `checkStudioAccess` policy, copied verbatim from `journal.tsx`'s own
 * `Route` — no new auth architecture.
 *
 * This is a dedicated top-level workspace, NOT a Chart Studio tab/widget,
 * NOT a second rendering engine, and NOT a second indicator-generation
 * pipeline (see the Phase 5A audit's "one canonical chain" rule).
 *
 * Phase 5A-5A extracted the actual gate/tab-state logic into
 * `BuilderGate` (`src/components/builder/BuilderGate.tsx`) so `/builder/$id`
 * (reopening an existing project) can reuse it verbatim rather than a
 * second copy — this route renders it with no `indicatorId`, i.e. always a
 * brand-new project, exactly as it always has.
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
  component: () => <BuilderGate />,
});
