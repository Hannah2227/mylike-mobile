import { deepEqual, equal, ok, rejects } from 'node:assert/strict';
import { test } from 'node:test';
import { createRequestCache } from '../src/mobile/request-cache.ts';
import { headerCollapse, libraryOffset, prefetchIds, snapDuration } from '../src/mobile/motion.ts';

function deferredCache() {
  const requests: { key: string; signal: AbortSignal; release: (value: string) => void; fail: (error: unknown) => void }[] = [];
  const cache = createRequestCache<string>((key, signal) => new Promise((release, fail) => requests.push({ key, signal, release, fail })));
  return { cache, requests };
}
test('prefetch and foreground reads share a request while cancellation belongs to each subscriber', async () => {
  const { cache, requests } = deferredCache(); const prefetch = new AbortController();
  const first = cache.get('work', prefetch.signal); const current = cache.get('work');
  await Promise.resolve(); equal(requests.length, 1); prefetch.abort(); await rejects(first, /取消/);
  equal(requests[0].signal.aborted, false); requests[0].release('ready'); equal(await current, 'ready'); equal(cache.peek('work'), 'ready');
});
test('same-commit promotion keeps the request; obsolete windows cancel their last request', async () => {
  const { cache, requests } = deferredCache(); const warm = new AbortController();
  const old = cache.get('next', warm.signal); await Promise.resolve(); warm.abort(); const current = cache.get('next');
  await rejects(old); equal(requests[0].signal.aborted, false); requests[0].release('promoted'); equal(await current, 'promoted'); equal(requests.length, 1);
  const obsolete = new AbortController(); const cancelled = cache.get('obsolete', obsolete.signal); await Promise.resolve(); obsolete.abort(); await rejects(cancelled);
  equal(requests[1].signal.aborted, true); requests[1].release('late'); await Promise.resolve(); equal(cache.peek('obsolete'), null);
});
test('cache is bounded, expires, retries errors and does not refill after clear or overwrite a retry', async context => {
  let now = 100; context.mock.method(Date, 'now', () => now);
  const immediate = createRequestCache(async (key: string) => key, 2, 50);
  await immediate.get('a'); await immediate.get('b'); immediate.peek('a'); await immediate.get('c'); equal(immediate.peek('b'), null); equal(immediate.count(), 2);
  now += 51; equal(immediate.peek('c'), null);
  const { cache, requests } = deferredCache();
  const cleared = cache.get('clear'); await Promise.resolve(); cache.clear(); requests[0].release('valid but uncached'); equal(await cleared, 'valid but uncached'); equal(cache.peek('clear'), null);
  const old = cache.get('retry'); await Promise.resolve(); cache.forget('retry'); const fresh = cache.get('retry'); await Promise.resolve();
  requests[2].release('fresh'); equal(await fresh, 'fresh'); requests[1].release('old'); await old; equal(cache.peek('retry'), 'fresh');
  const failed = cache.get('failed'); await Promise.resolve(); requests[3].fail(new Error('offline')); await rejects(failed); equal(cache.peek('failed'), null);
  const retry = cache.get('failed'); await Promise.resolve(); requests[4].release('online'); equal(await retry, 'online');
  await rejects(cache.get('never', AbortSignal.abort())); equal(requests.length, 5);
});
test('look-ahead is a small ordered window and faster or shorter settles stay within the motion budget', () => {
  deepEqual(prefetchIds(['a', 'b', 'c', 'd'], 1), ['c', 'd', 'a']); deepEqual(prefetchIds(['a', 'b', 'c'], 2), ['b']); deepEqual(prefetchIds(['a'], 0), []);
  deepEqual(prefetchIds(['a', 'b'], -1), []); deepEqual(prefetchIds(['a', 'a', 'b'], 0), ['b']);
  equal(snapDuration(800, 0, 800), 300); ok(snapDuration(100, 0, 800) < snapDuration(700, 0, 800)); ok(snapDuration(400, 3000, 800) < snapDuration(400, 0, 800));
  for (const velocity of [-10000, -800, 0, 800, 10000]) { const duration = snapDuration(600, velocity, 800); ok(duration >= 160 && duration <= 300); }
  equal(snapDuration(NaN, 0, 0), 240);
});
test('sticky profile and category changes preserve grid depth independently of header collapse', () => {
  const height = 180;
  equal(headerCollapse(0, 0, 90, height), 90); equal(headerCollapse(90, 90, 240, height), 180);
  equal(headerCollapse(180, 500, 400, height), 180); equal(headerCollapse(180, 200, 100, height), 100);
  // Bring a deeply scrolled category under an expanded or half-collapsed profile.
  equal(libraryOffset(680, 180, 0), 500); equal(libraryOffset(680, 180, 60), 560);
  equal(headerCollapse(60, 560, 600, height), 100); equal(600 - 100, 500);
  equal(headerCollapse(60, 560, 520, height), 60); equal(libraryOffset(520, 60, 180), 640);
  equal(libraryOffset(10, 20, 0), 0);
});
