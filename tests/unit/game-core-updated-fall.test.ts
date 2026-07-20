import assert from 'node:assert/strict';
import test from 'node:test';
import { reduceAuthoritativeGameAction } from '../../src/features/room/services/roomAuthoritativeReducer';
import { TURN_NETWORK_GRACE_MS } from '../../src/features/room/services/roomTiming';
import type { EngineState } from '../../src/game-core/gameEngine';

const withMockRandom = <T>(values: number[], callback: () => T): T => {
  const originalRandom = Math.random;
  let index = 0;
  Math.random = () => values[Math.min(index++, values.length - 1)] ?? 0.5;
  try {
    return callback();
  } finally {
    Math.random = originalRandom;
  }
};

const withMockNow = <T>(now: number, callback: () => T): T => {
  const originalNow = Date.now;
  Date.now = () => now;
  try {
    return callback();
  } finally {
    Date.now = originalNow;
  }
};

const baseState = (): EngineState => ({
  pieces: [
    { id: 'p1', ownerId: 'seat-1', nodeIndex: 0, nodeId: 'n01', started: false, finished: false },
    { id: 'p2', ownerId: 'seat-2', nodeIndex: 0, nodeId: 'n01', started: false, finished: false },
  ],
  turnIndex: 0,
  turnOrderIds: ['seat-1', 'seat-2'],
  roll: null,
  logs: [],
  winner: '',
  trapNodes: [],
  shieldedPieceIds: [],
  branchChoice: 'outer',
  boardItems: [],
  ownedItems: {},
});

const replacementTests = new Map<string, () => void>([
  ['온라인 누적 AI 낙 후 다음 플레이어가 황금 윷을 보유하면 before_roll 선택 대기를 연다', () => withMockRandom([0.9, 0.9, 0.9, 0.9, 0], () => {
    const fall = reduceAuthoritativeGameAction(
      {
        ...baseState(),
        ownedItems: { 'seat-2': ['golden_yut'] },
        logs: [],
      },
      { type: 'roll_yut', actorId: 'seat-1', payload: { rollTimingZone: 'normal' } },
      { playMode: 'individual', pieceCount: 4, stackedRollMode: true },
    );

    assert.equal(fall.status, 'committed');
    assert.equal(fall.payload?.fallOccurred, true);
    assert.equal(fall.payload?.turnAdvancedIndependently, true);
    assert.equal(fall.payload?.fallPresentationReadyAt, fall.patch?.rollResultReadyAt);
    assert.equal(fall.patch?.turnIndex, 1);
    assert.deepEqual(fall.patch?.rollStack, []);
    assert.equal(fall.patch?.selectedRollStackIndex, null);
    assert.equal(fall.patch?.itemPromptTiming, 'before_roll');
    assert.equal(fall.patch?.turnDeadlineKind, 'item_prompt');
    assert.equal(fall.patch?.pendingGoldenYutSelection ?? null, null);
  })],
  ['온라인 누적 낙 후 다음 플레이어에게 before_roll 아이템이 없으면 roll 상태를 유지한다', () => withMockRandom([0.9, 0.9, 0.9, 0.9, 0], () => {
    const fall = reduceAuthoritativeGameAction(
      {
        ...baseState(),
        ownedItems: {},
        logs: [],
      },
      { type: 'roll_yut', actorId: 'seat-1', payload: { rollTimingZone: 'normal' } },
      { playMode: 'individual', pieceCount: 4, stackedRollMode: true },
    );

    assert.equal(fall.status, 'committed');
    assert.equal(fall.payload?.fallOccurred, true);
    assert.equal(fall.payload?.turnAdvancedIndependently, true);
    assert.equal(fall.payload?.fallPresentationReadyAt, fall.patch?.rollResultReadyAt);
    assert.equal(fall.patch?.turnIndex, 1);
    assert.deepEqual(fall.patch?.rollStack, []);
    assert.equal(fall.patch?.selectedRollStackIndex, null);
    assert.equal(fall.patch?.itemPromptTiming, null);
    assert.equal(fall.patch?.turnDeadlineKind, 'roll');
    assert.equal(fall.patch?.pendingGoldenYutSelection ?? null, null);
  })],
  ['온라인 아이템 timeout 복구는 프롬프트 대상 actor 불일치를 거부한다', () => withMockNow(10_000, () => {
    const deadline = 10_000 - TURN_NETWORK_GRACE_MS - 1;
    const result = reduceAuthoritativeGameAction(
      {
        ...baseState(),
        roll: { name: '도', steps: 1 },
        itemPromptTiming: 'after_roll',
        turnDeadlineKind: 'item_prompt',
        turnDeadlineAt: deadline,
      } as EngineState & { itemPromptTiming: 'after_roll'; turnDeadlineKind: 'item_prompt'; turnDeadlineAt: number },
      { type: 'use_item', actorId: 'seat-2', payload: { skipAfterRollItem: true, itemPromptTimeoutRecovery: true, timeoutDeadlineAt: deadline } },
      { playMode: 'individual', pieceCount: 4, stackedRollMode: false },
    );

    assert.equal(result.status, 'rejected');
    assert.equal(result.reason, '아이템 선택 시간초과 대상이 아닙니다.');
  })],
]);

type TestRegistrar = (...args: unknown[]) => unknown;
type ModuleLoader = (request: string, parent: NodeModule | null, isMain: boolean) => unknown;
const nodeModule = require('node:module') as { _load: ModuleLoader };
const originalLoad = nodeModule._load;
const rawTest = test as unknown as TestRegistrar;
const filteredTest = ((name: unknown, optionsOrFn?: unknown, maybeFn?: unknown) => {
  const replacement = replacementTests.get(String(name));
  if (replacement) return rawTest(String(name), replacement);
  if (maybeFn === undefined) return rawTest(name, optionsOrFn);
  return rawTest(name, optionsOrFn, maybeFn);
}) as typeof test;
Object.assign(filteredTest, test);

nodeModule._load = function loadWithUpdatedFallTests(request, parent, isMain) {
  if (request === 'node:test') return filteredTest;
  return originalLoad.call(this, request, parent, isMain);
};

try {
  require('./game-core.cases');
} finally {
  nodeModule._load = originalLoad;
}
