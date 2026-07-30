import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const appSource = readFileSync('src/app/App.tsx', 'utf8');
const rollStageSource = readFileSync('src/app/containers/RollStage.tsx', 'utf8');
const roomServiceSource = readFileSync('src/features/room/services/roomService.ts', 'utf8');
const presentationLockSource = readFileSync('src/shared/gamePresentationLock.ts', 'utf8');
const rollCompletionSource = readFileSync('src/app/flows/rollPresentationCompletion.ts', 'utf8');

test('presentation wait는 authoritative commit timeout 내부에서 실행된다', () => {
  const settleStart = roomServiceSource.indexOf('return settleAuthoritativeCommit({');
  const commitStart = roomServiceSource.indexOf('commit: async () => {', settleStart);
  const presentationWait = roomServiceSource.indexOf('await waitForGamePresentationBeforeAction', commitStart);
  const coreCommit = roomServiceSource.indexOf('return commitAuthoritativeGameActionCore', presentationWait);
  const exportedCommit = roomServiceSource.indexOf('export async function commitAuthoritativeGameAction');

  assert.ok(settleStart >= 0);
  assert.ok(commitStart > settleStart);
  assert.ok(presentationWait > commitStart);
  assert.ok(coreCommit > presentationWait);
  assert.ok(exportedCommit > coreCommit);
  assert.doesNotMatch(roomServiceSource.slice(exportedCommit), /await waitForGamePresentationBeforeAction/);
});

test('presentation lock 대기는 유한 상한과 timeout 결과를 가진다', () => {
  assert.match(presentationLockSource, /GAME_PRESENTATION_ACTION_WAIT_TIMEOUT_MS\s*=\s*750/);
  assert.match(presentationLockSource, /GamePresentationWaitResult\s*=\s*'idle'\s*\|\s*'timeout'/);
  assert.match(presentationLockSource, /timer\s*=\s*setTimeout\(\(\)\s*=>\s*finish\('timeout'\)/);
  assert.match(roomServiceSource, /presentationWaitResult\s*===\s*'timeout'/);
});

test('watchdog 완료는 추가 result hold 없이 RollStage queue와 presentation lock을 종료한다', () => {
  assert.match(rollCompletionSource, /if \(result === 'watchdog'\) watchdogSettled = true/);
  assert.match(rollCompletionSource, /if \(watchdogSettled\) return 'held'/);
  assert.match(rollStageSource, /completion\.waitForVisualSettle\(\)/);
  assert.match(rollStageSource, /completion\.waitForResultHold\(\)/);
  assert.match(rollStageSource, /gamePresentationLock\.acquire\(\)/);
});

test('AI 작업 키는 성공·거부·timeout·stale 종료 모두 finally에서 현재 작업만 해제한다', () => {
  const autoPlayStart = appSource.indexOf('async function autoPlayTurn');
  const clearHelper = appSource.indexOf('const clearCurrentAiActionKey', autoPlayStart);
  const exactKeyGuard = appSource.indexOf('aiTurnActionKeyRef.current === actionKey', clearHelper);
  const tryStart = appSource.indexOf('try {', exactKeyGuard);
  const finallyStart = appSource.indexOf('} finally {', tryStart);
  const clearCall = appSource.indexOf('clearCurrentAiActionKey();', finallyStart);

  assert.ok(autoPlayStart >= 0);
  assert.ok(clearHelper > autoPlayStart);
  assert.ok(exactKeyGuard > clearHelper);
  assert.ok(tryStart > exactKeyGuard);
  assert.ok(finallyStart > tryStart);
  assert.ok(clearCall > finallyStart);
});

test('AI scheduler는 작업 키가 해제된 최신 snapshot에서 다음 AI 좌석을 다시 예약한다', () => {
  const schedulerStart = appSource.indexOf('const actionKey = `${activeSeat.id}:');
  const occupiedGuard = appSource.indexOf('if (aiTurnActionKeyRef.current) return undefined;', schedulerStart);
  const timerStart = appSource.indexOf('const timer = window.setTimeout', occupiedGuard);
  const claim = appSource.indexOf('aiTurnActionKeyRef.current = actionKey;', timerStart);
  const run = appSource.indexOf('void autoPlayTurn(activeSeat, actionKey);', claim);
  const effectEnd = appSource.indexOf('return () => window.clearTimeout(timer);', run);

  assert.ok(schedulerStart >= 0);
  assert.ok(occupiedGuard > schedulerStart);
  assert.ok(timerStart > occupiedGuard);
  assert.ok(claim > timerStart);
  assert.ok(run > claim);
  assert.ok(effectEnd > run);
  assert.match(appSource.slice(effectEnd, effectEnd + 900), /turnIndex/);
  assert.match(appSource.slice(effectEnd, effectEnd + 900), /rollStack/);
});

test('remote move replay는 좌표 애니메이션 뒤 authoritative snapshot 전체를 다시 적용한다', () => {
  const replayStart = appSource.indexOf('async function replayMoveSequence');
  const finalPieces = appSource.indexOf('setPieces(finalPieces);', replayStart);
  const applyState = appSource.indexOf('applyReplayedMoveState();', finalPieces);
  const finalSnapshot = appSource.indexOf('applySyncedStateSnapshot(replayedState ?? finalState', applyState);

  assert.ok(replayStart >= 0);
  assert.ok(finalPieces > replayStart);
  assert.ok(applyState > finalPieces);
  assert.ok(finalSnapshot > applyState);
});
