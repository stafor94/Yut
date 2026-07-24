import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldRenderTurnIndicatorNeighbors } from '../../src/app/flows/turnIndicatorPresentation.js';

test('turn neighbors remain visible during the fall completion handoff gap', () => {
  assert.equal(shouldRenderTurnIndicatorNeighbors({
    showNeighbors: false,
    fallPresentationActive: false,
    preserveFallNeighborsForDisplayedTurn: true,
  }), true);
});

test('turn neighbors stay hidden for an unrelated snapshot without active fall presentation', () => {
  assert.equal(shouldRenderTurnIndicatorNeighbors({
    showNeighbors: false,
    fallPresentationActive: false,
    preserveFallNeighborsForDisplayedTurn: false,
  }), false);
});

test('normal and active-fall visibility paths continue to render neighbors', () => {
  assert.equal(shouldRenderTurnIndicatorNeighbors({
    showNeighbors: true,
    fallPresentationActive: false,
    preserveFallNeighborsForDisplayedTurn: false,
  }), true);
  assert.equal(shouldRenderTurnIndicatorNeighbors({
    showNeighbors: false,
    fallPresentationActive: true,
    preserveFallNeighborsForDisplayedTurn: false,
  }), true);
});
