export function windowPages(index: number, count: number) {
  return [index - 1, index, index + 1].filter(value => value >= 0 && value < count);
}
export function windowStep(distance: number, velocity: number, height: number, cancelled = false): -1 | 0 | 1 {
  'worklet';
  if (cancelled || height <= 0 || !Number.isFinite(distance) || !Number.isFinite(velocity)) return 0;
  if (Math.abs(velocity) >= 600 && distance * velocity < 0) return 0;
  if (Math.abs(distance) < height * 0.2 && !(Math.abs(distance) >= 18 && Math.abs(velocity) >= 600)) return 0;
  return distance < 0 ? 1 : -1;
}
export function windowDrag(index: number, translation: number, height: number, count: number) {
  'worklet';
  const delta = Math.max(-height, Math.min(height, -translation));
  const edge = index === 0 && delta < 0 || index === count - 1 && delta > 0;
  return index * height + (edge ? Math.sign(delta) * Math.min(64, Math.abs(delta) * 0.18) : delta);
}
export function windowDuration(remaining: number, height: number) {
  'worklet';
  if (Math.abs(remaining) < 0.5) return 0;
  return Math.max(16, Math.min(64, Math.abs(remaining) / Math.max(1, height) * 64));
}
