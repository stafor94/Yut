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

test('state checkpoint 로그는 최근 200개로 제한한다', () => {
  const core = read('src/features/room/services/roomServiceCore.ts');
  assert.match(core, /MAX_CHECKPOINT_LOGS = 200/);
  assert.match(core, /state\.logs\.slice\(0, MAX_CHECKPOINT_LOGS\)/);
});
