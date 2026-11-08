import { equal } from 'node:assert/strict';
import { test } from 'node:test';
import { surfaceSwipe, workOffset, workSwipeStep } from '../src/swipe.ts';

test('routes vertical swipes, photo paging, back navigation and seek gestures separately', () => {
  equal(surfaceSwipe(3, -60, 14, 390, true), 'work');
  equal(surfaceSwipe(-60, 5, 380, 390, true), 'library');
  equal(surfaceSwipe(-60, 5, 120, 390, true), 'photo');
  equal(surfaceSwipe(60, 5, 380, 390, true), 'photo');
  equal(surfaceSwipe(-60, 5, 120, 390, false), 'library');
  equal(surfaceSwipe(60, 5, 120, 390, false), null);
  equal(surfaceSwipe(-60, 5, null, 390, false), null);
  equal(surfaceSwipe(2, 8, 14, 390, false), null);
});

test('keeps the snapped work at the same native offset after selection commits', () => {
  const height = 740;
  const snapped = workOffset(2, height);
  const slot = -workOffset(2, height);
  equal(snapped + slot, 0);
  equal(workOffset(2, height), snapped);
  equal(workOffset(0, height), 0);
});

test('snaps only after a meaningful drag or a flick in the same direction', () => {
  equal(workSwipeStep(-140, -0.1, 740), 1);
  equal(workSwipeStep(140, 0.1, 740), -1);
  equal(workSwipeStep(40, 0.8, 740), -1);
  equal(workSwipeStep(-40, 0.8, 740), 0);
  equal(workSwipeStep(40, 0.1, 740), 0);
});
