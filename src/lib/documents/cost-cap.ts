// Mirrors the SQL function's own default
// (supabase/migrations/20260726000000_daily_cost_cap.sql) and the
// worker's own default (worker/src/claim.ts) — a third place to update if
// a deployment ever overrides it via DAILY_COST_CAP_CENTS, since this one
// is purely for display (the app itself never enforces this cap; the
// database does).
export const DAILY_COST_CAP_CENTS = 500;
