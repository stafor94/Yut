import assert from 'node:assert/strict';
import test from 'node:test';
import { applySequenceEvent, applySequenceEvents } from '../../src/app/hooks/applySequenceEvent.js';

type GameSequence = {
  id: string;
  sequence: number;
  type: string;
  actorId: string;
  payload?: Record<string, unknown>;
  schemaVersion?: 1 | 2;
  eventSchemaVersion?: number;
  clientMutationId?: string;
  patch?: Record<string, unknown> | null;
  logEntries?: unknown[];
  stateAfter?: Record<string, unknown> | null;
};

type SyncedGameState = Record<string, unknown> & {
  logs: unknown[];
  lastSequence?: number;
  turnVersion?: number;
  lastClientMutationId?: string;
};

type SequenceStateSnapshot = Record<string, unknown> & {
  logs?: unknown[];
  lastSequence?: number;
  turnVersion?: number;
  lastClientMutationId?: string;
  turnIndex?: number;
};

const baseState = (overrides: Partial<SyncedGameState> = {}): SyncedGameState => ({
  pieces: [{ id: 'p1', nodeId: 'start' }],
  turnIndex: 0,
  roll: null,
  boardItems: [{ id: 'b1', nodeId: 'n1', type: 'reroll' }],
  ownedItems: { s1: ['shield'] },
  trapNodes: [],
  shieldedPieceIds: [],
  logs: [{ id: 1, text: '기존 로그' }],
  winner: '',
  turnVersion: 1,
  lastSequence: 1,
  lastClientMutationId: 'previous-action',
  ...overrides,
});

const sequence = (overrides: Partial<GameSequence>): GameSequence => ({
  id: String(overrides.sequence ?? 1),
  sequence: Number(overrides.sequence ?? 1),
  type: 'state_snapshot',
  actorId: 'system',
  payload: {},
  ...overrides,
});

test('v1 sequence는 stateAfter snapshot을 그대로 적용한다', () => {
  const stateAfter = baseState({ turnIndex: 1, lastSequence: 2, turnVersion: 4, logs: [{ id: 2, text: '새 로그' }] });
  const result = applySequenceEvent(baseState() as any, sequence({ sequence: 2, eventSchemaVersion: 1, stateAfter }));
  assert.equal(result?.turnIndex, 1);
  assert.equal(result?.turnVersion, 4);
  assert.deepEqual(result?.logs, [{ id: 2, text: '새 로그' }]);
  assert.equal(result?.lastSequence, 2);
});

test('v2 sequence는 patch와 메타데이터를 직전 state에 적용하고 중복 sequence는 무시한다', () => {
  const before = baseState();
  const event = sequence({
    sequence: 2,
    schemaVersion: 2,
    clientMutationId: 'move-piece-2',
    patch: { turnIndex: 1, pieces: [{ id: 'p1', nodeId: 'n2' }] },
    logEntries: [{ id: 2, text: '새 로그' }],
  });
  const result = applySequenceEvent(before as any, event);
  assert.equal(result?.turnIndex, 1);
  assert.equal(result?.turnVersion, 2);
  assert.equal(result?.lastClientMutationId, 'move-piece-2');
  assert.deepEqual(result?.pieces, [{ id: 'p1', nodeId: 'n2' }]);
  assert.deepEqual(result?.logs, [{ id: 2, text: '새 로그' }, { id: 1, text: '기존 로그' }]);
  assert.equal(applySequenceEvent(result as any, event), result);
});

test('authoritative 윷 sequence는 원격 표시용 Nice 등급을 결과에 보존한다', () => {
  const event = sequence({
    sequence: 2,
    type: 'roll_yut',
    payload: { timingZone: 'nice', displayRoll: { name: '개', steps: 2 } },
    stateAfter: baseState({ roll: { name: '개', steps: 2 }, lastRollTimingZone: 'nice' }),
  });
  const result = applySequenceEvent(baseState() as any, event);
  assert.deepEqual(result?.roll, { name: '개', steps: 2, presentationTimingGrade: 'nice' });
  assert.deepEqual(event.payload?.displayRoll, { name: '개', steps: 2, presentationTimingGrade: 'nice' });
});

test('누적 던지기와 레거시 Normal sequence는 표시 결과를 Bad로 보존한다', () => {
  const event = sequence({
    sequence: 2,
    type: 'roll_yut',
    payload: { rollTimingZone: 'normal', displayRoll: { name: '도', steps: 1 } },
    patch: { roll: null, lastRollTimingZone: 'normal' },
  });
  const result = applySequenceEvent(baseState() as any, event);
  assert.equal(result?.roll, null);
  assert.deepEqual(event.payload?.displayRoll, { name: '도', steps: 1, presentationTimingGrade: 'bad' });
});

test('v2 patch에 turnVersion이 명시되면 파생값보다 우선하고 mutation id가 없으면 기존 값을 유지한다', () => {
  const result = applySequenceEvent(baseState({ turnVersion: 7 }) as any, sequence({
    sequence: 2,
    schemaVersion: 2,
    patch: { turnIndex: 1, turnVersion: 11 },
  }));
  assert.equal(result?.turnVersion, 11);
  assert.equal(result?.lastClientMutationId, 'previous-action');
});

test('sequence gap이나 기준 state 부재 시 v2 patch를 임의 적용하지 않는다', () => {
  assert.equal(applySequenceEvent(null, sequence({ sequence: 2, schemaVersion: 2, patch: { turnIndex: 1 } })), null);
  assert.equal(applySequenceEvent(baseState({ lastSequence: 0 }) as any, sequence({ sequence: 2, schemaVersion: 2, patch: { turnIndex: 1 } })), null);
});

test('문자열 id와 id 없는 로그도 서로 다른 항목으로 보존하고 중복만 제거한다', () => {
  const before = baseState({ logs: [{ id: 'existing', text: '기존' }, { text: 'id 없음 1' }] });
  const result = applySequenceEvent(before as any, sequence({
    sequence: 2,
    schemaVersion: 2,
    patch: {},
    logEntries: [
      { id: 'new', text: '신규' },
      { text: 'id 없음 2' },
      { text: 'id 없음 2' },
      { id: 'existing', text: '기존' },
    ],
  }));
  assert.deepEqual(result?.logs, [
    { id: 'new', text: '신규' },
    { text: 'id 없음 2' },
    { id: 'existing', text: '기존' },
    { text: 'id 없음 1' },
  ]);
});

test('연속 v2 event는 입력 순서와 무관하게 authoritative 버전과 state를 복원한다', () => {
  let before: SequenceStateSnapshot = baseState() as any;
  const events: GameSequence[] = [];
  for (let index = 0; index < 200; index += 1) {
    const nextSequence = index + 2;
    const mutationId = `action-${nextSequence}`;
    const after = {
      ...before,
      turnIndex: index + 1,
      turnVersion: index + 2,
      lastSequence: nextSequence,
      lastClientMutationId: mutationId,
      logs: [{ id: nextSequence, text: `로그 ${nextSequence}` }, ...(before.logs ?? [])].slice(0, 200),
    };
    events.push(sequence({
      sequence: nextSequence,
      schemaVersion: 2,
      clientMutationId: mutationId,
      patch: { turnIndex: after.turnIndex },
      logEntries: [{ id: nextSequence, text: `로그 ${nextSequence}` }],
    }));
    before = after;
    const replayed = applySequenceEvents(baseState() as any, [...events].reverse());
    assert.deepEqual(replayed, after);
  }
});

test('신규 sequence writer는 v2 필드만 기록하도록 구성되어 있다', async () => {
  const fs = await import('node:fs/promises');
  const sourcePaths = [
    'src/features/room/services/roomService.ts',
    'src/features/room/services/roomServiceCore.ts',
  ];
  const sources = await Promise.all(sourcePaths.map((sourcePath) => fs.readFile(sourcePath, 'utf8')));
  const source = sources.find((candidate) => candidate.includes('export const makeSequenceEventFields')) ?? '';
  assert.notEqual(source, '');
  const helperStart = source.indexOf('export const makeSequenceEventFields');
  const helperEnd = source.indexOf('const isTurnOrderIntroActive', helperStart);
  const helperSource = source.slice(helperStart, helperEnd);
  assert.match(helperSource, /schemaVersion: 2/);
  assert.match(helperSource, /logEntries/);
  assert.match(helperSource, /delete[\s\S]*\.logs/);
  assert.match(helperSource, /delete[\s\S]*\.updatedAt/);
  assert.equal(/stateBefore:\s*params|stateAfter:\s*params/.test(helperSource), false);
});
