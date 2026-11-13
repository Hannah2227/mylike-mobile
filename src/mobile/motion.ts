export function prefetchIds(ids: readonly string[], index: number) {
  if (!Number.isInteger(index) || index < 0 || index >= ids.length) return [];
  return [...new Set([ids[index + 1], ids[index + 2], ids[index - 1]].filter((id): id is string => Boolean(id) && id !== ids[index]))];
}
export function snapDuration(remaining: number, velocity: number, extent: number) {
  'worklet';
  if (![remaining, velocity, extent].every(Number.isFinite) || extent <= 0) return 240;
  const distance = Math.min(1, Math.abs(remaining) / extent);
  const natural = 180 + distance * 120;
  const flick = Math.abs(velocity) > 750 ? Math.abs(remaining / velocity) * 1000 : natural;
  return Math.round(Math.max(160, Math.min(300, natural, flick)));
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
