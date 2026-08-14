import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('moving token observes native positional transition lifecycle with the stable frame identity queue', () => {
  const source = readFileSync('src/features/game/components/GameBoard.tsx', 'utf8');

  assert.match(source, /element\.addEventListener\('transitionrun', handleNativeTransitionRun\)/);
  assert.match(source, /element\.addEventListener\('transitioncancel', handleNativeTransitionCancel\)/);
  assert.match(source, /element\.addEventListener\('transitionend', handleNativeTransitionEnd\)/);
  assert.match(source, /movingTransitionIdentityQueueRef\.current\.remember\(identity\)/);
  assert.match(source, /movingTransitionIdentityQueueRef\.current\.consume\(movingPieceId, event\.propertyName\)/);
  assert.match(source, /onMovingPieceTransitionPrepared\(movingPieceId, movingPieceFrameKey, durationMs\)/);
  assert.match(source, /onMovingPieceTransitionComplete\?\.\(movingPieceId, movingPieceFrameKey\)/);
  assert.match(source, /element\.removeEventListener\('transitionend', handleNativeTransitionEnd\)/);
});
