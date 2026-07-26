import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(path, 'utf8');

test('coordinator write 경로는 owner와 epoch가 일치하는 활성 lease를 검증한다', () => {
  const service = read('src/features/room/services/roomServiceCore.ts');
  for (const marker of [
    'export async function saveGameState',
    'export async function updateTurnOrderState',
    'export async function completeTurnOrderIntro',
    'export async function resolveTurnOrderIntro',
    'export async function commitAuthoritativeGameAction',
  ]) {
    const start = service.indexOf(marker);
    assert.notEqual(start, -1, `${marker} missing`);
    const nextExport = service.indexOf('\nexport ', start + marker.length);
    const block = service.slice(start, nextExport < 0 ? undefined : nextExport);
    assert.match(block, /hasCurrentCoordinatorLease|canAuthenticatedUserActFromGameSnapshot/);
  }
  assert.match(service, /coordinatorLeaseExpiresAt: Timestamp\.fromMillis/);
  assert.match(service, /decideGameCoordinatorLeaseClaim/);
  assert.match(service, /auth\.currentUser\?\.uid !== token\.coordinatorSeatId/);
  assert.match(service, /initialCoordinatorEpoch = normalizeCoordinatorEpoch\(currentState\?\.coordinatorEpoch\) \+ 1/);
});

test('일반 state와 sequence patch는 lease field를 덮어쓰거나 replay하지 않는다', () => {
  const service = read('src/features/room/services/roomServiceCore.ts');
  const stateWriter = service.slice(service.indexOf('const makeFirestoreStateData'), service.indexOf('const getCoordinatorSequenceFields'));
  const eventWriter = service.slice(service.indexOf('export const makeSequenceEventFields'), service.indexOf('const isTurnOrderIntroActive'));
  for (const field of ['coordinatorSeatId', 'coordinatorEpoch', 'coordinatorLeaseExpiresAt', 'coordinatorLeaseUpdatedAt']) {
    assert.match(stateWriter, new RegExp(`delete .*${field}`));
    assert.match(eventWriter, new RegExp(`delete .*${field}`));
  }
});

test('client는 snapshot lease를 수신하고 delegated action과 turn-order write에 epoch를 첨부한다', () => {
  const app = read('src/app/App.tsx');
  const persistence = read('src/app/hooks/useGameStatePersistence.ts');
  const turnOrder = read('src/app/components/TurnOrderIntroOverlay.tsx');
  assert.match(app, /useGameCoordinatorLease/);
  assert.match(app, /onSnapshotReceived: \(state\)/);
  assert.match(app, /coordinatorLeasePayload = \{ coordinatorSeatId: onlineGameCoordinatorSeatId, coordinatorEpoch \}/);
  assert.match(app, /itemPromptTimeoutRecovery: true[\s\S]{0,240}coordinatorLeasePayload/);
  assert.match(app, /trapPlacementTimeoutRecovery: true[\s\S]{0,320}coordinatorLeasePayload/);
  assert.match(app, /options\.timedOut && pickup\.seatId !== localSeatId/);
  assert.match(persistence, /coordinatorSeatId, coordinatorEpoch/);
  assert.match(turnOrder, /updateTurnOrderState\([\s\S]*coordinatorEpoch/);
  assert.match(turnOrder, /submitTurnOrderSubmission\([\s\S]*coordinatorEpoch/);
  assert.match(turnOrder, /results\.some\(\(result\) => result\.status !== 'committed' && result\.status !== 'duplicate'\)/);
  assert.match(turnOrder, /if \(!result && aggregatingRoundIdRef\.current === round\.id\)/);
  const leaseHook = read('src/app/hooks/useGameCoordinatorLease.ts');
  assert.match(leaseHook, /autoPlayBySeatId/);
  assert.match(leaseHook, /isGameCoordinatorLeaseActive\(leaseState, now\)/);
  assert.match(leaseHook, /\[deadlineReached, leaseState, params\.activeRoomId/);
});
