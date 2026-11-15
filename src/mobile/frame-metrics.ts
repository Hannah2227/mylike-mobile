export function createFrameProbe(now: () => number, report: (value: { prepared: boolean; afterSelectionMs: number }) => void) {
  let selected: number | null = null; let decoded: number | null = null; let reported = false;
  function emit() {
    if (selected === null || decoded === null || reported) return;
    reported = true; report({ prepared: decoded <= selected, afterSelectionMs: Math.max(0, Math.round(decoded - selected)) });
  }
  return {
    select() { if (selected !== null) return; selected = now(); emit(); },
    frame() { decoded ??= now(); emit(); },
    leave() { selected = null; reported = false; },
  };
}

export type PlaybackStartMetric = {
  prepared: boolean; prestarted: boolean; requestToCommandMs: number | null; commandToAdvanceMs: number | null;
  selectionToAdvanceMs: number | null; advancedBeforeSelection: boolean; timedOut: boolean;
};
// This observes native media-clock progress, not just a decoded still frame.
// Sampling/event delivery still make it an approximation of screen latency.
export function createPlaybackStartProbe(now: () => number, report: (value: PlaybackStartMetric) => void) {
  let sample: { prepared: boolean; prestarted: boolean; baseline: number; requested: number; selected: number | null; command: number | null; advanced: number | null; reported: boolean } | null = null;
  function emit(timedOut = false) {
    if (!sample || sample.reported || sample.selected === null || sample.advanced === null && !timedOut) return;
    sample.reported = true;
    report({ prepared: sample.prepared, prestarted: sample.prestarted,
      requestToCommandMs: sample.command === null ? null : Math.max(0, Math.round(sample.command - sample.requested)),
      commandToAdvanceMs: sample.advanced === null || sample.command === null ? null : Math.max(0, Math.round(sample.advanced - sample.command)),
      selectionToAdvanceMs: sample.advanced === null ? null : Math.max(0, Math.round(sample.advanced - sample.selected)),
      advancedBeforeSelection: sample.advanced !== null && sample.advanced <= sample.selected, timedOut });
  }
  return {
    prestart(prepared: boolean, baseline: number, at = now()) { sample = { prepared, prestarted: true, baseline, requested: at, selected: null, command: null, advanced: null, reported: false }; },
    select(prepared: boolean, baseline: number, at = now()) {
      sample ??= { prepared, prestarted: false, baseline, requested: at, selected: null, command: null, advanced: null, reported: false };
      sample.selected ??= at; emit();
    },
    command() { if (sample) sample.command ??= now(); },
    advance(seconds: number) {
      if (!sample || sample.command === null || sample.advanced !== null || !Number.isFinite(seconds) || seconds <= sample.baseline + 0.005) return;
      sample.advanced = now(); emit();
    },
    pending() { return sample !== null && !sample.reported && sample.advanced === null; },
    expire() { emit(true); sample = null; },
    cancel() { sample = null; },
  };
}
