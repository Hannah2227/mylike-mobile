// A deliberate downward drag into the footer zone, with hysteresis so the
// release action does not flicker when the finger rests on the zone boundary.
export function boostDropTarget(start: number, y: number, height: number, armed: boolean) {
  'worklet';
  if (![start, y, height].every(Number.isFinite) || height <= 0) return false;
  return y - start >= (armed ? 32 : 48) && y >= height - (armed ? 80 : 56);
}
