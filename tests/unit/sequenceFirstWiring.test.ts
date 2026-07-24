import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(path, 'utf8');

test('정상 원격 동기화는 state listener 대신 sequence-first subscriber를 사용한다', () => {
  const hook = read('src/app/hooks/useGameSync.ts');
  const core = read('src/features/room/services/roomServiceCore.ts');
  const main = read('src/main.tsx');
  const controls = read('src/app/containers/GameBoardControls.tsx');
  const board = read('src/app/containers/GameBoardSection.tsx');
  const overlays = read('src/app/containers/GameBoardOverlays.tsx');

  assert.match(hook, /subscribe = subscribeSequenceFirstGameState/);
  assert.doesNotMatch(hook, /subscribe = subscribeGameState/);
  assert.doesNotMatch(main, /AiDifficultyRuntimeBridge/);
  assert.doesNotMatch(controls, /subscribeGameState/);
  assert.doesNotMatch(board, /subscribeGameState/);
  assert.doesNotMatch(overlays, /subscribeGameState/);
  assert.match(core, /snapshot\.docChanges\(\)/);
  assert.match(core, /change\.type === 'added'/);
  assert.match(core, /includeMetadataChanges: true/);
});

test('브라우저 타이머는 host 메서드를 unbound 상태로 보관하지 않는다', () => {
  const subscription = read('src/app/hooks/sequenceFirstGameStateSubscription.ts');

  assert.doesNotMatch(subscription, /setTimeout:\s*globalThis\.setTimeout/);
  assert.doesNotMatch(subscription, /clearTimeout:\s*globalThis\.clearTimeout/);
  assert.match(
    subscription,
    /setTimeout:\s*\(callback, delayMs\) => globalThis\.setTimeout\(callback, delayMs\)/,
  );
  assert.match(
    subscription,
    /clearTimeout:\s*\(timer\) => globalThis\.clearTimeout\(timer\)/,
  );
});

test('state checkpoint 로그는 최근 200개로 제한한다', () => {
  const core = read('src/features/room/services/roomServiceCore.ts');
  assert.match(core, /MAX_CHECKPOINT_LOGS = 200/);
  assert.match(core, /state\.logs\.slice\(0, MAX_CHECKPOINT_LOGS\)/);
});

test('순서 정하기 상태 전환은 checkpoint와 sequence를 같은 트랜잭션에 기록한다', () => {
  const core = read('src/features/room/services/roomServiceCore.ts');
  const updateTurnOrderState = core.slice(
    core.indexOf('export async function updateTurnOrderState'),
    core.indexOf('export async function submitTurnOrderSubmission'),
  );

  assert.match(updateTurnOrderState, /makeSequenceDocId\(nextSequence\)/);
  assert.match(updateTurnOrderState, /type: 'turn_order_updated'/);
  assert.match(updateTurnOrderState, /transaction\.set\(sequenceRef/);
  assert.match(updateTurnOrderState, /lastSequence: nextSequence/);
});
