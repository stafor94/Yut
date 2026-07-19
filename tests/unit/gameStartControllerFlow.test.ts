import assert from 'node:assert/strict';
import test from 'node:test';
import { createInitialGameSyncedStateShape, INITIAL_GAME_SYNCED_STATE_KEYS, listInitialGameSyncedStateKeys } from '../../src/app/flows/gameStartControllerFlow';

test('gameStartControllerFlow preserves every initial synced state key used by game start initialization', () => {
    const state = createInitialGameSyncedStateShape({
      pieces: [],
      turnOrderIds: ['p2', 'p1'],
      boardItems: [],
      logs: [{ id: 1, text: '순서 로그' }],
      gameStartedAt: 1000,
      turnOrderIntro: { visible: true, order: [], slotUntil: [], readyAt: 1000 },
      turnOrderPhase: { active: false, index: 0, rolls: [], deadline: 0, readyAt: 0 },
      turnDeadlineAt: 31000,
      gameSeats: [],
      startRequestVersion: 7,
      startRequestId: 'request-7',
    });

  assert.deepEqual(listInitialGameSyncedStateKeys(state), [...INITIAL_GAME_SYNCED_STATE_KEYS]);
  assert.deepEqual(Object.keys(state), [...INITIAL_GAME_SYNCED_STATE_KEYS]);
  assert.deepEqual(state.turnOrderIds, ['p2', 'p1']);
  assert.deepEqual(state.initialTurnOrderIds, ['p2', 'p1']);
  assert.equal(state.turnDeadlineKind, 'roll');
  assert.equal(state.startRequestVersion, 7);
  assert.equal(state.startRequestId, 'request-7');
});
