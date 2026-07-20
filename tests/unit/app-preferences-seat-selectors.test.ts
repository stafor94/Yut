import assert from 'node:assert/strict';
import test from 'node:test';
import { makePieces } from '../../src/app/factories/pieceFactory';
import {
  getStoredBoolean,
  getStoredNumber,
  getStoredText,
  normalizeNickname,
  readStoredBoolean,
  readStoredNumber,
  readStoredText,
  STORAGE_KEYS,
} from '../../src/app/preferences/localPreferences';
import {
  findSeatById,
  getActivePlayerSeats,
  getOccupiedSeats,
  getSeatIndexFromLabel,
} from '../../src/app/selectors/gameViewSelectors';
import {
  createSeats,
  gameSeatSnapshotsFromSeats,
  preserveLockedGameSeats,
  seatsFromGameSeatSnapshots,
  seatsFromRoomPlayers,
  seatsWithJoinedPlayer,
  spectatorsFromRoomPlayers,
} from '../../src/app/selectors/seatSelectors';

const storage = (values: Record<string, string>) => ({
  getItem: (key: string) => values[key] ?? null,
});

test('reads local preferences without requiring a browser global', () => {
  assert.equal(readStoredText(storage({ key: 'value' }), 'key', 'fallback'), 'value');
  assert.equal(readStoredText(storage({}), 'key', 'fallback'), 'fallback');
  assert.equal(readStoredBoolean(storage({ enabled: 'true' }), 'enabled', false), true);
  assert.equal(readStoredBoolean(storage({ enabled: 'false' }), 'enabled', true), false);
  assert.equal(readStoredBoolean(storage({ enabled: 'invalid' }), 'enabled', true), false);
  assert.equal(readStoredNumber(storage({ count: '3' }), 'count', 4, [2, 3, 4] as const), 3);
  assert.equal(readStoredNumber(storage({ count: '5' }), 'count', 4, [2, 3, 4] as const), 4);
  assert.equal(getStoredText('missing', 'fallback'), 'fallback');
  assert.equal(getStoredBoolean('missing', true), true);
  assert.equal(getStoredNumber('missing', 4, [2, 3, 4] as const), 4);
  assert.equal(normalizeNickname('123456789'), '1234567');
  assert.equal(STORAGE_KEYS.activeRoomId, 'yut-online:activeRoomId');
});

test('creates individual and team seats with canonical app types', () => {
  const individual = createSeats('방장', 'individual', 3);
  assert.deepEqual(individual.map((seat) => seat.team), ['청팀', '청팀', '청팀']);
  assert.equal(individual[0].name, '방장');
  assert.equal(individual[0].isHost, true);
  assert.equal(individual[1].isEmpty, true);

  const team = createSeats('방장', 'team', 4);
  assert.deepEqual(team.map((seat) => seat.team), ['청팀', '홍팀', '청팀', '홍팀']);
});

test('hydrates room players while ignoring spectators and preserving control metadata', () => {
  const seats = seatsFromRoomPlayers([
    {
      id: 'host-id',
      nickname: '방장',
      color: 'red',
      ready: true,
      seatIndex: 0,
      team: '청팀',
      enteredGameAt: 100,
      enteredStartVersion: 3,
    },
    {
      id: 'guest-id',
      nickname: '참가자',
      color: 'blue',
      ready: false,
      seatIndex: 1,
      team: '홍팀',
      isSubstitutedByAI: true,
    },
    {
      id: 'spectator-id',
      nickname: '관전자',
      color: 'green',
      ready: true,
      seatIndex: 2,
      team: '청팀',
      isSpectator: true,
    },
  ], 'team', 3, 'host-id');

  assert.equal(seats[0].isHost, true);
  assert.equal(seats[0].enteredGameAt, 100);
  assert.equal(seats[1].name, '참가자');
  assert.equal(seats[1].color, '파랑');
  assert.equal(seats[1].isSubstitutedByAI, true);
  assert.equal(seats[2].isEmpty, true);
});

test('adds a joined player only when the player is not already present', () => {
  const joined = seatsWithJoinedPlayer([], 'new-user', '새 참가자', 'individual', 3, 2);
  assert.equal(joined[2].id, 'new-user');
  assert.equal(joined[2].name, '새 참가자');
  assert.equal(joined[2].ready, false);
  assert.equal(joined[2].isEmpty, false);

  const existingPlayers = [
    { id: 'existing', nickname: '기존', color: 'red', ready: true, seatIndex: 0, team: '청팀' as const },
  ];
  const existing = seatsWithJoinedPlayer(existingPlayers, 'existing', '변경 안 됨', 'individual', 2);
  assert.equal(existing[0].name, '기존');
});

test('maps spectators and round-trips locked game seat snapshots', () => {
  const spectators = spectatorsFromRoomPlayers([
    { id: 'watcher', nickname: '관전자', color: 'green', ready: true, seatIndex: 2, team: '청팀', isSpectator: true },
  ]);
  assert.deepEqual(spectators, [{
    id: 'watcher',
    label: '관전',
    name: '관전자',
    color: '관전',
    ready: true,
    isSpectator: true,
    team: '청팀',
  }]);

  const seats = createSeats('방장', 'team', 2).map((seat, index) => ({
    ...seat,
    id: `seat-${index + 1}`,
    name: `플레이어${index + 1}`,
    isEmpty: false,
    isAI: index === 1,
  }));
  const snapshots = gameSeatSnapshotsFromSeats(seats);
  assert.deepEqual(snapshots.map((seat) => seat.seatIndex), [0, 1]);

  const restored = seatsFromGameSeatSnapshots(snapshots, 'team', 2);
  assert.deepEqual(restored.map((seat) => seat.id), ['seat-1', 'seat-2']);
  assert.equal(restored[1].isAI, true);
});

test('preserves occupied locked seats when a later room snapshot is temporarily empty', () => {
  const current = createSeats('방장', 'individual', 2);
  current[1] = { ...current[1], id: 'seat-2', name: '참가자', ready: true, isEmpty: false };
  const incoming = createSeats('', 'individual', 2);
  const preserved = preserveLockedGameSeats(current, incoming);

  assert.equal(preserved[1].id, 'seat-2');
  assert.equal(preserved[1].isEmpty, false);
  assert.equal(preserved[1].ready, true);
});

test('provides reusable pure selectors for occupied and active player seats', () => {
  const seats = [
    { ...createSeats('방장', 'individual', 2)[0], id: 'host-id', isEmpty: false },
    { ...createSeats('', 'individual', 2)[1], id: 'guest-id', name: '참가자', isEmpty: false },
    { id: 'watcher', label: '관전', name: '관전자', color: '관전', ready: true, isSpectator: true, team: '청팀' as const },
  ];

  assert.deepEqual(getOccupiedSeats(seats).map((seat) => seat.id), ['host-id', 'guest-id', 'watcher']);
  assert.deepEqual(getActivePlayerSeats(seats).map((seat) => seat.id), ['host-id', 'guest-id']);
  assert.equal(findSeatById(seats, 'guest-id')?.name, '참가자');
  assert.equal(getSeatIndexFromLabel('P4'), 3);
});

test('creates individual and team pieces with stable owner and color contracts', () => {
  const individualSeats = createSeats('방장', 'individual', 2).map((seat, index) => ({
    ...seat,
    id: `seat-${index + 1}`,
    isEmpty: false,
  }));
  const individualPieces = makePieces(individualSeats, 2);
  assert.equal(individualPieces.length, 4);
  assert.deepEqual(individualPieces.map((piece) => piece.ownerId), ['seat-1', 'seat-1', 'seat-2', 'seat-2']);
  assert.deepEqual(individualPieces.map((piece) => piece.nodeId), ['n01', 'n01', 'n01', 'n01']);

  const teamSeats = createSeats('방장', 'team', 4).map((seat, index) => ({
    ...seat,
    id: `seat-${index + 1}`,
    isEmpty: false,
  }));
  const teamPieces = makePieces(teamSeats, 2, 'team');
  assert.equal(teamPieces.length, 4);
  assert.deepEqual(teamPieces.map((piece) => piece.ownerId), ['seat-1', 'seat-3', 'seat-2', 'seat-4']);
  assert.deepEqual(teamPieces.map((piece) => piece.label), ['청-1', '청-2', '홍-1', '홍-2']);
});
