import { deepEqual, equal, ok } from 'node:assert/strict';
import { test } from 'node:test';
import { pinchTransform } from '../src/mobile/pinch.ts';
const origin = { scale: 1, x: 0, y: 0, focalX: 120, focalY: 200 };
test('pinching keeps the touched content under the fingers rather than the screen center', () => {
  const value = pinchTransform(2, 120, 200, origin, 400, 800);
  deepEqual(value, { scale: 2, x: 80, y: 200 });
  equal(200 + value.x + value.scale * (120 - 200), 120);
  equal(400 + value.y + value.scale * (200 - 400), 200);
});
test('two-finger movement follows the focal point and remains inside the scaled image bounds', () => {
  const moved = pinchTransform(2, 140, 170, origin, 400, 800); deepEqual(moved, { scale: 2, x: 100, y: 170 });
  const edge = pinchTransform(10, 10000, -10000, origin, 400, 800); equal(edge.scale, 3); equal(edge.x, 400); equal(edge.y, -800);
  const shrink = pinchTransform(0.01, 120, 200, origin, 400, 800); equal(shrink.scale, 0.7); ok(Math.abs(shrink.x) <= 60.0001); ok(Math.abs(shrink.y) <= 120.0001);
});
test('restarting a pinch during restoration preserves the already transformed focal point', () => {
  const start = { scale: 1.4, x: 30, y: 20, focalX: 150, focalY: 250 };
  const value = pinchTransform(1.2, 150, 250, start, 400, 800);
  const px = (start.focalX - 200 - start.x) / start.scale; const py = (start.focalY - 400 - start.y) / start.scale;
  ok(Math.abs(200 + value.x + value.scale * px - start.focalX) < 0.00001);
  ok(Math.abs(400 + value.y + value.scale * py - start.focalY) < 0.00001);
  deepEqual(pinchTransform(NaN, 1, 1, origin, 400, 800), { scale: 1, x: 0, y: 0 });
});
