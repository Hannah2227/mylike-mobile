import { equal } from 'node:assert/strict';
import { test } from 'node:test';
import { boostDropTarget } from '../src/mobile/boost.ts';

test('speed locking requires a deliberate downward pull into the footer zone on different screens', () => {
  for (const height of [480, 568, 650, 768, 852, 932]) {
    equal(boostDropTarget(height / 2, height - 100, height, false), false);
    equal(boostDropTarget(height / 2, height - 40, height, false), true);
    equal(boostDropTarget(height - 20, height - 10, height, false), false);
    equal(boostDropTarget(height - 20, height + 30, height, false), true);
    equal(boostDropTarget(height / 2, height / 2 - 100, height, false), false);
  }
  equal(boostDropTarget(0, 100, 0, false), false); equal(boostDropTarget(NaN, 100, 768, true), false);
});

test('the lock target stays armed around its boundary and disarms when pulled back', () => {
  equal(boostDropTarget(400, 715, 768, false), true);
  equal(boostDropTarget(400, 700, 768, true), true);
  equal(boostDropTarget(400, 700, 768, false), false);
  equal(boostDropTarget(400, 680, 768, true), false);
  equal(boostDropTarget(700, 729, 768, true), false);
});
