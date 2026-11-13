import { deepEqual, equal } from 'node:assert/strict';
import { test } from 'node:test';
import { createPlaybackHandoff, createPlaybackIntent, resumeSeekTarget } from '../src/mobile/playback.ts';
test('promotion preserves a decoded first frame but restores a real saved position', () => {
  equal(resumeSeekTarget(0, 0, 60), null); equal(resumeSeekTarget(0, 0.05, 60), null); equal(resumeSeekTarget(0, 0.1, 60), null);
  equal(resumeSeekTarget(24, 0.05, 60), 24); equal(resumeSeekTarget(24, 24.03, 60), null);
  equal(resumeSeekTarget(0, 1, 60), 0); equal(resumeSeekTarget(80, 0, 60), 59.95);
  equal(resumeSeekTarget(NaN, NaN, 60), 0);
  equal(resumeSeekTarget(0, 0.08, 0.08), 0);
});

function nativeTarget() {
  return { muted: true, playbackRate: 1, playing: true, plays: 0, pauses: 0,
    play() { this.playing = true; this.plays++; }, pause() { this.playing = false; this.pauses++; } };
}

test('promotion issues play even with a stale playing snapshot and invalidates all prime deadlines', () => {
  const handoff = createPlaybackHandoff(); const player = nativeTarget(); const intent = createPlaybackIntent(player, handoff);
  const prime = intent.beginPrime()!; equal(player.plays, 1); equal(player.playing, true);
  intent.play(2); equal(player.plays, 2); equal(player.playbackRate, 2); equal(player.muted, false);
  equal(intent.finishPrime(prime), false); equal(player.pauses, 0); equal(player.playing, true);
  equal(intent.beginPrime(), null); equal(player.playing, true);
  intent.stop(); const first = intent.beginPrime()!; intent.stop(); const next = intent.beginPrime()!;
  const before = player.pauses;
  equal(intent.finishPrime(first), false); equal(player.pauses, before);
  equal(intent.finishPrime(next), true); equal(player.pauses, before + 1);
  equal(intent.finishPrime(next), false); equal(player.pauses, before + 1);
});

test('unexpected native pauses recover at most twice and never undo pause, navigation, end or another owner', () => {
  const handoff = createPlaybackHandoff(); const player = nativeTarget(); const other = nativeTarget();
  const intent = createPlaybackIntent(player, handoff); const replacement = createPlaybackIntent(other, handoff);
  intent.play(1); const ticket = intent.generation(); player.playing = false;
  equal(intent.recover(ticket), true); equal(player.playing, true);
  equal(intent.recover(ticket), true); equal(intent.recover(ticket), false); equal(player.plays, 3);
  intent.play(2); equal(intent.recover(ticket), false); const current = intent.generation();
  replacement.play(1); equal(intent.recover(current), false); equal(other.playing, true);
  replacement.stop(); intent.play(1); const paused = intent.generation(); intent.stop();
  equal(intent.recover(paused), false); equal(player.playing, false);
});

test('playback handoff silences the old player before unmuting its replacement', () => {
  const events: string[] = [];
  function target(name: string) {
    let muted = true;
    return { get muted() { return muted; }, set muted(value: boolean) { muted = value; events.push(`${name}:${value ? 'mute' : 'unmute'}`); }, pause() { events.push(`${name}:pause`); } };
  }
  const first = target('first'); const second = target('second'); const third = target('third');
  const handoff = createPlaybackHandoff();
  handoff.activate(first); events.length = 0; handoff.activate(first); deepEqual(events, []); handoff.activate(second);
  deepEqual(events, ['first:mute', 'first:pause', 'second:unmute']);
  // An outgoing cleanup (or silent neighbor priming) cannot revoke the new owner.
  handoff.deactivate(first); equal(second.muted, false);
  events.length = 0; handoff.activate(third);
  deepEqual(events, ['second:mute', 'second:pause', 'third:unmute']);
  handoff.deactivate(second); equal(third.muted, false);
  // Rapid reverse promotion and a stale cleanup preserve exactly one owner.
  handoff.activate(first); handoff.deactivate(third);
  equal(first.muted, false); equal(second.muted, true); equal(third.muted, true);
  handoff.deactivate(first); equal(first.muted, true);
});
