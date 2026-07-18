import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeNickname,
  readStoredBoolean,
  readStoredNumber,
  readStoredText,
  STORAGE_KEYS,
} from '../../src/app/preferences/localPreferences';
import {
  createSeats,
  gameSeatSnapshotsFromSeats,
  preserveLockedGameSeats,
  seatsFromRoomPlayers,
} from '../../src/app/selectors/seatModel';

const storage = (values: Record<string, string>) => ({
  getItem: (key: string) => values[key] ?? null,
});

test('reads local preferences with fallback and allowed-value validation', () => {
  assert.equal(readStoredText(storage({ key: 'value' }), 'key', 'fallback'), 'value');
  assert.equal(readStoredText(storage({}), 'key', 'fallback'), 'fallback');
  assert.equal(readStoredBoolean(storage({ enabled: 'true' }), 'enabled', false), true);
  assert.equal(readStoredBoolean(storage({ enabled: 'invalid' }), 'enabled', true), false);
  assert.equal(readStoredNumber(storage({ count: '3' }), 'count', 4, [2, 3, 4] as const), 3);
  assert.equal(readStoredNumber(storage({ count: '5' }), 'count', 4, [2, 3, 4] as const), 4);
  assert.equal(normalizeNickname(' 123456789 '), '1234567');
  assert.equal(STORAGE_KEYS.activeRoomId, 'yut-online:activeRoomId');
});

test('preserves locked seats while hydrating room snapshots', () => {
  const current = createSeats('방장', 'individual', 2);
  current[1] = { ...current[1], id: 'seat-2', name: '참가자', ready: true, isEmpty: false };
  const incoming = createSeats('', 'individual', 2);
  const preserved = preserveLockedGameSeats(current, incoming);

  assert.equal(preserved[1].id, 'seat-2');
  assert.equal(preserved[1].isEmpty, false);
  assert.deepEqual(gameSeatSnapshotsFromSeats(preserved).map((seat) => seat.id), ['host', 'seat-2']);

  const hydrated = seatsFromRoomPlayers([
    { id: 'host-id', nickname: '방장', color: 'red', ready: true, seatIndex: 0, team: '청팀' },
    { id: 'guest-id', nickname: '참가자', color: 'blue', ready: false, seatIndex: 1, team: '청팀' },
  ], 'individual', 2, 'host-id');

  assert.equal(hydrated[0].isHost, true);
  assert.equal(hydrated[1].name, '참가자');
});
