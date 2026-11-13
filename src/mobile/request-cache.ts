type Flight<T> = { controller: AbortController; promise: Promise<T>; users: number; done: boolean; cacheable: boolean };
const cancelled = () => new Error('已取消取链');
// Each caller owns its subscription, not the underlying request. Promotion from
// prefetch to the visible slot can reuse the same request across React cleanups.
export function createRequestCache<T>(resolve: (key: string, signal: AbortSignal) => Promise<T>, limit = 8, ttl = 120000) {
  const cache = new Map<string, { value: T; expires: number }>(); const flights = new Map<string, Flight<T>>();
  function peek(key: string): T | null {
    const hit = cache.get(key); if (!hit) return null;
    if (hit.expires <= Date.now()) { cache.delete(key); return null; }
    cache.delete(key); cache.set(key, hit); return hit.value;
  }
  function get(key: string, signal?: AbortSignal): Promise<T> {
    if (signal?.aborted) return Promise.reject(cancelled());
    const cached = peek(key); if (cached !== null) return Promise.resolve(cached);
    let job = flights.get(key);
    if (!job) {
      const created: Flight<T> = { controller: new AbortController(), promise: null!, users: 0, done: false, cacheable: true };
      flights.set(key, created); job = created;
      created.promise = Promise.resolve().then(() => resolve(key, created.controller.signal)).then(value => {
        if (created.controller.signal.aborted || created.users === 0) throw cancelled();
        if (created.cacheable) { cache.delete(key); cache.set(key, { value, expires: Date.now() + ttl }); while (cache.size > limit) cache.delete(cache.keys().next().value!); }
        return value;
      }).finally(() => { created.done = true; if (flights.get(key) === created) flights.delete(key); });
    }
    const flight = job; flight.users++;
    return new Promise<T>((accept, reject) => {
      let settled = false;
      function finish(ok: boolean, value: unknown) {
        if (settled) return; settled = true; signal?.removeEventListener('abort', abort); flight.users--;
        if (ok) accept(value as T); else reject(value);
        // Give a warm -> current handover in this commit a chance to subscribe.
        void Promise.resolve().then(() => {
          if (flight.users === 0 && !flight.done) { flight.controller.abort(); if (flights.get(key) === flight) flights.delete(key); }
        });
      }
      function abort() { finish(false, cancelled()); }
      signal?.addEventListener('abort', abort, { once: true });
      flight.promise.then(value => finish(true, value), error => finish(false, error));
    });
  }
  function forget(key: string) { cache.delete(key); const job = flights.get(key); if (job) { job.cacheable = false; flights.delete(key); } }
  function clear() { const count = cache.size; cache.clear(); for (const job of flights.values()) job.cacheable = false; return count; }
  return { get, peek, forget, clear, count: () => cache.size };
}
