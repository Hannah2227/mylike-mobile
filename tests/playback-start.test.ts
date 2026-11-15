import { deepEqual, equal, ok } from 'node:assert/strict';
import { test } from 'node:test';
import { createPlaybackHandoff, createPlaybackIntent } from '../src/mobile/playback.ts';
import { createPlaybackStartProbe } from '../src/mobile/frame-metrics.ts';
import { videoStartHarness } from './helpers/video-start-harness.ts';

function native() { return { muted: true, playbackRate: 1, playing: false, plays: 0, pauses: 0,
  play() { this.playing = true; this.plays++; }, pause() { this.playing = false; this.pauses++; } }; }
test('silent prestart overlaps the transition and arrival transfers audio without restarting healthy playback', () => {
  const handoff = createPlaybackHandoff(); const previous = native(); const next = native();
  handoff.activate(previous); previous.play(); const intent = createPlaybackIntent(next, handoff);
  const prime = intent.beginPrime()!; const ticket = intent.prestart(1.25)!;
  equal(next.muted, true); equal(previous.muted, false); equal(previous.pauses, 0);
  equal(intent.finishPrime(prime), false); equal(intent.holdPrime(prime), false);
  equal(intent.sync(false, 1.25, true), 'warm'); equal(next.pauses, 0);
  const plays = next.plays; equal(intent.arrive(ticket, 1.25), true);
  equal(previous.muted, true); equal(previous.pauses, 1); equal(next.muted, false);
  equal(intent.sync(false, 1.25, true), 'warm'); // React still has the warm role
  equal(intent.sync(true, 1.25, false), 'play'); equal(next.plays, plays); equal(next.pauses, 0);
  equal(intent.cancelPrestart(ticket), false); equal(next.playing, true);
});
test('revoked prestarts cannot take audio ownership, and real background/pause still wins', () => {
  const handoff = createPlaybackHandoff(); const previous = native(); const next = native(); handoff.activate(previous);
  const intent = createPlaybackIntent(next, handoff); const old = intent.prestart(1)!;
  equal(intent.cancelPrestart(old), true); equal(intent.arrive(old, 1), false); equal(previous.muted, false);
  const current = intent.prestart(1)!; equal(intent.cancelPrestart(old), false); equal(next.playing, true);
  intent.arrive(current, 1); intent.sync(false, 1, false); equal(next.playing, false); equal(next.muted, true);
  equal(intent.arrive(current, 1), false); equal(intent.recover(current), false);
});
test('prepared registry replaces/cancels one target and ignores a removed native instance', () => {
  const handoff = createPlaybackHandoff(); const events: string[] = [];
  const control = (name: string) => ({ start: () => { events.push(`${name}:start`); return true; }, arrive: () => { events.push(`${name}:arrive`); }, cancel: () => events.push(`${name}:cancel`) });
  const first = control('first'); const remove = handoff.register('a', first); handoff.register('b', control('second'));
  handoff.prepare('a'); handoff.prepare('a'); handoff.prepare('b'); handoff.arrive('b'); handoff.cancelPending();
  deepEqual(events, ['first:start', 'first:cancel', 'second:start', 'second:arrive']);
  handoff.prepare('a'); handoff.register('a', control('replacement')); remove(); handoff.prepare('a'); handoff.arrive('a');
  deepEqual(events.slice(-4), ['first:start', 'first:cancel', 'replacement:start', 'replacement:arrive']);
});
test('native clock timing reports a paused warm frame as slow instead of calling it zero latency', () => {
  let time = 100; const values: any[] = []; const probe = createPlaybackStartProbe(() => time, value => values.push(value));
  probe.select(true, 0.05); time = 140; probe.command(); time = 150; probe.advance(0.05); deepEqual(values, []);
  time = 340; probe.advance(0.08);
  deepEqual(values, [{ prepared: true, prestarted: false, requestToCommandMs: 40, commandToAdvanceMs: 200, selectionToAdvanceMs: 240, advancedBeforeSelection: false, timedOut: false }]);
});
test('prestarted clock timing includes UI dispatch delay and measures motion before arrival', () => {
  let time = 110; const values: any[] = []; const probe = createPlaybackStartProbe(() => time, value => values.push(value));
  probe.prestart(true, 0.05, 90); probe.command(); time = 150; probe.advance(0.09); equal(probe.pending(), false); deepEqual(values, []);
  time = 180; probe.select(true, 0.09, 160);
  deepEqual(values, [{ prepared: true, prestarted: true, requestToCommandMs: 20, commandToAdvanceMs: 40, selectionToAdvanceMs: 0, advancedBeforeSelection: true, timedOut: false }]);
});
test('cancelled clock probes never report, and a timeout does not invent motion', () => {
  let time = 0; const values: any[] = []; const probe = createPlaybackStartProbe(() => time, value => values.push(value));
  probe.prestart(true, 0); probe.command(); probe.cancel(); time = 300; probe.advance(1); probe.expire(); deepEqual(values, []);
  probe.select(false, 0); probe.command(); time = 3300; probe.expire();
  equal(values[0].timedOut, true); equal(values[0].selectionToAdvanceMs, null); equal(probe.pending(), false);
});
test('real Video effects preserve prestarted motion through stale frame events, metadata and React promotion', () => {
  const video = videoStartHarness(); const previous = native(); video.handoff.activate(previous); previous.play();
  video.nativeTime(0.05); video.tick(40); video.frame(); equal(video.player.playing, false);
  const pauses = video.player.pauses; const plays = video.player.plays;
  video.tick(10); video.handoff.prepare('next', 50); equal(video.player.playing, true); equal(video.player.muted, true);
  video.frame(); equal(video.player.pauses, pauses); equal(video.player.plays, plays + 1);
  video.tick(25); video.timeUpdate(0.09); deepEqual(video.progress, []);
  video.tick(50); video.handoff.arrive('next', 114); equal(video.player.muted, false); equal(previous.pauses, 1);
  video.player.status = 'loading'; video.render(); video.player.status = 'readyToPlay'; video.render();
  equal(video.player.playing, true); equal(video.player.pauses, pauses);
  video.tick(200); video.nativeTime(0.4); video.render({ current: true, active: true, prime: false });
  equal(video.player.currentTime, 0.4); deepEqual(video.player.seeks, []); equal(video.player.plays, plays + 1);
  equal(video.player.timeUpdateEventInterval, 0.5);
  const metric = video.logs.find(value => value[0] === '[MyLike playback start]')[1];
  equal(metric.prepared, true); equal(metric.prestarted, true); equal(metric.advancedBeforeSelection, true);
  video.timeUpdate(0.45); ok(video.progress.includes(0.45)); video.deadlines(2000); equal(video.player.playing, true);
  video.unmount(); equal(video.player.playing, false);
});
test('real Video cancellation stops the silent target and leaves the current audio owner alone', () => {
  const video = videoStartHarness(); const previous = native(); video.handoff.activate(previous);
  video.nativeTime(0.05); video.frame(); video.handoff.prepare('next'); video.nativeTime(0.3); video.handoff.prepare(null);
  equal(video.player.playing, false); equal(video.player.muted, true); equal(previous.muted, false); equal(previous.pauses, 0);
  equal(video.player.currentTime, 0.05); video.handoff.arrive('missing'); equal(previous.muted, false);
  video.unmount();
});
test('real Video clock diagnostics remain pending after a decoded frame until native time advances', () => {
  const video = videoStartHarness(); video.render({ current: true, active: true, prime: false });
  video.frame(); equal(video.logs.some(value => value[0] === '[MyLike playback start]'), false);
  video.tick(205); video.timeUpdate(0.03);
  const metric = video.logs.find(value => value[0] === '[MyLike playback start]')[1];
  equal(metric.prestarted, false); equal(metric.commandToAdvanceMs, 205); equal(video.player.timeUpdateEventInterval, 0.5);
  video.unmount();
});
test('real Video bounds diagnostic sampling and never resumes an arriving target in the background', () => {
  const video = videoStartHarness(); video.nativeTime(0.05); video.frame(); video.handoff.prepare('next');
  video.handoff.arrive('next'); video.render({ current: true, active: true, prime: false });
  equal(video.player.timeUpdateEventInterval, 1 / 30); video.deadlines(3001); equal(video.player.timeUpdateEventInterval, 0.5);
  const metric = video.logs.find(value => value[0] === '[MyLike playback start]')[1]; equal(metric.timedOut, true);
  equal(video.player.playing, true); video.unmount();
  const hidden = videoStartHarness(); hidden.frame(); hidden.handoff.prepare('next'); hidden.appState.currentState = 'background';
  hidden.render({ prime: false }); hidden.handoff.arrive('next'); equal(hidden.player.muted, true); equal(hidden.player.playing, false); hidden.unmount();
});
