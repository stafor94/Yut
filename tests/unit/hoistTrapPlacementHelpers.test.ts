import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { readStorageText } from '../../src/shared/storage/readStorageText';

test('reads browser storage text and uses the fallback for unavailable storage', () => {
  assert.equal(readStorageText(() => ({ getItem: () => 'room-a' }), 'activeRoomId'), 'room-a');
  assert.equal(readStorageText(() => ({ getItem: () => null }), 'activeRoomId'), '');
  assert.equal(readStorageText(() => { throw new Error('storage unavailable'); }, 'activeRoomId'), '');
  assert.equal(readStorageText(() => ({ getItem: () => { throw new Error('read blocked'); } }), 'activeRoomId', 'fallback'), 'fallback');
});

test('keeps trap helpers and storage safety in normal TypeScript product source', () => {
  const appSource = readFileSync('src/app/App.tsx', 'utf8');
  const viteSource = readFileSync('vite.config.ts', 'utf8');

  assert.ok(appSource.includes('function isTrapNodeOccupied(nodeId: string)'));
  assert.ok(appSource.includes('function getTrapCandidateNodeIds(nodeId: string)'));
  assert.equal(appSource.includes('const isTrapNodeOccupied ='), false);
  assert.ok(appSource.includes('readStorageText(() => window.localStorage, STORAGE_KEYS.activeRoomId)'));
  assert.equal(viteSource.includes('transform(source, id)'), false);
  assert.equal(viteSource.includes('hoistTrapPlacementHelpers'), false);
  assert.equal(viteSource.includes('replaceUnsafeAppStorageReads'), false);
  assert.equal(viteSource.includes('map: null'), false);
});

test('keeps the offline timeout counter aligned with the authoritative timeout policy after controller extraction', () => {
  const appSource = readFileSync('src/app/App.tsx', 'utf8');
  const itemControllerSource = readFileSync('src/app/controllers/useItemController.ts', 'utf8');

  assert.ok(appSource.includes('getTurnActionTimeoutMsForCount(turnActionTimeoutPenaltyBySeatId[seatId], TURN_ACTION_TIMEOUT_MS)'));
  assert.ok(appSource.includes('getTurnActionTimeoutMsForCount(turnActionTimeoutPenaltyBySeatId[seatId], ITEM_PROMPT_TIMEOUT_MS)'));
  assert.ok(appSource.includes('const nextCount = incrementTurnActionTimeoutCount(current[seatId]);'));
  assert.ok(appSource.includes('if (nextCount >= 2) setAutoPlayBySeatId'));
  assert.ok(appSource.includes('if (!seatId || activeRoomId) return;'));

  const onlinePromptStart = appSource.indexOf('if (activeRoomId) {', appSource.indexOf('if (!itemPromptTiming) return undefined;'));
  const offlinePromptTimeout = appSource.indexOf('const timeoutMs = getItemPromptTimeoutMs(localSeatId);');
  assert.ok(onlinePromptStart >= 0 && offlinePromptTimeout > onlinePromptStart);
  assert.equal(appSource.slice(onlinePromptStart, offlinePromptTimeout).includes('markTurnActionTimedOut'), false);

  const onlineSkipBranch = itemControllerSource.indexOf('if (params.activeRoomId) {');
  const offlinePenaltyClear = itemControllerSource.indexOf('params.clearTurnActionTimeoutPenalty(params.localSeatId);');
  assert.ok(onlineSkipBranch >= 0 && offlinePenaltyClear > onlineSkipBranch);
  assert.ok(appSource.includes('onSkipItemPrompt={skipItemPrompt}'));
});
