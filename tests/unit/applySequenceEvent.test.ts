import assert from 'node:assert/strict';
import test from 'node:test';
import { applySequenceEvent, applySequenceEvents } from '../../src/app/hooks/applySequenceEvent.js';
type GameSequence = { id: string; sequence: number; type: string; actorId: string; payload?: Record<string, unknown>; schemaVersion?: 1 | 2; eventSchemaVersion?: number; patch?: Record<string, unknown> | null; logEntries?: unknown[]; stateAfter?: Record<string, unknown> | null };
type SyncedGameState = Record<string, unknown> & { logs: unknown[]; lastSequence?: number; turnVersion?: number };
type SequenceStateSnapshot = Record<string, unknown> & { logs?: unknown[]; lastSequence?: number; turnIndex?: number };

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
  const stateAfter = baseState({ turnIndex: 1, lastSequence: 2, logs: [{ id: 2, text: '새 로그' }] });
  const result = applySequenceEvent(baseState() as any, sequence({ sequence: 2, eventSchemaVersion: 1, stateAfter }));
  assert.equal(result?.turnIndex, 1);
  assert.deepEqual(result?.logs, [{ id: 2, text: '새 로그' }]);
  assert.equal(result?.lastSequence, 2);
});

test('v2 sequence는 patch와 logEntries를 직전 state에 적용하고 중복 sequence는 무시한다', () => {
  const before = baseState();
  const event = sequence({
    sequence: 2,
    schemaVersion: 2,
    patch: { turnIndex: 1, pieces: [{ id: 'p1', nodeId: 'n2' }] },
    logEntries: [{ id: 2, text: '새 로그' }],
  });
  const result = applySequenceEvent(before as any, event);
  assert.equal(result?.turnIndex, 1);
  assert.deepEqual(result?.pieces, [{ id: 'p1', nodeId: 'n2' }]);
  assert.deepEqual(result?.logs, [{ id: 2, text: '새 로그' }, { id: 1, text: '기존 로그' }]);
  assert.equal(applySequenceEvent(result as any, event), result);
});

test('sequence gap이나 기준 state 부재 시 v2 patch를 임의 적용하지 않는다', () => {
  assert.equal(applySequenceEvent(null, sequence({ sequence: 2, schemaVersion: 2, patch: { turnIndex: 1 } })), null);
  assert.equal(applySequenceEvent(baseState({ lastSequence: 0 }) as any, sequence({ sequence: 2, schemaVersion: 2, patch: { turnIndex: 1 } })), null);
});

test('200개 연속 v2 event 적용 결과가 각 authoritative after-state와 동일하다', () => {
  let before: SequenceStateSnapshot = baseState() as any;
  const events: GameSequence[] = [];
  for (let index = 0; index < 200; index += 1) {
    const after = { ...before, turnIndex: index + 1, lastSequence: index + 2, logs: [{ id: index + 2, text: `로그 ${index + 2}` }, ...(before.logs ?? [])].slice(0, 200) };
    events.push(sequence({ sequence: index + 2, schemaVersion: 2, patch: { turnIndex: after.turnIndex }, logEntries: [{ id: index + 2, text: `로그 ${index + 2}` }] }));
    before = after;
    const replayed = applySequenceEvents(baseState() as any, events);
    assert.deepEqual(replayed, after);
  }
});

test('신규 sequence writer는 v2 schemaVersion을 쓰고 stateBefore/stateAfter를 저장하지 않는 compact helper를 사용한다', async () => {
  const source = await import('node:fs/promises').then((fs) => fs.readFile('src/features/room/services/roomService.ts', 'utf8'));
  const helperStart = source.indexOf('export const makeSequenceEventFields');
  const helperEnd = source.indexOf('const isTurnOrderIntroActive', helperStart);
  const helperSource = source.slice(helperStart, helperEnd);
  assert.match(helperSource, /schemaVersion: 2/);
  assert.match(helperSource, /logEntries/);
  assert.match(helperSource, /delete[\s\S]*\.logs/);
  assert.match(helperSource, /delete[\s\S]*\.updatedAt/);
  assert.equal(/stateBefore:\s*params|stateAfter:\s*params/.test(helperSource), false);
});
