export type PinchOrigin = { scale: number; x: number; y: number; focalX: number; focalY: number };
export function pinchTransform(relativeScale: number, focalX: number, focalY: number, origin: PinchOrigin, width: number, height: number) {
  'worklet';
  if (![relativeScale, focalX, focalY, origin.scale, origin.x, origin.y, origin.focalX, origin.focalY, width, height].every(Number.isFinite) || width <= 0 || height <= 0 || origin.scale <= 0) return { scale: 1, x: 0, y: 0 };
  const scale = Math.max(0.7, Math.min(3, origin.scale * relativeScale)); const factor = scale / origin.scale;
  const x = focalX - origin.focalX + (1 - factor) * (origin.focalX - width / 2) + factor * origin.x;
  const y = focalY - origin.focalY + (1 - factor) * (origin.focalY - height / 2) + factor * origin.y;
  const limitX = Math.abs(scale - 1) * width / 2; const limitY = Math.abs(scale - 1) * height / 2;
  return { scale, x: Math.max(-limitX, Math.min(limitX, x)), y: Math.max(-limitY, Math.min(limitY, y)) };
}
