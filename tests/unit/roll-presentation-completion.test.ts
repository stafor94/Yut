import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createGamePresentationLock } from '../../src/shared/gamePresentationLock.js';
import {
  createGameAnimationQueue,
  enqueueRollPresentation,
} from '../../src/app/flows/gameAnimationQueue.js';
import { createRollPresentationCompletion } from '../../src/app/flows/rollPresentationCompletion.js';
import {
  getRollPresentationActive,
  notifyRollPresentationActive,
  subscribeRollPresentationActive,
} from '../../src/app/flows/rollPresentationEvents.js';
import { getMoveActionReady } from '../../src/app/flows/moveActionReadiness.js';
import { initializeYutWebGLRenderer } from '../../src/app/flows/yutWebGLRenderer.js';
import { LOCAL_ROLL_LANDING_MS } from '../../src/app/flows/yutRollAnimation.js';

const rollStageSource = readFileSync('src/app/containers/RollStage.tsx', 'utf8');
const rollPhysicsSource = readFileSync('src/app/components/YutRollScenePhysics.tsx', 'utf8');
const pendingRemoteActionsSource = readFileSync('src/app/hooks/usePendingRemoteActions.ts', 'utf8');
const gameScreenViewSource = readFileSync('src/app/components/GameScreenView.tsx', 'utf8');
const controlsSource = readFileSync('src/app/containers/GameBoardControls.tsx', 'utf8');
const appSource = readFileSync('src/app/App.tsx', 'utf8');

const createDeferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
};

const flushMicrotasks = async () => {
  for (let index = 0; index < 6; index += 1) await Promise.resolve();
};

const readyInput = {
  canSubmitTurnAction: true,
  hasPendingMoveAction: false,
  hasValidMoveSelection: true,
  rollResultHolding: false,
  rollAnimationActive: false,
  moveInProgress: false,
  movingPieceActive: false,
};

test('renderer settle 이후에만 result hold를 시작하고 요청된 hold 시간을 그대로 사용한다', async () => {
  const hold = createDeferred();
  const requestedHoldDurations: number[] = [];
  const completion = createRollPresentationCompletion({
    resultHoldMs: 1000,
    watchdogMs: 1000,
    waitForHold: async (durationMs) => {
      requestedHoldDurations.push(durationMs);
      await hold.promise;
    },
  });
  let finished = false;
  const waiting = completion.waitForCompletion().then((result) => {
    finished = true;
    return result;
  });

  await flushMicrotasks();
  assert.equal(finished, false);
  assert.deepEqual(requestedHoldDurations, [], 'renderer settle 전에는 result hold를 소진하면 안 됩니다.');

  completion.markSettled('three-renderer');
  await flushMicrotasks();
  assert.deepEqual(requestedHoldDurations, [1000], '실제 renderer settle 시점부터 제품 hold를 시작해야 합니다.');
  assert.equal(finished, false);

  hold.resolve();
  assert.equal(await waiting, 'three-renderer');
  assert.equal(finished, true);
});

test('local result-hold는 renderer settle을 기다리는 단일 completion promise를 animation id별로 소유한다', () => {
  assert.match(rollStageSource, /presentationCompletionPromiseByIdRef/);
  assert.match(rollStageSource, /createRollPresentationCompletion\(\{ resultHoldMs: PENDING_ROLL_RESULT_HOLD_MS \}\)/);
  assert.match(rollStageSource, /presentationCompletionPromiseByIdRef\.current\.get\(animation\.id\)/);
  assert.match(rollStageSource, /completionPromise = completion\.waitForCompletion\(\)/);
  assert.match(rollStageSource, /nextAnimation\?\.phase === 'result-hold' && sourceAnimationId === nextAnimation\.id/);
});

test('terminal 부모 null은 live presentation을 직접 종료하지 않고 기존 settle completion 종료를 기다린다', () => {
  const liveCompletedIndex = rollStageSource.indexOf('if (session?.liveCompleted) {');
  const completionIndex = rollStageSource.indexOf('getOrCreateLiveResultHoldCompletion(resolvedAnimation)', liveCompletedIndex);
  const awaitIndex = rollStageSource.indexOf('completionResult = await completionPromise', completionIndex);
  const completedIndex = rollStageSource.indexOf('markRollPresentationCompleted', awaitIndex);
  const clearIndex = rollStageSource.indexOf('presentAnimation(null);', completedIndex);

  assert.ok(liveCompletedIndex >= 0, 'terminal live presentation 분기가 있어야 합니다.');
  assert.ok(completionIndex > liveCompletedIndex, '부모 null은 기존 visual completion을 조회해야 합니다.');
  assert.ok(awaitIndex > completionIndex, 'renderer settle과 visible hold completion을 기다려야 합니다.');
  assert.ok(completedIndex > awaitIndex, 'completion 전에 session을 completed로 만들면 안 됩니다.');
  assert.ok(clearIndex > completedIndex, 'completion 전에 presentation을 제거하면 안 됩니다.');
});

test('WebGL 초기화 실패는 즉시 CSS fallback이 되고 정상 fallback settle은 watchdog을 사용하지 않는다', async () => {
  const renderer = initializeYutWebGLRenderer(() => {
    throw new Error('webgl unavailable');
  });
  assert.equal(renderer.status, 'fallback');
  assert.equal(renderer.renderer, null);

  const completion = createRollPresentationCompletion({ resultHoldMs: 0, watchdogMs: LOCAL_ROLL_LANDING_MS * 4 });
  const waiting = completion.waitForCompletion();
  completion.markSettled('css-animation-end');
  assert.equal(await waiting, 'css-animation-end');

  assert.match(rollPhysicsSource, /import \* as THREE from 'three'/);
  assert.doesNotMatch(rollPhysicsSource, /jsdelivr|unpkg|THREE_MODULE_URLS|threeModulePromise/);
  assert.doesNotMatch(rollPhysicsSource, /RendererStatus = 'loading'/);
  assert.match(rollPhysicsSource, /LOCAL_ROLL_LANDING_MS - landingElapsedMs/);
});

test('presentation active 동안 canonical moveActionReady는 false이고 completion 직후 true가 된다', () => {
  notifyRollPresentationActive(false);
  const states: boolean[] = [];
  const unsubscribe = subscribeRollPresentationActive((active) => states.push(active));

  notifyRollPresentationActive(true);
  assert.equal(getMoveActionReady({ ...readyInput, rollPresentationBlocked: getRollPresentationActive() }), false);
  notifyRollPresentationActive(false);
  assert.equal(getMoveActionReady({ ...readyInput, rollPresentationBlocked: getRollPresentationActive() }), true);
  assert.deepEqual(states, [false, true, false]);
  unsubscribe();

  assert.match(rollStageSource, /notifyRollPresentationActive\(state\.active\)/);
  assert.match(pendingRemoteActionsSource, /useRef<Set<string>>\(new Set\(\)\)/);
  assert.doesNotMatch(pendingRemoteActionsSource, /PresentationAwarePendingActionSet|__roll_presentation_active__|ROLL_PRESENTATION_BLOCKER_ACTION_KEY/);
  assert.match(appSource, /getMoveActionReady/);
  assert.match(appSource, /rollPresentationBlocked/);
  assert.doesNotMatch(appSource, /activeRoomId && pendingLocalRemoteActionsRef\.current\.size > 0/);
  assert.match(gameScreenViewSource, /moveActionReady=\{moveActionReady\}/);
  assert.match(controlsSource, /disabled=\{!actionReady \|\| turnActionTimedOut \|\| !moveActionReady\}/);
  assert.match(appSource, /onMoveSelectedPiece=\{\(options\) => moveSelectedPiece\(0, options\)\}/);
});

test('queued remote roll keeps the presentation lock until the renderer settles', async () => {
  const queue = createGameAnimationQueue();
  const lock = createGamePresentationLock();
  const completion = createRollPresentationCompletion({ resultHoldMs: 0, watchdogMs: 1000 });

  const presentation = enqueueRollPresentation({
    key: 'remote-fall-actual-settle',
    animation: { id: 1000 },
    queue,
    lock,
    task: async () => {
      await completion.waitForCompletion();
    },
  });

  await flushMicrotasks();
  assert.equal(lock.isLocked(), true);
  assert.equal(queue.isBusy(), true);

  completion.markSettled('css-animation-end');
  await presentation;
  await flushMicrotasks();
  assert.equal(lock.isLocked(), false);
  assert.equal(queue.isBusy(), false);
});

test('watchdog은 renderer settle 신호 유실 시에만 bounded fallback으로 completion한다', async () => {
  let holdCalls = 0;
  const completion = createRollPresentationCompletion({
    watchdogMs: 0,
    waitForHold: async () => {
      holdCalls += 1;
    },
  });

  assert.equal(await completion.waitForVisualSettle(), 'watchdog');
  assert.equal(await completion.waitForResultHold(), 'held');
  assert.equal(holdCalls, 0);
});

test('presentation completion can be cancelled without waiting for the result hold', async () => {
  const hold = createDeferred();
  const completion = createRollPresentationCompletion({
    watchdogMs: 1000,
    waitForHold: () => hold.promise,
  });
  const waiting = completion.waitForCompletion();

  completion.cancel();
  assert.equal(await waiting, 'cancelled');
});
