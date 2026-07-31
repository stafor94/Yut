import test from 'node:test';
import assert from 'node:assert/strict';
import {
  makeTimeoutActionKey,
  resolveRollTimeoutAction,
  runWithRollTimeoutRandom,
} from '../../src/features/room/services/timeoutResolvers';
import {
  aliasTimeoutRollMutationIds,
  canonicalizeTimeoutRollAction,
  clearTimeoutRollMutationAliases,
  registerPendingTimeoutRollCandidate,
  removePendingTimeoutRollCandidate,
} from '../../src/features/room/services/timeoutRollActionIdentity';
import { rollYutResultWithTiming, shouldFallForTimingZone } from '../../src/game-core/roll';

const deadlineAt = 1_700_000_010_000;

const pickTimeoutRollLikeApp = () => runWithRollTimeoutRandom(deadlineAt, () => {
  const clientRollResult = rollYutResultWithTiming('good').result;
  const clientFallOccurred = shouldFallForTimingZone('good');
  const clientFallCount = clientFallOccurred ? Math.floor(Math.random() * 4) + 1 : 0;
  return { clientRollResult, clientFallOccurred, clientFallCount };
});

test('같은 timeout resolver 입력은 오브·등급·결과·낙·윷가락까지 완전히 동일하다', () => {
  const input = {
    roomId: 'room-1',
    actorId: 'seat-1',
    timeoutDeadlineAt: deadlineAt,
    timeoutWindowMs: 10_000,
    gameStartedAt: 1_699_999_900_000,
    turnIndex: 4,
  };
  const first = resolveRollTimeoutAction(input);
  const second = resolveRollTimeoutAction(input);
  assert.deepEqual(first, second);
  assert.equal(first.initialDirection, 'forward');
  assert.ok(first.initialPositionPercent >= 0 && first.initialPositionPercent <= 30);
  assert.equal(first.sticks.length, 4);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.sticks), true);
});

test('UI 동기 callback의 난수 stream은 coordinator resolver 결과와 동일하다', () => {
  const visibleResult = pickTimeoutRollLikeApp();
  const resolution = resolveRollTimeoutAction({
    roomId: 'room-1',
    actorId: 'seat-1',
    timeoutDeadlineAt: deadlineAt,
    timingPositionPercent: 35,
    rollTimingZone: 'good',
  });
  assert.deepEqual(visibleResult.clientRollResult, resolution.clientRollResult);
  assert.equal(visibleResult.clientFallOccurred, resolution.clientFallOccurred);
  assert.equal(visibleResult.clientFallCount, resolution.clientFallCount);
});

test('UI와 coordinator action은 같은 canonical key와 gameplay payload로 정규화된다', () => {
  clearTimeoutRollMutationAliases('room-1');
  const visibleResult = pickTimeoutRollLikeApp();
  const uiAction = canonicalizeTimeoutRollAction('room-1', {
    type: 'roll_yut',
    actorId: 'seat-1',
    payload: {
      timedOut: true,
      timeoutDeadlineAt: deadlineAt,
      timeoutRecoveredBy: 'seat-1',
      timingPositionPercent: 35,
      rollTimingZone: 'good',
      ...visibleResult,
      clientActionId: 'roll_yut:seat-1:local-random-key',
    },
  });
  const coordinatorAction = canonicalizeTimeoutRollAction('room-1', {
    type: 'roll_yut',
    actorId: 'seat-1',
    payload: {
      timedOut: true,
      timeoutDeadlineAt: deadlineAt,
      timingPositionPercent: 35,
      rollTimingZone: 'good',
      clientActionId: makeTimeoutActionKey({
        roomId: 'room-1',
        stage: 'roll',
        actorId: 'seat-1',
        timeoutDeadlineAt: deadlineAt,
      }),
    },
  });

  assert.equal(uiAction.payload?.clientActionId, coordinatorAction.payload?.clientActionId);
  assert.deepEqual(uiAction.payload?.clientRollResult, coordinatorAction.payload?.clientRollResult);
  assert.equal(uiAction.payload?.clientFallOccurred, coordinatorAction.payload?.clientFallOccurred);
  assert.equal(uiAction.payload?.clientFallCount, coordinatorAction.payload?.clientFallCount);
  assert.equal(uiAction.payload?.timingPositionPercent, coordinatorAction.payload?.timingPositionPercent);
  assert.equal(uiAction.payload?.rollTimingZone, coordinatorAction.payload?.rollTimingZone);
  assert.equal(uiAction.payload?.timeoutDeadlineAt, undefined, 'UI request는 deadline 즉시 제출되므로 recovery grace 검증 필드를 제거한다.');
  assert.equal(coordinatorAction.payload?.timeoutDeadlineAt, deadlineAt);

  const echoed = aliasTimeoutRollMutationIds('room-1', {
    clientMutationId: coordinatorAction.payload?.clientActionId,
    stateAfter: { lastClientMutationId: coordinatorAction.payload?.clientActionId },
  });
  assert.equal(echoed.clientMutationId, 'roll_yut:seat-1:local-random-key');
  assert.equal(echoed.stateAfter.lastClientMutationId, 'roll_yut:seat-1:local-random-key');
});

test('UI 제출 전 coordinator snapshot이 먼저 와도 pending timeout animation key로 alias한다', () => {
  clearTimeoutRollMutationAliases('room-race');
  const localKey = 'roll_yut:seat-race:pending-local-key';
  const registered = runWithRollTimeoutRandom(deadlineAt, () => (
    registerPendingTimeoutRollCandidate('room-race', localKey, 'seat-race')
  ));
  assert.equal(registered, true);
  const canonicalKey = makeTimeoutActionKey({
    roomId: 'room-race',
    stage: 'roll',
    actorId: 'seat-race',
    timeoutDeadlineAt: deadlineAt,
  });
  assert.equal(aliasTimeoutRollMutationIds('room-race', { clientMutationId: canonicalKey }).clientMutationId, localKey);
  removePendingTimeoutRollCandidate('room-race', localKey);
  clearTimeoutRollMutationAliases('room-race');
});

test('일반 수동 던지기 pending key는 timeout snapshot alias 후보로 등록하지 않는다', () => {
  clearTimeoutRollMutationAliases('room-manual');
  const localKey = 'roll_yut:seat-manual:pending-manual-key';
  assert.equal(registerPendingTimeoutRollCandidate('room-manual', localKey, 'seat-manual'), false);
  const canonicalKey = makeTimeoutActionKey({
    roomId: 'room-manual',
    stage: 'roll',
    actorId: 'seat-manual',
    timeoutDeadlineAt: deadlineAt,
  });
  assert.equal(aliasTimeoutRollMutationIds('room-manual', { clientMutationId: canonicalKey }).clientMutationId, canonicalKey);
});

test('다음 게임·다음 턴·다음 deadline의 timeout action key는 충돌하지 않는다', () => {
  const base = makeTimeoutActionKey({
    roomId: 'room-1',
    gameStartedAt: 100,
    turnIndex: 2,
    stage: 'roll',
    actorId: 'seat-1',
    timeoutDeadlineAt: 1_000,
  });
  assert.notEqual(base, makeTimeoutActionKey({ roomId: 'room-1', gameStartedAt: 101, turnIndex: 2, stage: 'roll', actorId: 'seat-1', timeoutDeadlineAt: 1_000 }));
  assert.notEqual(base, makeTimeoutActionKey({ roomId: 'room-1', gameStartedAt: 100, turnIndex: 3, stage: 'roll', actorId: 'seat-1', timeoutDeadlineAt: 1_000 }));
  assert.notEqual(base, makeTimeoutActionKey({ roomId: 'room-1', gameStartedAt: 100, turnIndex: 2, stage: 'roll', actorId: 'seat-1', timeoutDeadlineAt: 1_001 }));
});
