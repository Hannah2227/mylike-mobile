// React can acknowledge several commands in one render, or render an older
// selection while another command is pending. Only external selection changes
// replace the command cursor; acknowledgements must not rewind it.
export function createPageSync(initial: number) {
  let committed = initial; const pending: number[] = [];
  return {
    request(index: number) { if (pending.at(-1) !== index) pending.push(index); },
    reconcile(index: number) {
      const acknowledged = pending.lastIndexOf(index);
      const external = committed !== index && acknowledged < 0;
      if (acknowledged >= 0) pending.splice(0, acknowledged + 1);
      if (external) pending.length = 0;
      committed = index; return external;
    },
    reset(index: number) { committed = index; pending.length = 0; },
  };
}
