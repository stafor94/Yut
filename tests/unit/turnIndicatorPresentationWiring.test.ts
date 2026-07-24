import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('turn indicator preserves the fall actor neighbor snapshot through the completion handoff', () => {
  const source = readFileSync('src/app/containers/GameBoardOverlays.tsx', 'utf8');

  assert.match(source, /preservedFallTurnKeyRef/);
  assert.match(source, /keepNeighborsVisible && frozenSnapshotKey/);
  assert.match(source, /preserveFallNeighborsForDisplayedTurn/);
  assert.match(source, /shouldRenderTurnIndicatorNeighbors/);
});
