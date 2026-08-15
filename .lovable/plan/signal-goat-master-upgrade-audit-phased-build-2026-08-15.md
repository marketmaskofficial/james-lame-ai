# Signal Goat — Master Upgrade (audit + phased build)

## Audit of what you already have

**Already implemented (keep, do not rebuild)**
- Auth, profiles, Stripe subscriptions + Pro gating, pricing/checkout routes.
- AI chat generation stream (`api/generate.ts`, ~945 lines of Pine v6 prompt playbooks: ICT, SMC, order flow, vision, strategies), image + code-file attachments, v6 sanitizer.
- Chart Studio (`/studio`): SGScript runtime + Web Worker sandbox, stdlib (~30 indicators), lightweight-charts renderer with panes/overlay drawings, CodeMirror editor, live Binance WebSocket feed, paste → auto-detect Pine → AI translate → auto-repair pipeline.
- Database: profiles, scripts, messages, indicators, watchlists, alerts, subscriptions — all with RLS and owner isolation.
- Backtesting server fn (fixed RSI / MA-cross strategies), alerts cron, watchlists, analyze-indicator AI.

**Partially implemented (extend)**
- Runtime is `new Function` in a worker with a frozen scope + regex bans — sandboxed but not a real restricted interpreter.
- Indicators table stores only `code/settings/is_overlay` — no spec, no Pine twin, no versions.
- Backtest only runs two built-in strategies, not user indicators.
- `/app` and `/studio` are separate worlds; handoff exists but conversation ≠ project.

**Missing**
- Indicator specification model, validation/repaint layers, version history, generated settings UI, paper trading, broker layer, OMS/risk, journal/analytics, instrument mapping.

**Should not touch**: Supabase generated clients, auth gate, Stripe webhook, existing branding/design.

**Architecture risks**: `app.tsx` is 2,645 lines and `generate.ts` 945 — both need splitting before more features land; runtime hardening; no test suite.

## Phased build (each phase ships working, nothing is replaced)

**Phase 1 — Indicator project model (source of truth)**
Migration adding `indicator_versions` (version, spec jsonb, pine, sgscript, settings, changelog) and spec/pine/kind/symbol/timeframe columns on the existing `indicators` table. No data loss — current rows become v1. Server fns extended in `indicators.functions.ts`: save version, list, restore, duplicate, diff.

**Phase 2 — Structured generation pipeline**
Split `generate.ts` prompt into `src/lib/ai/` modules (playbooks stay byte-identical). Add a single structured pass that returns: spec JSON + Pine + SGScript, instead of Pine only. Conversational edits pass the current spec back so only affected parts change.

**Phase 3 — Validation + self-correction**
`src/lib/validate/`: Pine static checks (balanced tokens, v6 grammar, series/simple type rules, plot-scope, object limits, missing-output, request.security/lookahead → repaint classification) and SGScript dry-run in the worker. Failures feed the existing repair loop, max 2 retries. UI shows honest labels: "static validation passed" — never "TradingView compiled".

**Phase 4 — Runtime + settings**
Extend SGScript stdlib with the missing primitives (vwma, stoch, roc, correlation, variance, sessions, prev-day/week/month levels, HTF closed-candle helper, market-structure/FVG/sweep primitives) so ICT requests are expressible without templates. Auto-generate the settings panel from `input()` specs; changing a setting re-runs the worker only, no regeneration. Incremental last-bar recompute on live ticks instead of full recalculation.

**Phase 5 — AI ↔ Code ↔ Chart**
One-click **Add to Chart** from `/app`: saves project version, validates runtime, opens Studio on the right symbol/timeframe with settings loaded. Studio gains a project sidebar (rename/duplicate/delete/version history/restore/export Pine) and an "Ask AI to fix" button that sends code + spec + validation errors.

**Phase 6 — Backtesting + paper trading**
Generalize the backtest engine to run any SGScript strategy's signal output over loaded history with real metrics (no fabrication). Add a `paper_orders`/`paper_positions` schema and a simulated OMS with a persistent PAPER badge.

**Phase 7+ — Broker layer (behind feature flags)**
Generalized adapter interface, OMS + risk engine, Tradovate adapter, chart trading UI, journal + indicator attribution analytics. These are designed for now (interfaces, instrument mapping, flags) and built only after Phases 1–6 are stable.

## Notes
- Data-honesty rule enforced throughout: no fabricated footprint/L2/delta from OHLCV; the AI explains data limits instead.
- Every phase ends with a regression check on signup/login, subscriptions, chat, saved scripts, saved indicators, Studio live chart.

I'll start with Phase 1 and 2 after approval, then keep going phase by phase.
