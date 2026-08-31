import { createFileRoute, isNotFound, Link, notFound, redirect } from "@tanstack/react-router";
import { queryOptions } from "@tanstack/react-query";
import { getIndicator } from "@/lib/indicators.functions";
import { checkStudioAccess } from "@/lib/subscription-status";
import { BuilderGate, BuilderLoadingScreen } from "@/components/builder/BuilderGate";

/**
 * Phase 5A-5A — reopening an existing indicator project. Uses this repo's
 * established identity-route convention (`src/routes/s.$id.tsx`'s
 * `createFileRoute(".../$id")` + loader `ensureQueryData` + `notFound()`
 * shape), NOT a query-string identity model.
 *
 * Filename is `builder_.$id.tsx`, not `builder.$id.tsx`: TanStack Router's
 * flat-file convention nests a dot-segmented file under a SAME-NAMED
 * sibling file when one exists (`builder.tsx` already does) — without the
 * trailing underscore, this route becomes a CHILD of `/builder`, and since
 * `builder.tsx`'s own component renders `<BuilderGate />` directly (no
 * `<Outlet />`), the child's real component — and its real `useParams().id`
 * — would never actually mount, even though the loader/head still run.
 * That silent-nesting failure is exactly what Phase 5A-5A's first hosted QA
 * pass caught (URL and tab title updated correctly; the workspace itself
 * stayed on the blank "no project" state). The trailing underscore
 * (documented TanStack Router escape syntax) makes this a genuine SIBLING
 * of `/builder` instead — same public URL (`/builder/$id`), no `<Outlet />`
 * needed anywhere, `/s/$id` never hit this because no `s.tsx` file exists
 * to nest under.
 *
 * `getIndicator` is the exact same, already-existing, already RLS-scoped
 * server function Chart Studio's own "Saved" widget uses — no new endpoint.
 * The loader primes the `["indicator", id]` query into the router's cache
 * (`context.queryClient.ensureQueryData`) BEFORE the route ever renders,
 * exactly like `/s/$id`; `useBuilderProject.ts` reads the SAME query key,
 * so by the time `BuilderWorkspace` mounts the data is already warm — one
 * indicator read total, not two.
 *
 * Every failure mode (garbage id, missing row, another user's row hidden by
 * RLS, a genuinely deleted row, a transient request failure) collapses to
 * the SAME `notFound()`/`notFoundComponent` — deliberately: distinguishing
 * "doesn't exist" from "exists but isn't yours" would leak exactly the
 * information RLS is designed to hide.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const indicatorQueryOptions = (id: string) =>
  queryOptions({
    queryKey: ["indicator", id],
    queryFn: () => getIndicator({ data: { id } }),
  });

export const Route = createFileRoute("/builder_/$id")({
  ssr: false,
  beforeLoad: async () => {
    const access = await checkStudioAccess();
    if (access === "unauthenticated") throw redirect({ to: "/auth" });
    if (access === "unpaid") throw redirect({ to: "/pricing" });
  },
  loader: async ({ context, params }) => {
    if (!UUID_RE.test(params.id)) throw notFound();
    try {
      const row = await context.queryClient.ensureQueryData(indicatorQueryOptions(params.id));
      if (!row) throw notFound();
      return row;
    } catch (e) {
      if (isNotFound(e)) throw e;
      throw notFound();
    }
  },
  pendingComponent: BuilderLoadingScreen,
  head: ({ loaderData }) => ({
    meta: [
      { title: loaderData ? `${loaderData.name} — Signal Goat AI` : "Indicator Builder — Signal Goat AI" },
      { name: "description", content: "Describe, generate, preview, and refine trading indicators before sending them into Chart Studio." },
    ],
  }),
  notFoundComponent: () => (
    <div className="flex h-screen w-screen flex-col items-center justify-center gap-3 bg-background px-4 text-center text-foreground">
      <h1 className="text-lg font-semibold">Indicator not found</h1>
      <p className="max-w-sm text-sm text-muted-foreground">This indicator doesn't exist, was deleted, or isn't available to your account.</p>
      <Link to="/builder" className="mt-2 rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-brand-foreground hover:opacity-90">
        Start a new project
      </Link>
    </div>
  ),
  component: BuilderIdRoute,
});

function BuilderIdRoute() {
  const { id } = Route.useParams();
  return <BuilderGate indicatorId={id} />;
}
