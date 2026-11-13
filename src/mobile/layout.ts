export function pageTranslation(offset: number, index: number, extent: number) {
  'worklet';
  return offset + index * extent;
}
export function neighborPages(index: number, count: number) { return [index - 1, index, index + 1].filter(value => value >= 0 && value < count); }
export function gridCellWidth(width: number, columns = 3, gap = 1) { return Math.max(0, (width - gap * (columns - 1)) / columns); }
export function feedChrome(height: number, safe: { top: number; bottom: number; left: number; right: number }, footer = 0) {
  const bottom = Math.max(safe.bottom, footer); const compact = height - safe.top - bottom < 650;
  const gap = compact ? 7 : 12;
  return { top: safe.top, bottom, captionBottom: bottom + 20, toolbarBottom: bottom + 20 + 44 + 17 + gap, gap, left: Math.max(12, safe.left), right: Math.max(7, safe.right) };
}
export type MediaSize = { width: number; height: number };
export const MAX_PORTRAIT_ZOOM = 1.12;
export function feedFooterHeight(safeBottom: number) { return 50 + Math.max(8, safeBottom); }
export function mediaAreaHeight(height: number, safeBottom: number, footer: number, clear: boolean) { return Math.max(0, height - (clear ? 0 : Math.max(safeBottom, footer))); }
export function videoFit(width: number, height: number, size?: MediaSize, allowZoom = true): 'contain' | 'cover' {
  if (!allowZoom || width <= 0 || height <= 0 || !size || !Number.isFinite(size.width) || !Number.isFinite(size.height) || size.width <= 0 || size.height <= size.width) return 'contain';
  const contained = Math.min(width / size.width, height / size.height);
  const filled = Math.max(width / size.width, height / size.height);
  return filled / contained <= MAX_PORTRAIT_ZOOM ? 'cover' : 'contain';
}
