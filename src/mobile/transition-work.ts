type Task = { run: () => Promise<void>; key?: string };
// Small persistence tasks can wait for the pager to settle. Store methods keep
// their original account binding; a newer checkpoint replaces an older queued
// checkpoint at the tail, without moving it before intervening history visits.
export function createTransitionWork(onError: () => void) {
  let held = false; let running = false; let inFlight = 0; const tasks: Task[] = [];
  const waiters: (() => void)[] = [];
  function completed() { inFlight--; if (!inFlight && !tasks.length) for (const done of waiters.splice(0)) done(); }
  function drain() {
    if (held || running) return;
    running = true;
    // Submit in order to the store's existing serialized write queue. Submit the
    // whole batch synchronously so its following reads can await all writes.
    try { while (!held && tasks.length) { inFlight++; try { void tasks.shift()!.run().catch(onError).finally(completed); } catch { onError(); completed(); } } }
    finally { running = false; }
  }
  return {
    enqueue(run: Task['run'], key?: string) {
      if (key) { const previous = tasks.findIndex(task => task.key === key); if (previous >= 0) tasks.splice(previous, 1); }
      tasks.push({ run, key }); drain();
    },
    hold(value: boolean) { held = value; if (!held) drain(); },
    flush() { held = false; const done = new Promise<void>(resolve => { if (!inFlight && !tasks.length) resolve(); else waiters.push(resolve); }); drain(); return done; },
  };
}
