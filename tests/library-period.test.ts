import { deepEqual, equal } from 'node:assert/strict';
import { test } from 'node:test';
import { publicationBounds, publicationLabel } from '../src/library-period.ts';

test('uses Beijing month boundaries, including leap days and year rollover', () => {
  deepEqual(publicationBounds({ year: 2024, month: 2 }), [
    Date.parse('2024-01-31T16:00:00.000Z'), Date.parse('2024-02-29T16:00:00.000Z'),
  ]);
  deepEqual(publicationBounds({ year: 2025, month: 12 }), [
    Date.parse('2025-11-30T16:00:00.000Z'), Date.parse('2025-12-31T16:00:00.000Z'),
  ]);
  deepEqual(publicationBounds({ year: 2026 }), [
    Date.parse('2025-12-31T16:00:00.000Z'), Date.parse('2026-12-31T16:00:00.000Z'),
  ]);
  equal(publicationLabel({ year: 2026, month: 3 }), '2026.03');
});
