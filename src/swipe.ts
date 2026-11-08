export type SurfaceSwipe = 'work' | 'photo' | 'library';

export function surfaceSwipe(dx: number, dy: number, startX: number | null, width: number, gallery: boolean): SurfaceSwipe | null {
  if (Math.max(Math.abs(dx), Math.abs(dy)) <= 12) return null;
  if (Math.abs(dy) >= Math.abs(dx)) return 'work';
  if (dx < 0 && startX !== null && (!gallery || (width > 0 && startX >= width - 32))) return 'library';
  return gallery ? 'photo' : null;
}

export function workOffset(index: number, height: number): number {
  return index === 0 || height === 0 ? 0 : -index * height;
}

export function workSwipeStep(offset: number, velocity: number, height: number): -1 | 0 | 1 {
  const distance = Math.abs(offset);
  const flick = distance > 24 && Math.abs(velocity) > 0.58 && Math.sign(velocity) === Math.sign(offset);
  if (distance < Math.max(56, height * 0.17) && !flick) return 0;
  return offset < 0 ? 1 : -1;
}
