import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canRoll,
  getRollActionBlockReasons,
  reduceMoveCommand,
  reduceRollCommand,
  type EngineState,
} from '../../src/game-core/gameEngineCore';
import { resolveEffectiveMoveContext } from '../../src/app/flows/effectiveMoveContext';
import { shouldDeferSequenceRecovery } from '../../src/app/hooks/sequenceRecoveryWatchdog';

const doResult = { name: '도', steps: 1, bonus: false } as const;
const makeLog = (logs: { id: number; text: string }[], text: string) => ({ id: logs.length + 1, text });

function makeState(overrides: Partial<EngineState> = {}): EngineState {
  return {
    pieces: [
      { id: 'p1', ownerId: 'seat-1', label: '말1', nodeIndex: 0, nodeId: 'n01', started: false, finished: false },
      { id: 'p2', ownerId: 'seat-2', label: '말2', nodeIndex: 4, nodeId: 'n05', started: true, finished: false },
    ],
    turnIndex: 0,
    turnOrderIds: ['seat-1', 'seat-2'],
    roll: null,
    logs: [],
    winner: '',
    trapNodes: [],
    shieldedPieceIds: [],
    boardItems: [],
    ownedItems: {},
    ...overrides,
  };
}

test('blocks rolling while authoritative save or item prompt is pending', () => {
  const guard = {
    activeSeatId: 'seat-1',
    actorId: 'seat-1',
    pendingGameStateSave: true,
    pendingItemPrompt: true,
    roll: null,
    rollLocked: false,
    remoteActionClient: false,
    rollInProgress: false,
  };

  assert.equal(canRoll(guard), false);
  assert.deepEqual(getRollActionBlockReasons(guard), ['pending-item-prompt', 'saving-game-state']);
});

test('roll then ordinary move clears the roll and advances to the next seat', () => {
  const rolled = reduceRollCommand({
    state: makeState(),
    actorId: 'seat-1',
    nextRoll: doResult,
    actorLogName: '플레이어1',
    rollResultReadyAt: 1000,
    makeLog,
  });
  assert.equal(rolled.ok, true);
  if (!rolled.ok) return;

  const moved = reduceMoveCommand({
    state: { ...makeState(), ...rolled.patch } as EngineState,
    actorId: 'seat-1',
    pieceId: 'p1',
    branchChoice: 'outer',
    actorLogName: '플레이어1',
    playMode: 'individual',
    sides: [{ id: 'seat-1' }, { id: 'seat-2' }],
    makeLog,
  });

  assert.equal(moved.ok, true);
  if (!moved.ok) return;
  assert.equal(moved.patch.roll, null);
  assert.equal(moved.patch.turnIndex, 1);
  assert.deepEqual(moved.patch.lastMovedPieceIds, ['p1']);
});

test('capturing an opponent resets the captured piece and preserves the current turn', () => {
  const state = makeState({
    roll: doResult,
    pieces: [
      { id: 'p1', ownerId: 'seat-1', label: '말1', nodeIndex: 0, nodeId: 'n01', started: false, finished: false },
      { id: 'p2', ownerId: 'seat-2', label: '말2', nodeIndex: 1, nodeId: 'n02', started: true, finished: false },
    ],
  });

  const moved = reduceMoveCommand({
    state,
    actorId: 'seat-1',
    pieceId: 'p1',
    branchChoice: 'outer',
    actorLogName: '플레이어1',
    playMode: 'individual',
    sides: [{ id: 'seat-1' }, { id: 'seat-2' }],
    makeLog,
  });

  assert.equal(moved.ok, true);
  if (!moved.ok) return;
  assert.equal(moved.patch.turnIndex, 0);
  assert.equal(moved.payload.captured, true);
  const capturedPiece = (moved.patch.pieces as EngineState['pieces']).find((piece) => piece.id === 'p2');
  assert.deepEqual(capturedPiece && {
    nodeId: capturedPiece.nodeId,
    nodeIndex: capturedPiece.nodeIndex,
    started: capturedPiece.started,
    finished: capturedPiece.finished,
  }, { nodeId: 'n01', nodeIndex: 0, started: false, finished: false });
});

test('stacked roll selection honors an explicit timeout override without mutating the stack', () => {
  const rollStack = [doResult, { name: '개', steps: 2, bonus: false } as const];
  const context = resolveEffectiveMoveContext({
    stackedRollMode: true,
    roll: null,
    rollStack,
    rollStackClosed: true,
    selectedRollStackIndex: null,
    rollStackIndexOverride: 1,
  });

  assert.equal(context.fromStack, true);
  assert.equal(context.rollStackIndex, 1);
  assert.equal(context.steps, 2);
  assert.deepEqual(rollStack.map((roll) => roll.name), ['도', '개']);
});

test('sequence recovery runs only when no replay, move, sync, pending action, or recovery conflict exists', () => {
  const clear = {
    sequenceReplayInProgress: false,
    moveInProgress: false,
    applyingSyncedState: false,
    manualSequenceSyncing: false,
    hasPendingRemoteActions: false,
    turnRecoveryInFlight: false,
  };

  assert.equal(shouldDeferSequenceRecovery(clear), false);
  for (const key of Object.keys(clear) as Array<keyof typeof clear>) {
    assert.equal(shouldDeferSequenceRecovery({ ...clear, [key]: true }), true, key);
  }
});
