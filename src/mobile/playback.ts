type PlaybackTarget = { muted: boolean; pause: () => void };
type PreparedPlayback = { start: (at?: number) => boolean; arrive: (at?: number) => void; cancel: () => void };
// Each feed owns one audio lease. A late cleanup from the outgoing slot may
// stop that slot, but must never silence the newly promoted player.
export function createPlaybackHandoff() {
  let owner: PlaybackTarget | null = null;
  const prepared = new Map<string, PreparedPlayback>();
  let pending: { id: string; control: PreparedPlayback } | null = null;
  function cancelPending() { const previous = pending; pending = null; previous?.control.cancel(); }
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
    register(id: string, control: PreparedPlayback) {
      const previous = prepared.get(id); if (previous && pending?.control === previous) cancelPending();
      prepared.set(id, control);
      return () => { if (pending?.control === control) cancelPending(); if (prepared.get(id) === control) prepared.delete(id); };
    },
    prepare(id: string | null, at?: number) {
      if (id !== null && pending?.id === id) return;
      cancelPending(); if (id === null) return;
      const control = prepared.get(id); if (control?.start(at)) pending = { id, control };
    },
    arrive(id: string, at?: number) {
      if (pending && pending.id !== id) cancelPending();
      const control = prepared.get(id); pending = null; control?.arrive(at);
    },
    cancelPending,
  };
}
export type PlaybackHandoff = ReturnType<typeof createPlaybackHandoff>;

type PlayableTarget = PlaybackTarget & { play: () => void; playbackRate: number; playing?: boolean };
export function createPlaybackIntent(target: PlayableTarget, handoff: PlaybackHandoff) {
  let generation = 0; let wanted = false; let prime: number | null = null; let recoveries = 0;
  let lead: { ticket: number; arrived: boolean } | null = null;
  function play(rate: number) {
    generation++; wanted = true; prime = null; lead = null; recoveries = 0;
    handoff.activate(target); target.playbackRate = rate; target.play();
  }
  function stop() { generation++; wanted = false; prime = null; lead = null; handoff.deactivate(target); }
  function continueLead(rate: number) {
    if (target.playbackRate !== rate) target.playbackRate = rate;
    if (target.playing === false) target.play();
  }
  return {
    // Always issue play for a new playback intent, even with a stale native
    // playing snapshot. Warm metadata/status updates must leave priming alone.
    play,
    stop,
    sync(wantsPlayback: boolean, rate: number, keepWarm: boolean): 'play' | 'stop' | 'warm' {
      if (wantsPlayback) {
        if (lead?.arrived && lead.ticket === generation && handoff.owns(target)) {
          lead = null; wanted = true; continueLead(rate); return 'play';
        }
        play(rate); return 'play';
      }
      // Audio can transfer immediately on arrival, before React installs the
      // current role. A warm metadata render must not stop that transfer.
      if (keepWarm && lead?.arrived && lead.ticket === generation && handoff.owns(target)) return 'warm';
      if (keepWarm && !wanted && !handoff.owns(target)) return 'warm';
      stop(); return 'stop';
    },
    beginPrime() {
      if (wanted || lead || handoff.owns(target)) return null;
      const ticket = ++generation; prime = ticket; target.muted = true; target.playbackRate = 1; target.play(); return ticket;
    },
    holdPrime(ticket: number) {
      if (ticket !== generation || prime !== ticket || wanted || handoff.owns(target)) return false;
      target.pause(); return true;
    },
    finishPrime(ticket: number) {
      if (ticket !== generation || prime !== ticket || wanted || handoff.owns(target)) return false;
      prime = null; target.pause(); return true;
    },
    prestart(rate: number) {
      if (wanted || handoff.owns(target)) return null;
      const ticket = ++generation; prime = null; lead = { ticket, arrived: false }; recoveries = 0;
      target.muted = true; target.playbackRate = rate; target.play(); return ticket;
    },
    arrive(ticket: number, rate: number) {
      if (!lead || lead.ticket !== ticket || ticket !== generation) return false;
      lead.arrived = true; wanted = true; handoff.activate(target); continueLead(rate); return true;
    },
    cancelPrestart(ticket: number) {
      if (!lead || lead.ticket !== ticket || ticket !== generation || lead.arrived || handoff.owns(target)) return false;
      stop(); return true;
    },
    generation() { return generation; },
    recover(ticket: number) {
      if (ticket !== generation || !wanted || !handoff.owns(target) || recoveries >= 2) return false;
      recoveries++; target.play(); return true;
    },
  };
}

export function createFramePrewarm(intent: ReturnType<typeof createPlaybackIntent>, target: { currentTime: number }) {
  let ticket: number | null = null; let attempts = 0; let held = false;
  function rewind() { if (Number.isFinite(target.currentTime) && target.currentTime > 0.12) target.currentTime = 0; }
  return {
    ticket() { return ticket; },
    begin() {
      if (ticket !== null || attempts >= 2) return null;
      ticket = intent.beginPrime(); held = false; if (ticket !== null) attempts++; return ticket;
    },
    hold() {
      if (ticket === null || held || !intent.holdPrime(ticket)) return false;
      held = true; rewind(); return true;
    },
    finish(expected: number | null) {
      if (expected === null || ticket !== expected) return false;
      ticket = null;
      if (!intent.finishPrime(expected)) return false;
      // A delayed JS callback can allow a muted player to advance. Rewind it
      // while still offscreen so promotion never needs to flush that decoder.
      rewind();
      return true;
    },
    cancel() { ticket = null; },
  };
}

// Preserve a primed first frame instead of flushing it with an unnecessary seek.
export function resumeSeekTarget(saved: number, current: number, duration: number): number | null {
  const wanted = Number.isFinite(saved) ? Math.max(0, saved) : 0;
  const target = Number.isFinite(duration) && duration > 0 ? Math.min(wanted, Math.max(0, duration - 0.05)) : wanted;
  if (Number.isFinite(duration) && duration > 0 && current >= duration - 0.005) return target;
  return Number.isFinite(current) && Math.abs(current - target) <= 0.12 ? null : target;
}
