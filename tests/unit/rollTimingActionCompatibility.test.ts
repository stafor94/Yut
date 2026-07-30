import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import { normalizeLegacyRollTimingAction } from '../../src/features/room/services/rollTimingActionCompatibility.js';

const makeRollAction = (payload: Record<string, unknown>) => ({
  type: 'roll_yut',
  actorId: 'seat-1',
  payload,
});

const withMockedRandom = <T>(values: number[], run: () => T): T => {
  const originalRandom = Math.random;
  let index = 0;
  Math.random = () => values[index++] ?? values[values.length - 1] ?? 0;
  try {
    return run();
  } finally {
    Math.random = originalRandom;
  }
};

test('사용자가 제출한 낙 개수는 authoritative 입력 경계에서 등급 범위로 정규화된다', () => {
  const nice = normalizeLegacyRollTimingAction(makeRollAction({
    rollTimingZone: 'nice',
    clientFallOccurred: true,
    clientFallCount: 4,
  }));
  const good = normalizeLegacyRollTimingAction(makeRollAction({
    rollTimingZone: 'good',
    clientFallOccurred: true,
    clientFallCount: 99,
  }));
  const bad = normalizeLegacyRollTimingAction(makeRollAction({
    rollTimingZone: 'bad',
    clientFallOccurred: true,
    clientFallCount: -8,
  }));

  assert.equal(nice.payload?.clientFallCount, 1);
  assert.equal(good.payload?.clientFallCount, 2);
  assert.equal(bad.payload?.clientFallCount, 2);
});

test('AI와 자동 행동처럼 낙 필드가 없는 요청도 사용자 요청과 동일한 공통 규칙으로 확정된다', () => {
  const niceAi = withMockedRandom([0.01, 0.99], () => normalizeLegacyRollTimingAction(makeRollAction({
    rollTimingZone: 'nice',
    source: 'ai',
  })));
  const goodAutomatic = withMockedRandom([0.01, 0.99], () => normalizeLegacyRollTimingAction(makeRollAction({
    rollTimingZone: 'good',
    source: 'turn-timeout',
  })));
  const badAutomatic = withMockedRandom([0.01, 0.99], () => normalizeLegacyRollTimingAction(makeRollAction({
    rollTimingZone: 'bad',
    source: 'automatic',
  })));

  assert.equal(niceAi.payload?.clientFallOccurred, true);
  assert.equal(niceAi.payload?.clientFallCount, 1);
  assert.equal(goodAutomatic.payload?.clientFallOccurred, true);
  assert.equal(goodAutomatic.payload?.clientFallCount, 2);
  assert.equal(badAutomatic.payload?.clientFallOccurred, true);
  assert.equal(badAutomatic.payload?.clientFallCount, 4);
});

test('낙이 아닌 요청은 잘못된 개수를 전달해도 authoritative payload에 0개로 기록된다', () => {
  const action = normalizeLegacyRollTimingAction(makeRollAction({
    rollTimingZone: 'bad',
    clientFallOccurred: false,
    clientFallCount: 4,
  }));
  assert.equal(action.payload?.clientFallOccurred, false);
  assert.equal(action.payload?.clientFallCount, 0);
});

test('비정상적인 클라이언트 값과 구버전 Normal 요청은 게임을 중단하지 않고 호환 범위로 정규화된다', () => {
  const malformed = normalizeLegacyRollTimingAction(makeRollAction({
    rollTimingZone: 'good',
    clientFallOccurred: true,
    clientFallCount: 'not-a-number',
  }));
  const legacy = normalizeLegacyRollTimingAction(makeRollAction({
    rollTimingZone: 'normal',
    clientFallOccurred: true,
    clientFallCount: 9,
  }));

  assert.equal(malformed.payload?.clientFallCount, 1);
  assert.equal(legacy.payload?.rollTimingZone, 'bad');
  assert.equal(legacy.payload?.legacyRollTimingZone, 'normal');
  assert.equal(legacy.payload?.clientFallCount, 4);
});

test('황금 윷 선택은 기존 계약대로 낙을 발생시키지 않는다', () => {
  const action = normalizeLegacyRollTimingAction(makeRollAction({
    rollTimingZone: 'bad',
    selectedGoldenYutResult: '모',
    clientFallOccurred: true,
    clientFallCount: 4,
  }));
  assert.equal(action.payload?.clientFallOccurred, false);
  assert.equal(action.payload?.clientFallCount, 0);
});

test('모든 온라인 사용자·AI·자동 행동은 reducer 호출 전에 동일한 정규화 경계를 통과한다', async () => {
  const source = await fs.readFile('src/features/room/services/roomService.ts', 'utf8');
  const settleStart = source.indexOf('const settleRoomAction');
  const settleEnd = source.indexOf('export async function commitAuthoritativeGameAction', settleStart);
  const settleSource = source.slice(settleStart, settleEnd);

  assert.ok(settleStart >= 0);
  assert.match(settleSource, /normalizeLegacyRollTimingAction\(action\)/);
  assert.match(settleSource, /commitAuthoritativeGameActionCore\(roomId, normalizedAction\)/);
  assert.equal(/commitAuthoritativeGameActionCore\(roomId, action\)/.test(settleSource), false);
});
