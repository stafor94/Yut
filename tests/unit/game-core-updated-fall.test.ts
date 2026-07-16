import assert from 'node:assert/strict';
import test from 'node:test';
import { reduceAuthoritativeGameAction } from '../../src/features/room/services/roomAuthoritativeReducer';
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

const completePendingFall = (state: EngineState, clientActionId: string) => reduceAuthoritativeGameAction(
  state,
  {
    type: 'roll_yut',
    actorId: 'seat-1',
    payload: { completeFallPresentation: true, clientActionId },
  },
  { playMode: 'individual', pieceCount: 4, stackedRollMode: true },
);

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
    assert.equal(fall.payload?.fallPresentationPending, true);
    assert.equal(fall.patch?.turnIndex, 0);
    assert.deepEqual(fall.patch?.rollStack, []);
    assert.equal(fall.patch?.selectedRollStackIndex, null);

    const completed = completePendingFall({
      ...baseState(),
      ...fall.patch,
      ownedItems: { 'seat-2': ['golden_yut'] },
      logs: (fall.patch?.logs as EngineState['logs'] | undefined) ?? [],
    } as EngineState, 'complete-stacked-fall-before-roll-item');

    assert.equal(completed.status, 'committed');
    assert.equal(completed.payload?.fallPresentationCompleted, true);
    assert.equal(completed.patch?.turnIndex, 1);
    assert.equal(completed.patch?.itemPromptTiming, 'before_roll');
    assert.equal(completed.patch?.turnDeadlineKind, 'item_prompt');
    assert.equal(completed.patch?.pendingGoldenYutSelection, null);
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
    assert.equal(fall.payload?.fallPresentationPending, true);
    assert.equal(fall.patch?.turnIndex, 0);
    assert.deepEqual(fall.patch?.rollStack, []);
    assert.equal(fall.patch?.selectedRollStackIndex, null);

    const completed = completePendingFall({
      ...baseState(),
      ...fall.patch,
      ownedItems: {},
      logs: (fall.patch?.logs as EngineState['logs'] | undefined) ?? [],
    } as EngineState, 'complete-stacked-fall-roll');

    assert.equal(completed.status, 'committed');
    assert.equal(completed.payload?.fallPresentationCompleted, true);
    assert.equal(completed.patch?.turnIndex, 1);
    assert.equal(completed.patch?.itemPromptTiming, null);
    assert.equal(completed.patch?.turnDeadlineKind, 'roll');
    assert.equal(completed.patch?.pendingGoldenYutSelection, null);
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
