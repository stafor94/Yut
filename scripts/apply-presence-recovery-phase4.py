from pathlib import Path

app_path = Path('src/app/App.tsx')
app = app_path.read_text()

service_import_old = "claimRoomHostIfMissing, commitAuthoritativeGameAction, completeTurnOrderIntro, createRoom, deleteRoom, getGameSequencesSince, getLatestGameState, getProcessedGameAction, getRoom, initializeGameState, isRoomInGame, joinRoom, leaveDuplicatePlayerRooms, removeRoomPlayer, requestRoomGameStart, resolveTurnOrderIntro, scheduleEmptyRoomDeletion, subscribeRoom, subscribeRoomPlayers, updateRoomOptions, updateRoomPlayer, updateRoomStatus"
service_import_new = "claimRoomHostIfMissing, commitAuthoritativeGameAction, completeTurnOrderIntro, createRoom, deleteRoom, getGameSequencesSince, getLatestGameState, getProcessedGameAction, getRoom, initializeGameState, isRoomInGame, joinRoom, leaveDuplicatePlayerRooms, removeRoomPlayer, requestRoomGameStart, resolveTurnOrderIntro, scheduleEmptyRoomDeletion, subscribeRoom, subscribeRoomPlayers, updateRoomOptions, updateRoomStatus"
assert app.count(service_import_old) == 1, app.count(service_import_old)
app = app.replace(service_import_old, service_import_new)

flow_import_anchor = "import { getHumanSeatsWaitingForGameEntry, getOnlineGameCoordinatorSeatId, haveAllHumanSeatsEnteredGame } from './flows/onlineGameCoordinator';\n"
flow_import = "import { getPresenceRecoveryKey, isPresenceRestoreAttemptCurrent } from './flows/presenceRecovery';\n"
assert app.count(flow_import_anchor) == 1
app = app.replace(flow_import_anchor, flow_import_anchor + flow_import)

ref_anchor = "  const presenceRestoreKeyRef = useRef('');\n"
ref_new = ref_anchor + "  const presenceRestoreAttemptRef = useRef(0);\n"
assert app.count(ref_anchor) == 1
app = app.replace(ref_anchor, ref_new)

reset_anchor = "    enteredGamePresenceKeyRef.current = '';\n"
reset_new = reset_anchor + "    presenceRestoreAttemptRef.current += 1;\n    presenceRestoreKeyRef.current = '';\n"
assert app.count(reset_anchor) == 1
app = app.replace(reset_anchor, reset_new)

startup_old = """        const restoredAsHost = storedRoom.hostId === currentUser.uid;
        const restoredMaxPlayers = storedRoom.maxPlayers as 2 | 3 | 4;
        const joinResult = restoredAsHost ? null : await joinRoom(storedRoom.id, { userId: currentUser.uid, nickname, playMode: storedRoom.playMode });
        if (restoredAsHost) {
          await updateRoomPlayer(storedRoom.id, currentUser.uid, { nickname, ready: true, color: 'red', seatIndex: 0, team: '청팀', isSpectator: false });
        }
        if (cancelled) return;
"""
startup_new = """        const restoredAsHost = storedRoom.hostId === currentUser.uid;
        const restoredMaxPlayers = storedRoom.maxPlayers as 2 | 3 | 4;
        const joinResult = await joinRoom(storedRoom.id, { userId: currentUser.uid, nickname, playMode: storedRoom.playMode });
        if (cancelled || userRef.current?.uid !== currentUser.uid) return;
"""
assert app.count(startup_old) == 1, app.count(startup_old)
app = app.replace(startup_old, startup_new)

startup_role_old = """        if (joinResult?.role === 'player') {
          setSeats(seatsWithJoinedPlayer([], currentUser.uid, nickname, storedRoom.playMode, restoredMaxPlayers, joinResult.seatIndex));
        } else if (restoredAsHost) {
          setSeats(createSeats(nickname, storedRoom.playMode, restoredMaxPlayers).map((seat) => seat.isHost ? { ...seat, id: currentUser.uid } : seat));
        }
"""
startup_role_new = """        if (joinResult.role === 'player') {
          setSeats(seatsWithJoinedPlayer([], currentUser.uid, nickname, storedRoom.playMode, restoredMaxPlayers, joinResult.seatIndex));
        } else if (restoredAsHost) {
          setSeats(createSeats(nickname, storedRoom.playMode, restoredMaxPlayers).map((seat) => seat.isHost ? { ...seat, id: currentUser.uid } : seat));
        }
"""
assert app.count(startup_role_old) == 1
app = app.replace(startup_role_old, startup_role_new)

restore_old = """      const substitutedLocalPlayer = localPresencePlayer && localPresencePlayer.isAI && localPresencePlayer.isSubstitutedByAI && !localPresencePlayer.isSpectator ? localPresencePlayer : undefined;
      if (substitutedLocalPlayer && activeRoomId && screen === 'game' && !leavingRoomRef.current) {
        const restoreKey = `${activeRoomId}:${currentUserId}:${substitutedLocalPlayer.seatIndex}`;
        if (presenceRestoreKeyRef.current !== restoreKey) {
          presenceRestoreKeyRef.current = restoreKey;
          void joinRoom(activeRoomId, { userId: currentUserId!, nickname: substitutedLocalPlayer.nickname || nickname, playMode })
            .then((result) => {
              if (result.role !== 'player') {
                presenceRestoreKeyRef.current = '';
                return;
              }
              setMessage('연결이 복구되어 원래 좌석으로 다시 참여했습니다.');
            })
            .catch(() => { presenceRestoreKeyRef.current = ''; });
        }
      } else if (!substitutedLocalPlayer) {
        presenceRestoreKeyRef.current = '';
      }
"""
restore_new = """      const substitutedLocalPlayer = localPresencePlayer && localPresencePlayer.isAI && localPresencePlayer.isSubstitutedByAI && !localPresencePlayer.isSpectator ? localPresencePlayer : undefined;
      if (substitutedLocalPlayer && activeRoomId && currentUserId && screen === 'game' && !leavingRoomRef.current) {
        const presenceVersion = Number(substitutedLocalPlayer.presenceVersion ?? 0);
        const restoreKey = getPresenceRecoveryKey(activeRoomId, currentUserId, substitutedLocalPlayer.seatIndex, presenceVersion);
        if (presenceRestoreKeyRef.current !== restoreKey) {
          const restoreAttempt = presenceRestoreAttemptRef.current + 1;
          presenceRestoreAttemptRef.current = restoreAttempt;
          presenceRestoreKeyRef.current = restoreKey;
          const restoreRoomId = activeRoomId;
          const restoreUserId = currentUserId;
          void joinRoom(restoreRoomId, {
            userId: restoreUserId,
            nickname: substitutedLocalPlayer.nickname || nickname,
            playMode,
            expectedPresenceVersion: presenceVersion,
          })
            .then((result) => {
              const attemptIsCurrent = isPresenceRestoreAttemptCurrent({
                attempt: restoreAttempt,
                currentAttempt: presenceRestoreAttemptRef.current,
                restoreKey,
                currentRestoreKey: presenceRestoreKeyRef.current,
                roomId: restoreRoomId,
                currentRoomId: activeRoomIdRef.current,
                userId: restoreUserId,
                currentUserId: userRef.current?.uid ?? '',
              });
              if (!attemptIsCurrent) return;
              if (result.role === 'stale') {
                presenceRestoreKeyRef.current = '';
                setMessage('연결 상태가 갱신되어 최신 좌석 상태를 다시 확인하고 있습니다.');
                return;
              }
              if (result.role !== 'player') {
                presenceRestoreKeyRef.current = '';
                return;
              }
              setMessage('연결이 복구되어 원래 좌석으로 다시 참여했습니다.');
            })
            .catch(() => {
              if (presenceRestoreAttemptRef.current === restoreAttempt && presenceRestoreKeyRef.current === restoreKey) presenceRestoreKeyRef.current = '';
            });
        }
      } else if (!substitutedLocalPlayer) {
        presenceRestoreAttemptRef.current += 1;
        presenceRestoreKeyRef.current = '';
      }
"""
assert app.count(restore_old) == 1, app.count(restore_old)
app = app.replace(restore_old, restore_new)

app_path.write_text(app)

service_path = Path('src/features/room/services/roomService.ts')
service = service_path.read_text()

player_interface_old = "export interface RoomPlayer { id: string; nickname: string; ready: boolean; color: string; seatIndex: number; team: '청팀' | '홍팀'; isAI?: boolean; isSubstitutedByAI?: boolean; isSpectator?: boolean; joinedAt?: unknown; lastSeen?: unknown; enteredGameAt?: number; enteredStartVersion?: number; lastGamePresenceAt?: number; playerId?: string; currentPlayerId?: string; originalPlayerId?: string; }"
player_interface_new = "export interface RoomPlayer { id: string; nickname: string; ready: boolean; color: string; seatIndex: number; team: '청팀' | '홍팀'; isAI?: boolean; isSubstitutedByAI?: boolean; isSpectator?: boolean; joinedAt?: unknown; lastSeen?: unknown; enteredGameAt?: number; enteredStartVersion?: number; lastGamePresenceAt?: number; playerId?: string; currentPlayerId?: string; originalPlayerId?: string; presenceVersion?: number; presenceUpdatedAt?: unknown; }"
assert service.count(player_interface_old) == 1
service = service.replace(player_interface_old, player_interface_new)

seat_interface_old = "export interface RoomSeat { id: string; playerId: string; originalPlayerId?: string; currentPlayerId?: string; nickname?: string; color?: string; team?: RoomPlayer['team']; seatIndex?: number; label?: string; isHost?: boolean; aiActive?: boolean; aiName?: string; isSubstitutedByAI?: boolean; status?: 'human' | 'ai_substitute' | 'disconnected' | 'removed'; updatedAt?: unknown; createdAt?: unknown; }"
seat_interface_new = "export interface RoomSeat { id: string; playerId: string; originalPlayerId?: string; currentPlayerId?: string; nickname?: string; color?: string; team?: RoomPlayer['team']; seatIndex?: number; label?: string; isHost?: boolean; aiActive?: boolean; aiName?: string; isSubstitutedByAI?: boolean; status?: 'human' | 'ai_substitute' | 'disconnected' | 'removed'; presenceVersion?: number; presenceUpdatedAt?: unknown; updatedAt?: unknown; createdAt?: unknown; }"
assert service.count(seat_interface_old) == 1
service = service.replace(seat_interface_old, seat_interface_new)

result_old = "export type JoinRoomResult = { role: 'player' | 'spectator'; seatIndex: number | null };"
result_new = "export type JoinRoomResult = { role: 'player' | 'spectator' | 'stale'; seatIndex: number | null };"
assert service.count(result_old) == 1
service = service.replace(result_old, result_new)

params_old = "export async function joinRoom(roomId: string, params: { userId: string; nickname: string; playMode: 'individual'|'team'; }): Promise<JoinRoomResult> {"
params_new = "export async function joinRoom(roomId: string, params: { userId: string; nickname: string; playMode: 'individual'|'team'; expectedPresenceVersion?: number; }): Promise<JoinRoomResult> {"
assert service.count(params_old) == 1
service = service.replace(params_old, params_new)

existing_restore_old = """      if (hasValidActiveSeat) {
        const restoredTeam = existingData.team ?? (params.playMode === 'team' ? TEAMS[restoreSeatIndex] : '청팀');
        const restoredColor = existingData.color ?? COLORS[restoreSeatIndex] ?? 'black';
        const restoredNickname = existingData.isSubstitutedByAI ? (existingData.nickname || params.nickname) : params.nickname;
        transaction.set(playerRef, { nickname: restoredNickname, ready: true, color: restoredColor, seatIndex: restoreSeatIndex, team: restoredTeam, isAI: false, isSubstitutedByAI: false, isSpectator: false, lastSeen: serverTimestamp() }, { merge: true });
        transaction.set(seatRefs[restoreSeatIndex], { playerId: params.userId, originalPlayerId: params.userId, currentPlayerId: params.userId, nickname: restoredNickname, color: restoredColor, team: restoredTeam, seatIndex: restoreSeatIndex, label: `P${restoreSeatIndex + 1}`, aiActive: false, aiName: '', isSubstitutedByAI: false, status: 'human', updatedAt: serverTimestamp() }, { merge: true });
        transaction.set(roomRef, { emptySince: null }, { merge: true });
        return { role: 'player', seatIndex: restoreSeatIndex };
      }
"""
existing_restore_new = """      if (hasValidActiveSeat) {
        const lockedSeat = seatSnapshots[restoreSeatIndex].exists() ? seatSnapshots[restoreSeatIndex].data() as RoomSeat : null;
        const currentPresenceVersion = Math.max(Number(existingData.presenceVersion ?? 0), Number(lockedSeat?.presenceVersion ?? 0));
        if (params.expectedPresenceVersion !== undefined && params.expectedPresenceVersion !== currentPresenceVersion) return { role: 'stale', seatIndex: null };
        const nextPresenceVersion = currentPresenceVersion + 1;
        const restoredTeam = existingData.team ?? (params.playMode === 'team' ? TEAMS[restoreSeatIndex] : '청팀');
        const restoredColor = existingData.color ?? COLORS[restoreSeatIndex] ?? 'black';
        const restoredNickname = existingData.isSubstitutedByAI ? (existingData.nickname || params.nickname) : params.nickname;
        transaction.set(playerRef, { nickname: restoredNickname, ready: true, color: restoredColor, seatIndex: restoreSeatIndex, team: restoredTeam, isAI: false, isSubstitutedByAI: false, isSpectator: false, presenceVersion: nextPresenceVersion, presenceUpdatedAt: serverTimestamp(), lastSeen: serverTimestamp() }, { merge: true });
        transaction.set(seatRefs[restoreSeatIndex], { playerId: params.userId, originalPlayerId: params.userId, currentPlayerId: params.userId, nickname: restoredNickname, color: restoredColor, team: restoredTeam, seatIndex: restoreSeatIndex, label: `P${restoreSeatIndex + 1}`, aiActive: false, aiName: '', isSubstitutedByAI: false, status: 'human', presenceVersion: nextPresenceVersion, presenceUpdatedAt: serverTimestamp(), updatedAt: serverTimestamp() }, { merge: true });
        transaction.set(roomRef, { emptySince: null }, { merge: true });
        return { role: 'player', seatIndex: restoreSeatIndex };
      }
"""
assert service.count(existing_restore_old) == 1, service.count(existing_restore_old)
service = service.replace(existing_restore_old, existing_restore_new)

locked_restore_old = """    if (matchingLockedSeatIndex >= 0) {
      const lockedSeat = seatSnapshots[matchingLockedSeatIndex].data() as RoomSeat;
      const restoredTeam = lockedSeat.team ?? (params.playMode === 'team' ? TEAMS[matchingLockedSeatIndex] : '청팀');
      const restoredColor = lockedSeat.color ?? COLORS[matchingLockedSeatIndex] ?? 'black';
      const restoredNickname = lockedSeat.isSubstitutedByAI ? (lockedSeat.nickname || params.nickname) : params.nickname;
      transaction.set(playerRef, { nickname: restoredNickname, ready: true, color: restoredColor, seatIndex: matchingLockedSeatIndex, team: restoredTeam, isAI: false, isSubstitutedByAI: false, isSpectator: false, joinedAt: serverTimestamp(), lastSeen: serverTimestamp() }, { merge: true });
      transaction.set(seatRefs[matchingLockedSeatIndex], { playerId: params.userId, originalPlayerId: params.userId, currentPlayerId: params.userId, nickname: restoredNickname, color: restoredColor, team: restoredTeam, seatIndex: matchingLockedSeatIndex, label: `P${matchingLockedSeatIndex + 1}`, aiActive: false, aiName: '', isSubstitutedByAI: false, status: 'human', updatedAt: serverTimestamp() }, { merge: true });
      transaction.set(roomRef, { emptySince: null, currentPlayers }, { merge: true });
      return { role: 'player', seatIndex: matchingLockedSeatIndex };
    }
"""
locked_restore_new = """    if (matchingLockedSeatIndex >= 0) {
      const lockedSeat = seatSnapshots[matchingLockedSeatIndex].data() as RoomSeat;
      const currentPresenceVersion = Number(lockedSeat.presenceVersion ?? 0);
      if (params.expectedPresenceVersion !== undefined && params.expectedPresenceVersion !== currentPresenceVersion) return { role: 'stale', seatIndex: null };
      const nextPresenceVersion = currentPresenceVersion + 1;
      const restoredTeam = lockedSeat.team ?? (params.playMode === 'team' ? TEAMS[matchingLockedSeatIndex] : '청팀');
      const restoredColor = lockedSeat.color ?? COLORS[matchingLockedSeatIndex] ?? 'black';
      const restoredNickname = lockedSeat.isSubstitutedByAI ? (lockedSeat.nickname || params.nickname) : params.nickname;
      transaction.set(playerRef, { nickname: restoredNickname, ready: true, color: restoredColor, seatIndex: matchingLockedSeatIndex, team: restoredTeam, isAI: false, isSubstitutedByAI: false, isSpectator: false, presenceVersion: nextPresenceVersion, presenceUpdatedAt: serverTimestamp(), joinedAt: serverTimestamp(), lastSeen: serverTimestamp() }, { merge: true });
      transaction.set(seatRefs[matchingLockedSeatIndex], { playerId: params.userId, originalPlayerId: params.userId, currentPlayerId: params.userId, nickname: restoredNickname, color: restoredColor, team: restoredTeam, seatIndex: matchingLockedSeatIndex, label: `P${matchingLockedSeatIndex + 1}`, aiActive: false, aiName: '', isSubstitutedByAI: false, status: 'human', presenceVersion: nextPresenceVersion, presenceUpdatedAt: serverTimestamp(), updatedAt: serverTimestamp() }, { merge: true });
      transaction.set(roomRef, { emptySince: null, currentPlayers }, { merge: true });
      return { role: 'player', seatIndex: matchingLockedSeatIndex };
    }
"""
assert service.count(locked_restore_old) == 1
service = service.replace(locked_restore_old, locked_restore_new)

substitute_anchor = """    const seatIndex = Number(player.seatIndex);
    const hasSeat = Number.isInteger(seatIndex) && seatIndex >= 0;
    if (action === 'substitute_ai' && hasSeat) {
"""
substitute_new = """    const seatIndex = Number(player.seatIndex);
    const hasSeat = Number.isInteger(seatIndex) && seatIndex >= 0;
    const nextPresenceVersion = Number(player.presenceVersion ?? 0) + 1;
    if (action === 'substitute_ai' && hasSeat) {
"""
assert service.count(substitute_anchor) == 1
service = service.replace(substitute_anchor, substitute_new)

sub_player_old = """        isSubstitutedByAI: true,
        isSpectator: false,
        lastSeen: serverTimestamp(),
"""
sub_player_new = """        isSubstitutedByAI: true,
        isSpectator: false,
        presenceVersion: nextPresenceVersion,
        presenceUpdatedAt: serverTimestamp(),
        lastSeen: serverTimestamp(),
"""
assert service.count(sub_player_old) == 1
service = service.replace(sub_player_old, sub_player_new)

sub_seat_old = """        isSubstitutedByAI: true,
        status: 'ai_substitute',
        updatedAt: serverTimestamp(),
"""
sub_seat_new = """        isSubstitutedByAI: true,
        status: 'ai_substitute',
        presenceVersion: nextPresenceVersion,
        presenceUpdatedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
"""
assert service.count(sub_seat_old) == 1
service = service.replace(sub_seat_old, sub_seat_new)

disconnected_old = """        isSubstitutedByAI: false,
        status: 'disconnected',
        updatedAt: serverTimestamp(),
"""
disconnected_new = """        isSubstitutedByAI: false,
        status: 'disconnected',
        presenceVersion: nextPresenceVersion,
        presenceUpdatedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
"""
assert service.count(disconnected_old) == 1
service = service.replace(disconnected_old, disconnected_new)

service_path.write_text(service)

flow_path = Path('src/app/flows/presenceRecovery.ts')
flow_path.write_text("""export type PresenceRestoreAttemptContext = {
  attempt: number;
  currentAttempt: number;
  restoreKey: string;
  currentRestoreKey: string;
  roomId: string;
  currentRoomId: string;
  userId: string;
  currentUserId: string;
};

export const getPresenceRecoveryKey = (roomId: string, userId: string, seatIndex: number, presenceVersion: number) =>
  `${roomId}:${userId}:${seatIndex}:${presenceVersion}`;

export const isPresenceRestoreAttemptCurrent = (context: PresenceRestoreAttemptContext) => (
  context.attempt === context.currentAttempt
  && context.restoreKey === context.currentRestoreKey
  && context.roomId === context.currentRoomId
  && context.userId === context.currentUserId
);
""")

test_path = Path('tests/unit/presenceRecovery.test.ts')
test_path.write_text("""import assert from 'node:assert/strict';
import test from 'node:test';
import { getPresenceRecoveryKey, isPresenceRestoreAttemptCurrent } from '../../src/app/flows/presenceRecovery.js';

test('AI 대체 세대가 달라지면 재접속 복구 key도 달라진다', () => {
  assert.notEqual(
    getPresenceRecoveryKey('room-1', 'user-1', 1, 3),
    getPresenceRecoveryKey('room-1', 'user-1', 1, 4),
  );
});

test('같은 방, 사용자, 복구 세대와 최신 attempt만 성공 응답을 적용한다', () => {
  const base = {
    attempt: 2,
    currentAttempt: 2,
    restoreKey: 'room-1:user-1:1:4',
    currentRestoreKey: 'room-1:user-1:1:4',
    roomId: 'room-1',
    currentRoomId: 'room-1',
    userId: 'user-1',
    currentUserId: 'user-1',
  };
  assert.equal(isPresenceRestoreAttemptCurrent(base), true);
  assert.equal(isPresenceRestoreAttemptCurrent({ ...base, currentAttempt: 3 }), false);
  assert.equal(isPresenceRestoreAttemptCurrent({ ...base, currentRoomId: 'room-2' }), false);
  assert.equal(isPresenceRestoreAttemptCurrent({ ...base, currentUserId: 'user-2' }), false);
  assert.equal(isPresenceRestoreAttemptCurrent({ ...base, currentRestoreKey: 'room-1:user-1:1:5' }), false);
});
""")

tsconfig_path = Path('tsconfig.test.json')
tsconfig = tsconfig_path.read_text()
anchor = '    "src/app/flows/actionFeedback.ts",\n'
addition = anchor + '    "src/app/flows/presenceRecovery.ts",\n'
assert tsconfig.count(anchor) == 1, tsconfig.count(anchor)
tsconfig_path.write_text(tsconfig.replace(anchor, addition))
