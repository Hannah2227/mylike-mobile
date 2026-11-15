import { deepEqual, equal, ok } from 'node:assert/strict';
import { test } from 'node:test';
import { windowDrag, windowDuration, windowPages, windowStep } from '../src/mobile/window-paging.ts';
import { slidingPlayerHarness } from './helpers/sliding-player-harness.ts';

test('the window contains only previous/current/next, including queue boundaries', () => {
  deepEqual(windowPages(0, 20), [0, 1]); deepEqual(windowPages(4, 20), [3, 4, 5]);
  deepEqual(windowPages(19, 20), [18, 19]); deepEqual(windowPages(0, 1), [0]);
});
test('short slow drags return, deliberate flicks select one work, reversals and cancellation return', () => {
  equal(windowStep(-80, -100, 800), 0); equal(windowStep(-200, -100, 800), 1);
  equal(windowStep(-25, -950, 800), 1); equal(windowStep(25, 950, 800), -1);
  equal(windowStep(-10, -2000, 800), 0); equal(windowStep(-200, 950, 800), 0);
  equal(windowStep(-2000, -5000, 800), 1); equal(windowStep(-200, -950, 800, true), 0);
  equal(windowStep(NaN, Infinity, 800), 0);
});
test('edge resistance is bounded and short remaining travel never gains a long animation tail', () => {
  equal(windowDrag(0, 100, 800, 20), -18); equal(windowDrag(0, 2000, 800, 20), -64);
  equal(windowDrag(4, -2000, 800, 20), 4000); equal(windowDrag(19, -2000, 800, 20), 15264);
  equal(windowDuration(0.1, 800), 0); ok(windowDuration(20, 800) < windowDuration(400, 800));
  equal(windowDuration(800, 800), 64); equal(windowDuration(1200, 800), 64);
});
test('all three full pages follow the same displacement; roles/window stay frozen until animation ends', () => {
  const player = slidingPlayerHarness(4); deepEqual(player.keys, ['work-3', 'work-4', 'work-5']);
  player.activate(-20); equal(player.translation('work-4'), -20); player.move(-200); player.sync();
  equal(player.translation('work-4'), -200); equal(player.translation('work-5'), 600); equal(player.translation('work-3'), -1000);
  player.up(-200, -950); player.sync(); equal(player.props.index, 4); deepEqual(player.commits, []);
  const animation = player.animations.at(-1); ok(animation.config.duration <= 64);
  player.advance(animation.config.duration / 2); player.render(); player.flushUI();
  deepEqual(player.keys, ['work-3', 'work-4', 'work-5']); equal(player.roles.find(role => role.current).id, 'work-4');
  equal(player.translation('work-5') - player.translation('work-4'), 800);
  player.advance(animation.config.duration / 2); equal(player.touch.phase.value, 3); deepEqual(player.commits, []);
  const incoming = player.layers.find((layer: any) => layer.key === 'work-5'); equal(player.translation('work-5'), 0);
  player.sync(); equal(player.props.index, 5); deepEqual(player.keys, ['work-4', 'work-5', 'work-6']);
  const current = player.layers.find((layer: any) => layer.key === 'work-5');
  equal(current.type, incoming.type); equal(current.key, incoming.key); equal(player.translation('work-5'), 0);
  equal(player.translation('work-4'), -800); equal(player.translation('work-6'), 800); equal(player.ref.current.isMoving(), false);
});
test('late React acknowledgements cannot reset the completed position or recycle the window early', () => {
  const player = slidingPlayerHarness(4); player.activate(-25); player.up(-25, -950); player.advance(64);
  player.flushRN(false); player.render({ index: 4 }); player.flushUI();
  equal(player.translation('work-5'), 0); equal(player.touch.phase.value, 3); equal(player.ref.current.go(6), false);
  player.render({ index: 5 }); player.sync(); equal(player.translation('work-5'), 0); equal(player.touch.phase.value, 0);
  player.render(); player.sync(); equal(player.translation('work-5'), 0);
});
test('a new drag during the short settle resumes against the next installed three-page window', () => {
  const player = slidingPlayerHarness(4); player.activate(-25); player.up(-25, -950); player.advance(20);
  const old = player.animations.at(-1); const at = player.translation('work-5');
  player.activate(-20); player.move(-100); equal(player.translation('work-5'), at); // finish the existing transition first
  player.advance(64); player.sync(); equal(player.props.index, 5); equal(player.touch.phase.value, 1);
  equal(player.translation('work-5'), -100); deepEqual(player.keys, ['work-4', 'work-5', 'work-6']);
  old.callback(true); equal(player.touch.phase.value, 1); equal(player.translation('work-5'), -100);
  player.move(-180); player.up(-180, -950); player.advance(64); player.sync();
  equal(player.props.index, 6); equal(player.translation('work-6'), 0); equal(player.motions.at(-1), false);
});
test('a completed quick swipe is retained during settling without running overlapping animations', () => {
  const player = slidingPlayerHarness(4); player.activate(-25); player.up(-25, -950); player.advance(10);
  player.activate(-25, -950); player.up(-25, -950); equal(player.animations.length, 1);
  player.advance(64); player.sync(); equal(player.props.index, 5); equal(player.touch.phase.value, 2);
  equal(player.animations.length, 2); equal(player.translation('work-5'), 0); ok(!player.motions.includes(false));
  player.advance(64); player.sync(); equal(player.props.index, 6); equal(player.ref.current.isMoving(), false);
});
test('backward paging and a pending reversal preserve the same media positions at each window change', () => {
  const player = slidingPlayerHarness(4); player.activate(200); player.up(200, 950); player.advance(64);
  equal(player.translation('work-3'), 0); player.sync(); equal(player.props.index, 3); equal(player.translation('work-3'), 0);
  player.activate(-25); player.up(-25, -950); player.advance(10);
  player.activate(200, 950); player.up(200, 950); player.advance(64); player.sync(); equal(player.props.index, 4);
  player.advance(64); player.sync(); equal(player.props.index, 3); equal(player.translation('work-3'), 0);
});
test('cancelled, short and edge gestures return and unlock even when the committed index does not change', () => {
  const player = slidingPlayerHarness(); player.activate(100); player.up(100, 400); player.advance(64); player.sync();
  equal(player.props.index, 0); equal(player.translation('work-0'), 0); equal(player.ref.current.isMoving(), false);
  player.activate(-80); player.up(-80, -100); player.advance(64); player.sync(); equal(player.props.index, 0);
  player.activate(-200); player.pan.onFinalize(); player.advance(64); player.sync();
  equal(player.props.index, 0); equal(player.touch.phase.value, 0);
});
test('a cancelled or short pending gesture does not replay after the first transition', () => {
  for (const cancelled of [true, false]) {
    const player = slidingPlayerHarness(4); player.activate(-25); player.up(-25, -950); player.advance(10);
    player.activate(-30); player.up(-30, cancelled ? -950 : -100, cancelled); player.advance(64); player.sync();
    equal(player.props.index, 5); equal(player.touch.phase.value, 0); equal(player.animations.length, 1);
  }
});
test('background, external selection, resize and unmount revoke old motion and delayed callbacks', () => {
  const player = slidingPlayerHarness(4); player.activate(-25); player.up(-25, -950); player.advance(10);
  const old = player.animations.at(-1); player.render({ enabled: false }); player.sync();
  old.callback(true); player.sync(); equal(player.props.index, 4); equal(player.translation('work-4'), 0); equal(player.ref.current.go(5), false);
  player.render({ enabled: true, index: 7 }); player.sync(); equal(player.translation('work-7'), 0);
  player.activate(-25); player.up(-25, -950); player.advance(10); player.render({ height: 900 }); player.sync();
  equal(player.props.index, 7); equal(player.translation('work-7'), 0); equal(player.translation('work-8'), 900);
  equal(player.ref.current.go(8), true); player.flushUI(); player.advance(64); player.unmount(); player.sync();
  equal(player.props.index, 7); equal(player.ref.current.go(8), false);
});
test('automatic advance uses the same animation and respects album/hold/pinch/seek ownership', () => {
  const player = slidingPlayerHarness(4); player.touch.owner.value = 4;
  equal(player.pan.enabled.value, false); equal(player.ref.current.go(5), false);
  player.activate(-200); player.up(-200, -950); player.sync(); equal(player.props.index, 4);
  player.touch.owner.value = -1; equal(player.ref.current.go(6), false); equal(player.ref.current.go(5), true);
  player.flushUI(); equal(player.props.index, 4); player.advance(64); player.sync();
  equal(player.props.index, 5); equal(player.translation('work-5'), 0);
});
test('an external selection revokes an already-completed animation before its RN callback arrives', () => {
  const player = slidingPlayerHarness(4); player.activate(-25); player.up(-25, -950); player.advance(64);
  equal(player.touch.phase.value, 3); player.render({ index: 9 });
  player.flushRN(false); equal(player.props.index, 9); player.sync();
  deepEqual(player.commits, []); equal(player.translation('work-9'), 0); equal(player.ref.current.isMoving(), false);
});
test('large libraries and fractional viewport sizes retain the same small page translations', () => {
  const player = slidingPlayerHarness(10000, 10003); player.render({ height: 799.5 }); player.sync();
  equal(player.translation('work-10000'), 0); equal(player.translation('work-10001'), 799.5);
  player.activate(-200); player.up(-200, -950); player.advance(64); player.sync();
  equal(player.props.index, 10001); equal(player.translation('work-10001'), 0); equal(player.keys.length, 3);
});
test('prestart is requested on release before the animation ends, while selection/window still wait', () => {
  const player = slidingPlayerHarness(4); player.activate(-25); player.sync(); deepEqual(player.targets, []);
  player.up(-25, -950); player.sync(); deepEqual(player.targets, [{ index: 5, at: 0 }]); deepEqual(player.commits, []);
  deepEqual(player.keys, ['work-3', 'work-4', 'work-5']); player.advance(64); player.sync();
  deepEqual(player.commits, [5]); deepEqual(player.arrivals, [64]); equal(player.translation('work-5'), 0);
});
test('pending gestures retain the original release timestamp and cancellation revokes stale prestart requests', () => {
  const player = slidingPlayerHarness(4); player.activate(-25); player.up(-25, -950); player.sync(); player.advance(10);
  player.activate(-25); player.up(-25, -950); player.advance(64); player.sync();
  deepEqual(player.targets, [{ index: 5, at: 0 }, { index: 6, at: 10 }]);
  const other = slidingPlayerHarness(4); other.activate(-25); other.up(-25, -950);
  other.render({ enabled: false }); other.sync(); ok(other.targets.every(value => value.index === null));
});
