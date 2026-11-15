import { deepEqual, equal, ok } from 'node:assert/strict';
import { test } from 'node:test';
import { snapSpring } from '../src/mobile/motion.ts';
import { createTransitionWork } from '../src/mobile/transition-work.ts';
import { createPageSync } from '../src/mobile/page-sync.ts';

// Closed-form displacement/velocity for a critically damped spring, before
// overshoot clamping. Check behavior over time, independently of UI callbacks.
function sample(distance: number, velocity: number, extent: number, t: number) {
  const config = snapSpring(distance, velocity, extent);
  const omega = Math.sqrt(config.stiffness / config.mass);
  const start = -distance; const b = config.velocity + omega * start;
  return { ...config, displacement: (start + b * t) * Math.exp(-omega * t),
    speed: (b - omega * (start + b * t)) * Math.exp(-omega * t) };
}
test('settles inherit release speed in either direction without introducing a reverse kick', () => {
  for (const sign of [-1, 1]) {
    const initial = sample(sign * 600, sign * 1800, 800, 0);
    equal(initial.speed, sign * 1800);
    equal(initial.damping ** 2, 4 * initial.mass * initial.stiffness);
    equal(sample(sign * 600, -sign * 1800, 800, 0).speed, 0);
    let previous = 600;
    for (let t = 0; t <= 0.5; t += 1 / 120) {
      const state = sample(sign * 600, sign * 1800, 800, t);
      ok(state.displacement * sign <= 0); ok(Math.abs(state.displacement) <= previous + 1e-7);
      previous = Math.abs(state.displacement);
    }
    ok(previous < 0.1);
  }
});
test('short snaps have no long fixed tail; rapid flicks clamp at the target', () => {
  const short = sample(24, 0, 800, 0.16); const long = sample(700, 0, 800, 0.16);
  ok(Math.abs(short.displacement) < 0.02); ok(Math.abs(long.displacement) > 5);
  const flick = snapSpring(10, 9000, 800); equal(flick.velocity, 9000); equal(flick.overshootClamping, true);
  ok(snapSpring(800, Infinity, 800).velocity === 0);
  ok(Number.isFinite(snapSpring(NaN, 100, 0).stiffness));
  ok(Number.isFinite(snapSpring(Infinity, NaN, -1).velocity));
});
test('late React acknowledgements never restart a newer swipe; queue jumps still realign', () => {
  const pages = createPageSync(0);
  pages.request(1); pages.request(2);
  equal(pages.reconcile(0), false); // a progress or motion-state render
  equal(pages.reconcile(1), false); // native target is already 2
  equal(pages.reconcile(2), false);
  equal(pages.reconcile(12), true); // external queue jump
  pages.request(13); pages.reset(12); equal(pages.reconcile(13), true);
});
test('batched forward then reverse selection leaves no stale acknowledgement', () => {
  const pages = createPageSync(0);
  pages.request(1); pages.request(0);
  equal(pages.reconcile(0), false); // React batches both, still renders index 0
  equal(pages.reconcile(1), true); // later external selection must realign
  pages.request(2); pages.request(3);
  equal(pages.reconcile(3), false); equal(pages.reconcile(2), true);
});
test('deferred writes preserve visits and the latest checkpoints in store submission order', async () => {
  const submitted: string[] = []; let errors = 0;
  const work = createTransitionWork(() => errors++);
  const task = (label: string) => async () => { submitted.push(label); };
  work.hold(true);
  work.enqueue(task('visit A')); work.enqueue(task('A 1s'), 'point:A');
  work.enqueue(task('visit B')); work.enqueue(task('A 2s'), 'point:A'); work.enqueue(task('B 1s'), 'point:B');
  deepEqual(submitted, []);
  work.hold(false);
  // Submission is synchronous: a store read started now sees every queued write.
  deepEqual(submitted, ['visit A', 'visit B', 'A 2s', 'B 1s']);
  await work.flush(); equal(errors, 0);
});
test('flush drains held writes, waits for completion and survives rejected or throwing tasks', async () => {
  let errors = 0; let release!: () => void; let finished = false;
  const work = createTransitionWork(() => errors++);
  work.hold(true);
  work.enqueue(() => Promise.reject(new Error('disk')));
  work.enqueue(() => { throw new Error('sync'); });
  work.enqueue(() => new Promise<void>(resolve => { release = resolve; }));
  const flushed = work.flush().then(() => { finished = true; });
  await Promise.resolve(); equal(errors, 2); equal(finished, false);
  release(); await flushed; equal(finished, true);
  work.hold(true); let ran = false; work.enqueue(async () => { ran = true; });
  equal(ran, false); await work.flush(); equal(ran, true);
});
test('a new gesture can hold the next batch while earlier writes finish', async () => {
  let release!: () => void; const calls: string[] = [];
  const work = createTransitionWork(() => { throw new Error('unexpected failure'); });
  work.enqueue(() => new Promise<void>(resolve => { release = resolve; }));
  work.hold(true); work.enqueue(async () => { calls.push('after settle'); });
  release(); await Promise.resolve(); deepEqual(calls, []);
  work.hold(false); deepEqual(calls, ['after settle']); await work.flush();
});
