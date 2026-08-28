-- Phase 4A (Trading Dashboard): a read model over already-durable OMS data.
-- Does NOT duplicate storage and does NOT introduce a new "trades" table —
-- `trade_positions` (closed) already IS the durable, authoritative trade
-- record; this view just joins each one to its own `trade_executions` for
-- commission/fill-count/derived-exit-price, which the dashboard needs but
-- no single existing table exposes directly.
--
-- SECURITY: `security_invoker = true` makes this view run with the QUERYING
-- user's own privileges, so the existing RLS policies on `trade_positions`
-- and `trade_executions` ("Users view own positions"/"Users view own
-- executions", both `USING (auth.uid() = user_id)`, from
-- 20260815004446_...sql) apply exactly as if the view's SELECT were written
-- inline by the caller. No new authorization logic is introduced here, and
-- none is needed — this view enforces isolation by construction (via the
-- underlying tables' RLS), not by re-checking `auth.uid()` a second time.
--
-- KNOWN LIMITATION (documented, not silently papered over): when a single
-- closing fill also flips a position (see `bookAgainstExisting` in
-- src/lib/trading/oms.server.ts), the OMS attributes that one execution's
-- `position_id` to the NEW flipped position it opens, not the old position
-- it closes (oms.server.ts:333). For that rare case, the OLD (closed)
-- position's row in this view will show `commission = 0`, `fill_count = 0`,
-- and `exit_price = null` for its final closing fill, since that execution
-- is not linked back to it. This is a pre-existing OMS schema limitation,
-- not something this read-only view can correct without a new column (e.g.
-- a `flipped_from_position_id` on `trade_positions`) — out of scope for a
-- non-destructive Phase 4A view. All non-flip closes (the common case) are
-- unaffected.
create view public.v_closed_trades
with (security_invoker = true)
as
select
  tp.id as position_id,
  tp.user_id,
  tp.account_id,
  tp.symbol,
  tp.side,
  tp.qty,
  tp.avg_entry,
  tp.realized_pnl,
  tp.opened_at,
  tp.closed_at,
  coalesce(ex.commission_total, 0) as commission,
  coalesce(ex.fill_count, 0) as fill_count,
  ex.exit_price
from public.trade_positions tp
left join lateral (
  select
    sum(e.commission) as commission_total,
    count(*) as fill_count,
    -- Derived exit price: the qty-weighted average price of every fill
    -- whose side is OPPOSITE the position's own recorded side — that is
    -- structurally what "closed" this position, regardless of whether that
    -- fill happened to book zero realized P&L (an exact-breakeven close
    -- still counts). Never invented when there is nothing to derive it
    -- from (no opposite-side fill linked to this position) — `null` in
    -- that case, not a guess.
    case
      when sum(e.qty) filter (where e.side <> tp.side) > 0
        then sum(e.price * e.qty) filter (where e.side <> tp.side)
             / sum(e.qty) filter (where e.side <> tp.side)
      else null
    end as exit_price
  from public.trade_executions e
  where e.position_id = tp.id
) ex on true
where tp.status = 'closed';

grant select on public.v_closed_trades to authenticated;
grant select on public.v_closed_trades to service_role;
