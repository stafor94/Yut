import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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

test('TurnIndicator는 activeSeat 수신 시각 기준 별도 handoff hold를 다시 시작하지 않는다', () => {
  const source = readFileSync(
    new URL('../../src/app/containers/GameBoardOverlays.tsx', import.meta.url),
    'utf8',
  );
  const start = source.indexOf('export function TurnIndicator');
  const end = source.indexOf('type BoardMessageStackProps');
  assert.ok(start >= 0);
  assert.ok(end > start);
  const turnIndicatorSource = source.slice(start, end);
  assert.doesNotMatch(
    turnIndicatorSource,
    /TURN_END_HOLD_MS|transitionTimerRef|pendingSnapshotRef|setTimeout/,
  );
});
