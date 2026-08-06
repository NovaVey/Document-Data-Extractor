// Minimal fake for a supabase-js query-builder chain: every named method
// returns the same chainable object (so any call sequence — .eq().eq(),
// .update().eq().select().maybeSingle(), a bare .insert() — keeps
// resolving to itself), and it's awaitable directly via `then` (so a
// caller that never terminates the chain with .single()/.maybeSingle(),
// like saveCorrection()'s bare `await ...update().eq().eq()`, still
// resolves to `result` the same way a real supabase-js response would).
export function chainable(result: { data?: unknown; error?: unknown }) {
  // This exists purely to satisfy the runtime call shapes the Server
  // Actions under test actually make, not to model supabase-js's real
  // type surface.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const obj: any = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === "then") {
          return (resolve: (v: typeof result) => void) => resolve(result);
        }
        if (prop === "single" || prop === "maybeSingle") {
          return async () => result;
        }
        return () => obj;
      },
    },
  );
  return obj;
}
