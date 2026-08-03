import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ONLINE_ROLL_FAST_PRESENTATION_MS,
  getAuthoritativeRollPresentationReadyAt,
} from '../../src/features/room/services/rollPresentationTiming';

test('primary 구간 안에 결과가 확정되면 제출 시각 기준 전체 연출 뒤 행동 가능하다', () => {
  const actionStartedAt = 10_000;
  const readyAt = getAuthoritativeRollPresentationReadyAt({ actionStartedAt, resolvedAt: 10_700 });
  assert.equal(readyAt, actionStartedAt + ONLINE_ROLL_FAST_PRESENTATION_MS);
});

test('primary 경계를 지난 지연 응답은 현재 extra-spin의 다음 1초 경계 뒤 landing·hold를 보장한다', () => {
  const readyAt = getAuthoritativeRollPresentationReadyAt({ actionStartedAt: 10_000, resolvedAt: 12_001 });
  assert.equal(readyAt, 14_200);
});

test('extra-spin 경계에서 확정된 결과는 추가 1초를 불필요하게 기다리지 않는다', () => {
  const readyAt = getAuthoritativeRollPresentationReadyAt({ actionStartedAt: 10_000, resolvedAt: 12_200 });
  assert.equal(readyAt, 14_200);
});

test('제출 시각이 없는 coordinator 결과도 전체 연출 시간보다 먼저 deadline을 시작하지 않는다', () => {
  const resolvedAt = 20_000;
  assert.equal(
    getAuthoritativeRollPresentationReadyAt({ resolvedAt }),
    resolvedAt + ONLINE_ROLL_FAST_PRESENTATION_MS,
  );
});

test('move deadline은 action-ready 시각부터 전체 10초를 부여할 수 있다', () => {
  const readyAt = getAuthoritativeRollPresentationReadyAt({ actionStartedAt: 30_000, resolvedAt: 30_500 });
  const deadlineAt = readyAt + 10_000;
  assert.equal(deadlineAt - readyAt, 10_000);
});
