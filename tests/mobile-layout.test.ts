import { deepEqual, equal, ok } from 'node:assert/strict';
import { test } from 'node:test';
import { feedChrome, feedFooterHeight, gridCellWidth, mediaAreaHeight, neighborPages, pageTranslation, videoFit } from '../src/mobile/layout.ts';

test('gallery commits and screen resizing keep the selected page at zero without exposing page zero', () => {
  for (const width of [320, 375, 393, 412, 430]) {
    const before = neighborPages(1, 5); const after = neighborPages(2, 5);
    equal(before.includes(2), true); equal(after.includes(2), true);
    equal(pageTranslation(-2 * width, 2, width), 0);
    equal(pageTranslation(-2 * width, 0, width), -2 * width);
    equal(after.includes(0), false); equal(after.length, 3);
    equal(pageTranslation(-2 * width, 3, width), width);
  }
  deepEqual(neighborPages(0, 1), [0]);
});
test('the three-column grid fills the measured width including exactly two internal gaps', () => {
  for (const width of [320, 360, 375, 393, 412, 430, 768]) ok(Math.abs(gridCellWidth(width) * 3 + 2 - width) < 0.00001);
});
test('full-screen media controls avoid both notches and the overlaid footer across phone sizes', () => {
  const small = feedChrome(568, { top: 20, bottom: 0, left: 0, right: 0 }, 63);
  const large = feedChrome(932, { top: 59, bottom: 34, left: 0, right: 0 }, 89);
  equal(small.top, 20); equal(small.bottom, 63); ok(small.gap < large.gap);
  equal(large.top, 59); equal(large.bottom, 89); equal(large.toolbarBottom, 182); equal(large.captionBottom, 109);
  equal(feedChrome(852, { top: 59, bottom: 34, left: 0, right: 0 }).bottom, 34);
});
test('iPhone 14 Pro uses the top-to-footer media center and no gap between vertical pages', () => {
  const footer = feedFooterHeight(34); equal(footer, 84);
  const area = mediaAreaHeight(852, 34, footer, false); equal(area, 768);
  equal(area / 2, 384); equal(852 / 2 - area / 2, 42);
  equal(pageTranslation(-area / 2, 0, area) + area, pageTranslation(-area / 2, 1, area));
  const chrome = feedChrome(area, { top: 59, bottom: 0, left: 0, right: 0 }); equal(chrome.captionBottom, 20); equal(chrome.toolbarBottom, 93);
});
test('a 9:16 portrait fills the iPhone media area with modest proportional cropping', () => {
  equal(videoFit(393, 768, { width: 1080, height: 1920 }), 'cover');
  const zoom = (768 / 1920) / (393 / 1080); ok(zoom > 1.09 && zoom < 1.10);
  equal(videoFit(320, 510, { width: 1080, height: 1920 }), 'cover');
});
test('landscape, square, excessive crop, unknown size and comment transitions use contain', () => {
  for (const size of [{ width: 1920, height: 1080 }, { width: 1080, height: 1080 }, { width: 1080, height: 1440 }, { width: 0, height: 0 }, { width: NaN, height: 1920 }]) equal(videoFit(393, 768, size), 'contain');
  equal(videoFit(393, 768), 'contain'); equal(videoFit(393, 768, { width: 1080, height: 1920 }, false), 'contain');
  equal(mediaAreaHeight(852, 34, 84, true), 852); equal(mediaAreaHeight(0, 34, 84, false), 0);
});
