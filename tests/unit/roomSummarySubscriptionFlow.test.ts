import assert from 'node:assert/strict';
import test from 'node:test';
import type { User } from 'firebase/auth';
import { applyRoomSummarySnapshot, shouldApplyRoomSummarySnapshot, type RoomSummary, type RoomSummarySnapshotParams } from '../../src/app/flows/roomSummarySubscriptionFlow.js';

const user = (uid: string) => ({ uid }) as User;
const room = (overrides: Partial<RoomSummary> = {}) => ({ id: 'room-1', title: '새 방', hostId: 'host-1', status: 'waiting', maxPlayers: 4, itemMode: true, stackedRollMode: false, playMode: 'individual', pieceCount: 4, ...overrides }) as RoomSummary;

const setup = (overrides: Partial<RoomSummarySnapshotParams> = {}) => {
  const state = { screen: 'waitingRoom' as 'lobby' | 'waitingRoom' | 'game', activeRoomId: 'room-1', title: 'old', hostId: 'old-host', isHost: false, playMode: 'team' as 'individual' | 'team', maxPlayers: 2 as 2 | 3 | 4, itemMode: false, stackedRollMode: true, pieceCount: 2 as 1 | 2 | 3 | 4, pending: true, version: 0, requestId: '', startsAt: 0, endsAt: 0, status: 'idle' as RoomSummary['startStatus'], countdown: 5, initial: true, itemPrompt: 'beforeRoll' as unknown, turnIntro: { active: true } as unknown, endDialog: true, message: '' };
  const params: RoomSummarySnapshotParams = {
    room: room(), subscribedRoomId: 'room-1', currentUser: user('host-1'), userRef: { current: user('host-1') }, hostingRoomUserIdRef: { current: '' }, activeRoomHostIdRef: { current: '' }, pendingStartRequestIdRef: { current: 'request-1' }, startRequestInFlightRef: { current: true }, startRequestVersionRef: { current: 0 }, startRequestIdRef: { current: '' }, startStatusRef: { current: 'idle' }, appliedGameStartKeyRef: { current: '' }, screen: state.screen, winner: '',
    onScreenChange: (v) => { state.screen = v; }, onActiveRoomIdChange: (v) => { state.activeRoomId = v; }, onActiveRoomTitleChange: (v) => { state.title = v; }, onActiveRoomHostIdChange: (v) => { state.hostId = v; }, onRoomHostChange: (v) => { state.isHost = typeof v === 'function' ? v(state.isHost) : v; }, onPlayModeChange: (v) => { state.playMode = v; }, onMaxPlayersChange: (v) => { state.maxPlayers = v; }, onItemModeChange: (v) => { state.itemMode = v; }, onStackedRollModeChange: (v) => { state.stackedRollMode = v; }, onPieceCountChange: (v) => { state.pieceCount = v; }, onStartRequestPendingChange: (v) => { state.pending = v; }, onStartRequestVersionChange: (v) => { state.version = v; }, onStartRequestIdChange: (v) => { state.requestId = v; }, onStartCountdownStartsAtChange: (v) => { state.startsAt = v; }, onStartCountdownEndsAtChange: (v) => { state.endsAt = v; }, onStartStatusChange: (v) => { state.status = v; }, onCountdownChange: (v) => { state.countdown = typeof v === 'function' ? v(state.countdown) : v; }, onInitialGameEntryPendingChange: (v) => { state.initial = v; }, onItemPromptTimingChange: (v) => { state.itemPrompt = v; }, onTurnOrderIntroChange: (v) => { state.turnIntro = v; }, onEndGameDialogOpenChange: (v) => { state.endDialog = v; }, onMessage: (v) => { state.message = v; }, runtime: { now: () => 1000, isRoomInGame: (nextRoom) => nextRoom.status === 'playing' }, ...overrides,
  };
  if (overrides.screen) state.screen = overrides.screen;
  return { params, state };
};

test('구독 callback guard는 이전 room ID snapshot을 차단한다', () => {
  assert.equal(shouldApplyRoomSummarySnapshot({ subscribedRoomId: 'old', currentActiveRoomId: 'new' }), false);
  assert.equal(shouldApplyRoomSummarySnapshot({ subscribedRoomId: 'room-1', currentActiveRoomId: 'room-1' }), true);
});

test('null room은 시작 요청, active room, prompt, intro를 정리하고 기존 메시지로 lobby 이동한다', () => {
  const { params, state } = setup({ room: null });
  applyRoomSummarySnapshot(params);
  assert.equal(params.pendingStartRequestIdRef.current, '');
  assert.equal(params.startRequestInFlightRef.current, false);
  assert.equal(state.pending, false);
  assert.equal(state.screen, 'lobby');
  assert.equal(state.activeRoomId, '');
  assert.equal(state.title, '');
  assert.equal(state.hostId, '');
  assert.equal(state.countdown, -1);
  assert.equal(state.requestId, '');
  assert.equal(params.startRequestIdRef.current, '');
  assert.equal(state.initial, false);
  assert.equal(params.appliedGameStartKeyRef.current, '');
  assert.equal(state.itemPrompt, null);
  assert.equal(state.turnIntro, null);
  assert.equal(state.message, '방이 종료되어 대기실로 이동했습니다.');
});

test('기본 room 정보와 방장 여부를 적용하고 사용자 ID가 없으면 기존 host 상태를 유지한다', () => {
  const { params, state } = setup({ room: room({ title: '타이틀', hostId: 'host-1', playMode: 'team', maxPlayers: 3, itemMode: false, stackedRollMode: true, pieceCount: 3 }) });
  applyRoomSummarySnapshot(params);
  assert.equal(state.title, '타이틀');
  assert.equal(state.hostId, 'host-1');
  assert.equal(params.activeRoomHostIdRef.current, 'host-1');
  assert.equal(state.playMode, 'team');
  assert.equal(state.maxPlayers, 3);
  assert.equal(state.itemMode, false);
  assert.equal(state.stackedRollMode, true);
  assert.equal(state.pieceCount, 3);
  assert.equal(state.isHost, true);
  const unknown = setup({ currentUser: null, userRef: { current: null }, hostingRoomUserIdRef: { current: '' } });
  unknown.state.isHost = true;
  applyRoomSummarySnapshot(unknown.params);
  assert.equal(unknown.state.isHost, true);
});

test('start metadata와 countdown fallback을 적용하고 일치하는 pending request만 완료 처리한다', () => {
  const { params, state } = setup({ room: room({ startRequestVersion: 2, startRequestId: 'request-1', startCountdownStartsAt: 2000, startCountdownUntil: 5000 }) });
  applyRoomSummarySnapshot(params);
  assert.equal(state.status, 'requested');
  assert.equal(state.version, 2);
  assert.equal(state.requestId, 'request-1');
  assert.equal(state.endsAt, 5000);
  assert.equal(state.countdown, -1);
  assert.equal(params.pendingStartRequestIdRef.current, '');
  assert.equal(params.startRequestInFlightRef.current, false);
  const other = setup({ room: room({ startRequestVersion: 2, startRequestId: 'other-request', startStatus: 'requested', startCountdownEndsAt: 5000 }) });
  applyRoomSummarySnapshot(other.params);
  assert.equal(other.params.pendingStartRequestIdRef.current, 'request-1');
  assert.equal(other.params.startRequestInFlightRef.current, true);
});

test('countdown은 시작 후 올림 초와 최소 1을 적용하고 requested가 아니면 닫는다', () => {
  const active = setup({ room: room({ startStatus: 'requested', startCountdownStartsAt: 500, startCountdownEndsAt: 2501 }), runtime: { now: () => 1501, isRoomInGame: () => false } });
  applyRoomSummarySnapshot(active.params);
  assert.equal(active.state.countdown, 1);
  const idle = setup({ room: room({ startStatus: 'idle' }) });
  applyRoomSummarySnapshot(idle.params);
  assert.equal(idle.state.countdown, -1);
});

test('적용된 start key가 일치할 때만 game 화면에 진입한다', () => {
  const waiting = setup({ room: room({ startRequestVersion: 3, startRequestId: 'start-3', startStatus: 'playing' }) });
  applyRoomSummarySnapshot(waiting.params);
  assert.equal(waiting.state.screen, 'waitingRoom');
  const applied = setup({ room: room({ startRequestVersion: 3, startRequestId: 'start-3', startStatus: 'playing' }), appliedGameStartKeyRef: { current: '3:start-3' } });
  applyRoomSummarySnapshot(applied.params);
  assert.equal(applied.state.screen, 'game');
});

test('requested·entering 중에는 waitingRoom 복귀하지 않고 종료 후에는 상태를 정리한다', () => {
  const entering = setup({ room: room({ status: 'waiting', startStatus: 'entering' }), screen: 'game' });
  applyRoomSummarySnapshot(entering.params);
  assert.equal(entering.state.screen, 'game');
  const ended = setup({ room: room({ status: 'waiting', startStatus: 'idle' }), screen: 'game' });
  applyRoomSummarySnapshot(ended.params);
  assert.equal(ended.state.screen, 'waitingRoom');
  assert.equal(ended.state.requestId, '');
  assert.equal(ended.state.itemPrompt, null);
  assert.equal(ended.state.turnIntro, null);
  assert.equal(ended.state.endDialog, false);
  assert.equal(ended.state.message, '게임이 종료되어 방 대기실로 돌아왔습니다.');
  const winner = setup({ room: room({ status: 'waiting', startStatus: 'idle' }), screen: 'game', winner: 'P1 승리' });
  applyRoomSummarySnapshot(winner.params);
  assert.equal(winner.state.screen, 'game');
});

test('finished 방도 문서가 존재하고 인간이 남아 있으면 현재 방과 결과 화면을 유지한다', () => {
  const { params, state } = setup({
    room: room({ status: 'finished', title: '끝난 방', hostId: 'host-2', startStatus: 'playing' }),
    screen: 'game',
    winner: 'P1 승리',
    runtime: { now: () => 1000, isRoomInGame: (nextRoom) => nextRoom.startStatus === 'playing' },
  });
  applyRoomSummarySnapshot(params);
  assert.equal(state.screen, 'game');
  assert.equal(state.activeRoomId, 'room-1');
  assert.equal(state.title, '끝난 방');
  assert.equal(state.hostId, 'host-2');
  assert.equal(params.activeRoomHostIdRef.current, 'host-2');
});
