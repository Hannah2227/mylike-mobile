type PlaybackTarget = { muted: boolean; pause: () => void };
// Each feed owns one audio lease. A late cleanup from the outgoing slot may
// stop that slot, but must never silence the newly promoted player.
export function createPlaybackHandoff() {
  let owner: PlaybackTarget | null = null;
  return {
    activate(target: PlaybackTarget) {
      if (owner === target) return;
      if (owner && owner !== target) { owner.muted = true; owner.pause(); }
      owner = target; target.muted = false;
    },
    deactivate(target: PlaybackTarget) {
      target.muted = true; target.pause(); if (owner === target) owner = null;
    },
    owns(target: PlaybackTarget) { return owner === target; },
  };
}
export type PlaybackHandoff = ReturnType<typeof createPlaybackHandoff>;

type PlayableTarget = PlaybackTarget & { play: () => void; playbackRate: number };
export function createPlaybackIntent(target: PlayableTarget, handoff: PlaybackHandoff) {
  let generation = 0; let wanted = false; let prime: number | null = null; let recoveries = 0;
  return {
    play(rate: number) {
      generation++; wanted = true; prime = null; recoveries = 0;
      handoff.activate(target); target.playbackRate = rate;
      // `playing` is an observed native snapshot, not an acknowledgement of our
      // latest command. Always issue play when establishing a new intent.
      target.play();
    },
    stop() { generation++; wanted = false; prime = null; handoff.deactivate(target); },
    beginPrime() {
      if (wanted || handoff.owns(target)) return null;
      const ticket = ++generation; prime = ticket; target.muted = true; target.playbackRate = 1; target.play(); return ticket;
    },
    finishPrime(ticket: number) {
      if (ticket !== generation || prime !== ticket || wanted || handoff.owns(target)) return false;
      prime = null; target.pause(); return true;
    },
    generation() { return generation; },
    recover(ticket: number) {
      if (ticket !== generation || !wanted || !handoff.owns(target) || recoveries >= 2) return false;
      recoveries++; target.play(); return true;
    },
  };
}

// Preserve a primed first frame instead of flushing it with an unnecessary seek.
export function resumeSeekTarget(saved: number, current: number, duration: number): number | null {
  const wanted = Number.isFinite(saved) ? Math.max(0, saved) : 0;
  const target = Number.isFinite(duration) && duration > 0 ? Math.min(wanted, Math.max(0, duration - 0.05)) : wanted;
  if (Number.isFinite(duration) && duration > 0 && current >= duration - 0.005) return target;
  return Number.isFinite(current) && Math.abs(current - target) <= 0.12 ? null : target;
}
