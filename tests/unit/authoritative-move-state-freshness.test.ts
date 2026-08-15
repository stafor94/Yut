import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { selectNewerAuthoritativeState } from '../../src/app/flows/authoritativeMoveStateFreshness';

test('로컬 이동 연출 중 서버 ACK sequence가 앞서면 최신 authoritative 상태를 선택한다', () => {
  const presented = { lastSequence: 4, turnVersion: 4, roll: { name: '걸', steps: 3 } };
  const serverAck = { lastSequence: 5, turnVersion: 5, roll: null, turnDeadlineKind: 'roll' };

  assert.equal(selectNewerAuthoritativeState(presented, serverAck), serverAck);
  assert.equal(selectNewerAuthoritativeState(serverAck, presented), serverAck);
});

test('같은 sequence에서는 더 높은 turnVersion만 authoritative 후보로 승격한다', () => {
  const current = { lastSequence: 5, turnVersion: 7, marker: 'current' };
  const newerVersion = { lastSequence: 5, turnVersion: 8, marker: 'newer' };
  const sameVersion = { lastSequence: 5, turnVersion: 7, marker: 'same' };

  assert.equal(selectNewerAuthoritativeState(current, newerVersion), newerVersion);
  assert.equal(selectNewerAuthoritativeState(current, sameVersion), current);
});

test('authoritative move ownership은 presented state와 settlement state 모두 최신 snapshot으로 보호한다', () => {
  const source = readFileSync('src/app/controllers/useAuthoritativeGameSyncController.ts', 'utf8');

  assert.match(source, /selectNewerAuthoritativeState\(\s*params\.currentSequenceStateRef\.current,\s*latestSyncedStateRef\.current,?\s*\)/s);
  assert.match(source, /selectNewerAuthoritativeState\(\s*prepared\.finalState as SequenceStateSnapshot,\s*latestSyncedStateRef\.current,?\s*\)/s);
});
