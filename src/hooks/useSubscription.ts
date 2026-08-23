import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getStripeEnvironment } from "@/lib/stripe";
import { useAuth } from "@/hooks/useAuth";
import { isSubscriptionRowActive, type SubscriptionRow } from "@/lib/subscription-status";

export type { SubscriptionRow };

export function useSubscription() {
  const { user } = useAuth();
  const [subscription, setSubscription] = useState<SubscriptionRow | null>(null);
  const [loading, setLoading] = useState(true);
  // Unique per hook instance, not per user: multiple components (AppNavRail,
  // the Studio route, etc.) call useSubscription() for the same user at the
  // same time, and Supabase's realtime client reuses an existing channel
  // object for a repeated `.channel(sameName)` call - a second instance
  // calling `.on()` on that already-`.subscribe()`d channel throws ("cannot
  // add `postgres_changes` callbacks ... after `subscribe()`"). A random
  // per-instance suffix means every mount gets its own channel, so there's
  // nothing to collide with.
  const instanceIdRef = useRef<string>(crypto.randomUUID());

  useEffect(() => {
    if (!user) {
      setSubscription(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    let env: "sandbox" | "live";
    try {
      env = getStripeEnvironment();
    } catch {
      setLoading(false);
      return;
    }

    const load = async () => {
      const { data } = await supabase
        .from("subscriptions")
        .select("status, price_id, current_period_end, cancel_at_period_end")
        .eq("user_id", user.id)
        .eq("environment", env)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!cancelled) {
        setSubscription((data as SubscriptionRow | null) ?? null);
        setLoading(false);
      }
    };
    load();

    const channel = supabase
      .channel(`subs-${user.id}-${instanceIdRef.current}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "subscriptions", filter: `user_id=eq.${user.id}` },
        () => load(),
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [user]);

  const isActive = isSubscriptionRowActive(subscription);

  return { subscription, isActive, loading };
}
