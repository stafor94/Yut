import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createSeats,
  gameSeatSnapshotsFromSeats,
  makePieces,
  preserveLockedGameSeats,
  seatsFromGameSeatSnapshots,
  seatsFromRoomPlayers,
  spectatorsFromRoomPlayers,
} from '../../src/app/selectors/seatSelectors';
import { selectHostSeat, selectPlayableSeats } from '../../src/app/selectors/gameViewSelectors';

test('좌석 생성은 개인전과 팀전 기본 팀 배치를 유지한다', () => {
  const individualSeats = createSeats('호스트', 'individual', 3);
  const teamSeats = createSeats('호스트', 'team', 4);

  assert.deepEqual(individualSeats.map((seat) => seat.team), ['청팀', '청팀', '청팀']);
  assert.deepEqual(teamSeats.map((seat) => seat.team), ['청팀', '홍팀', '청팀', '홍팀']);
  assert.equal(individualSeats[0].name, '호스트');
  assert.equal(individualSeats[1].isEmpty, true);
});

test('RoomPlayer 목록은 좌석과 관전자로 분리 변환된다', () => {
  const players = [
    { id: 'host-1', nickname: '방장', color: 'red', ready: true, seatIndex: 0, isSpectator: false, team: '청팀' },
    { id: 'guest-1', nickname: '손님', color: 'blue', ready: false, seatIndex: 1, isSpectator: false, team: '홍팀' },
    { id: 'viewer-1', nickname: '관전자', color: 'gray', ready: true, seatIndex: -1, isSpectator: true, team: '청팀' },
  ] as const;

  const seats = seatsFromRoomPlayers(players, 'team', 4, 'host-1');
  const spectators = spectatorsFromRoomPlayers(players);

  assert.equal(seats[0].id, 'host-1');
  assert.equal(seats[0].isHost, true);
  assert.equal(seats[0].color, '빨강');
  assert.equal(seats[1].team, '홍팀');
  assert.equal(seats[2].isHost, false);
  assert.deepEqual(spectators.map((seat) => [seat.id, seat.label, seat.isSpectator]), [['viewer-1', '관전', true]]);
});

test('게임 좌석 snapshot 변환과 잠긴 게임 좌석 보존 규칙을 유지한다', () => {
  const currentSeats = createSeats('방장', 'individual', 2).map((seat, index) => index === 1 ? { ...seat, id: 'guest', name: '손님', isEmpty: false } : seat);
  const snapshots = gameSeatSnapshotsFromSeats(currentSeats);
  const restoredSeats = seatsFromGameSeatSnapshots(snapshots, 'individual', 2);
  const nextSeats = createSeats('', 'individual', 2);
  const preservedSeats = preserveLockedGameSeats(restoredSeats, nextSeats);

  assert.deepEqual(snapshots.map((seat) => seat.seatIndex), [0, 1]);
  assert.equal(restoredSeats[1].id, 'guest');
  assert.equal(preservedSeats[1].id, 'guest');
  assert.equal(preservedSeats[1].isEmpty, false);
});

test('말 초기 생성과 표시용 selector는 빈 좌석과 관전자를 제외한다', () => {
  const seats = [
    ...createSeats('방장', 'individual', 2),
    { id: 'viewer', label: '관전', name: '관전자', color: '관전', ready: true, isSpectator: true, team: '청팀' as const },
  ];
  const playableSeats = selectPlayableSeats(seats);
  const pieces = makePieces(playableSeats, 2, 'individual');

  assert.equal(playableSeats.length, 1);
  assert.equal(selectHostSeat(playableSeats)?.id, 'host');
  assert.deepEqual(pieces.map((piece) => piece.id), ['host-piece-1', 'host-piece-2']);
});
