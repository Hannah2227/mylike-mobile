export function prefetchIds(ids: readonly string[], index: number) {
  if (!Number.isInteger(index) || index < 0 || index >= ids.length) return [];
  return [...new Set([ids[index + 1], ids[index + 2], ids[index - 1]].filter((id): id is string => Boolean(id) && id !== ids[index]))];
}
export function snapSpring(remaining: number, velocity: number, extent: number) {
  'worklet';
  const distance = Number.isFinite(remaining) ? Math.abs(remaining) : 0;
  const size = Number.isFinite(extent) && extent > 0 ? extent : 800;
  const seconds = 0.07 + 0.18 * Math.sqrt(Math.min(1, distance / size));
  const omega = 9 / seconds;
  const toward = Math.sign(remaining);
  const speed = Number.isFinite(velocity) && distance > 0.5 ? Math.max(0, toward * velocity) : 0;
  // Critically damped, with the actual release velocity in the target direction.
  // Short remaining distances get a quicker finish instead of a 160ms floor.
  return { mass: 1, stiffness: omega * omega, damping: 2 * omega,
    velocity: toward * Math.min(size * 12, speed) || 0, overshootClamping: true, energyThreshold: 1e-6 };
}
export function libraryOffset(previous: number, previousCollapse: number, collapsed: number) {
  'worklet';
  return Math.max(0, previous - previousCollapse) + Math.max(0, collapsed);
}
export function headerCollapse(current: number, previousOffset: number, offset: number, height: number) {
  'worklet';
  const delta = offset - previousOffset;
  return Math.max(0, Math.min(height, delta > 0 ? current + delta : Math.min(current, offset)));
}
