from pathlib import Path

service_path = Path('src/features/room/services/roomService.ts')
service = service_path.read_text()

import_anchor = "import { decideRoomPresenceCleanupLease, getRoomPresenceCleanupAction, isEligiblePresenceCleanupCandidate, isStaleHumanPresencePlayer, ROOM_PRESENCE_CLEANUP_LEASE_MS, ROOM_PRESENCE_STALE_MS } from './roomPresenceCleanupPolicy';\n"
import_line = "import { nextPresenceGeneration } from './roomPresenceGeneration';\n"
assert service.count(import_anchor) == 1
service = service.replace(import_anchor, import_anchor + import_line)

old_player = "export interface RoomPlayer { id: string; nickname: string; ready: boolean; color: string; seatIndex: number; team: '청팀' | '홍팀'; isAI?: boolean; isSubstitutedByAI?: boolean; isSpectator?: boolean; joinedAt?: unknown; lastSeen?: unknown; enteredGameAt?: number; enteredStartVersion?: number; lastGamePresenceAt?: number; playerId?: string; currentPlayerId?: string; originalPlayerId?: string; }"
new_player = "export interface RoomPlayer { id: string; nickname: string; ready: boolean; color: string; seatIndex: number; team: '청팀' | '홍팀'; isAI?: boolean; isSubstitutedByAI?: boolean; isSpectator?: boolean; joinedAt?: unknown; lastSeen?: unknown; enteredGameAt?: number; enteredStartVersion?: number; lastGamePresenceAt?: number; playerId?: string; currentPlayerId?: string; originalPlayerId?: string; presenceGeneration?: number; }"
assert service.count(old_player) == 1
service = service.replace(old_player, new_player)

old_seat = "export interface RoomSeat { id: string; playerId: string; originalPlayerId?: string; currentPlayerId?: string; nickname?: string; color?: string; team?: RoomPlayer['team']; seatIndex?: number; label?: string; isHost?: boolean; aiActive?: boolean; aiName?: string; isSubstitutedByAI?: boolean; status?: 'human' | 'ai_substitute' | 'disconnected' | 'removed'; updatedAt?: unknown; createdAt?: unknown; }"
new_seat = "export interface RoomSeat { id: string; playerId: string; originalPlayerId?: string; currentPlayerId?: string; nickname?: string; color?: string; team?: RoomPlayer['team']; seatIndex?: number; label?: string; isHost?: boolean; aiActive?: boolean; aiName?: string; isSubstitutedByAI?: boolean; status?: 'human' | 'ai_substitute' | 'disconnected' | 'removed'; presenceGeneration?: number; updatedAt?: unknown; createdAt?: unknown; }"
assert service.count(old_seat) == 1
service = service.replace(old_seat, new_seat)

service = service.replace("joinedAt: serverTimestamp(), lastSeen: serverTimestamp() });\n  createBatch.set(doc(firestore, 'rooms', roomRef.id, 'seats', '0'),", "joinedAt: serverTimestamp(), lastSeen: serverTimestamp(), presenceGeneration: 0 });\n  createBatch.set(doc(firestore, 'rooms', roomRef.id, 'seats', '0'),", 1)
service = service.replace("aiActive: false, status: 'human', createdAt: serverTimestamp(), updatedAt: serverTimestamp() });", "aiActive: false, status: 'human', presenceGeneration: 0, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });", 1)

old_result = "export type JoinRoomResult = { role: 'player' | 'spectator'; seatIndex: number | null };"
new_result = "export type JoinRoomResult = { role: 'player' | 'spectator'; seatIndex: number | null; presenceGeneration: number };"
assert service.count(old_result) == 1
service = service.replace(old_result, new_result)

old_restore = """        const restoredNickname = existingData.isSubstitutedByAI ? (existingData.nickname || params.nickname) : params.nickname;
        transaction.set(playerRef, { nickname: restoredNickname, ready: true, color: restoredColor, seatIndex: restoreSeatIndex, team: restoredTeam, isAI: false, isSubstitutedByAI: false, isSpectator: false, lastSeen: serverTimestamp() }, { merge: true });
        transaction.set(seatRefs[restoreSeatIndex], { playerId: params.userId, originalPlayerId: params.userId, currentPlayerId: params.userId, nickname: restoredNickname, color: restoredColor, team: restoredTeam, seatIndex: restoreSeatIndex, label: `P${restoreSeatIndex + 1}`, aiActive: false, aiName: '', isSubstitutedByAI: false, status: 'human', updatedAt: serverTimestamp() }, { merge: true });
        transaction.set(roomRef, { emptySince: null }, { merge: true });
        return { role: 'player', seatIndex: restoreSeatIndex };
"""
new_restore = """        const restoredNickname = existingData.isSubstitutedByAI ? (existingData.nickname || params.nickname) : params.nickname;
        const restoreSeat = seatSnapshots[restoreSeatIndex].exists() ? seatSnapshots[restoreSeatIndex].data() as RoomSeat : null;
        const presenceGeneration = nextPresenceGeneration(existingData.presenceGeneration, restoreSeat?.presenceGeneration);
        transaction.set(playerRef, { nickname: restoredNickname, ready: true, color: restoredColor, seatIndex: restoreSeatIndex, team: restoredTeam, isAI: false, isSubstitutedByAI: false, isSpectator: false, lastSeen: serverTimestamp(), presenceGeneration }, { merge: true });
        transaction.set(seatRefs[restoreSeatIndex], { playerId: params.userId, originalPlayerId: params.userId, currentPlayerId: params.userId, nickname: restoredNickname, color: restoredColor, team: restoredTeam, seatIndex: restoreSeatIndex, label: `P${restoreSeatIndex + 1}`, aiActive: false, aiName: '', isSubstitutedByAI: false, status: 'human', presenceGeneration, updatedAt: serverTimestamp() }, { merge: true });
        transaction.set(roomRef, { emptySince: null }, { merge: true });
        return { role: 'player', seatIndex: restoreSeatIndex, presenceGeneration };
"""
assert service.count(old_restore) == 1
service = service.replace(old_restore, new_restore)

service = service.replace("return { role: 'spectator', seatIndex: null };", "return { role: 'spectator', seatIndex: null, presenceGeneration: Number(existingData.presenceGeneration ?? 0) };", 1)
service = service.replace("return { role: 'spectator', seatIndex: null };", "return { role: 'spectator', seatIndex: null, presenceGeneration: Number(existingData.presenceGeneration ?? 0) };", 1)

old_existing_free = """      transaction.set(playerRef, {
        nickname: params.nickname,
        ready: false,
        color: COLORS[seatIndex] ?? 'black',
        seatIndex,
        team: params.playMode === 'team' ? TEAMS[seatIndex] : '청팀',
        isSpectator: false,
        joinedAt: existingData.joinedAt ?? serverTimestamp(),
        lastSeen: serverTimestamp(),
      }, { merge: true });
      transaction.set(seatRefs[seatIndex], { playerId: params.userId, originalPlayerId: params.userId, currentPlayerId: params.userId, nickname: params.nickname, color: COLORS[seatIndex] ?? 'black', team: params.playMode === 'team' ? TEAMS[seatIndex] : '청팀', seatIndex, label: `P${seatIndex + 1}`, aiActive: false, status: 'human', createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
      transaction.set(roomRef, { emptySince: null, currentPlayers: currentPlayers + 1 }, { merge: true });
      return { role: 'player', seatIndex };
"""
new_existing_free = """      const presenceGeneration = nextPresenceGeneration(existingData.presenceGeneration);
      transaction.set(playerRef, {
        nickname: params.nickname,
        ready: false,
        color: COLORS[seatIndex] ?? 'black',
        seatIndex,
        team: params.playMode === 'team' ? TEAMS[seatIndex] : '청팀',
        isSpectator: false,
        joinedAt: existingData.joinedAt ?? serverTimestamp(),
        lastSeen: serverTimestamp(),
        presenceGeneration,
      }, { merge: true });
      transaction.set(seatRefs[seatIndex], { playerId: params.userId, originalPlayerId: params.userId, currentPlayerId: params.userId, nickname: params.nickname, color: COLORS[seatIndex] ?? 'black', team: params.playMode === 'team' ? TEAMS[seatIndex] : '청팀', seatIndex, label: `P${seatIndex + 1}`, aiActive: false, status: 'human', presenceGeneration, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
      transaction.set(roomRef, { emptySince: null, currentPlayers: currentPlayers + 1 }, { merge: true });
      return { role: 'player', seatIndex, presenceGeneration };
"""
assert service.count(old_existing_free) == 1
service = service.replace(old_existing_free, new_existing_free)

old_locked = """      const restoredNickname = lockedSeat.isSubstitutedByAI ? (lockedSeat.nickname || params.nickname) : params.nickname;
      transaction.set(playerRef, { nickname: restoredNickname, ready: true, color: restoredColor, seatIndex: matchingLockedSeatIndex, team: restoredTeam, isAI: false, isSubstitutedByAI: false, isSpectator: false, joinedAt: serverTimestamp(), lastSeen: serverTimestamp() }, { merge: true });
      transaction.set(seatRefs[matchingLockedSeatIndex], { playerId: params.userId, originalPlayerId: params.userId, currentPlayerId: params.userId, nickname: restoredNickname, color: restoredColor, team: restoredTeam, seatIndex: matchingLockedSeatIndex, label: `P${matchingLockedSeatIndex + 1}`, aiActive: false, aiName: '', isSubstitutedByAI: false, status: 'human', updatedAt: serverTimestamp() }, { merge: true });
      transaction.set(roomRef, { emptySince: null, currentPlayers }, { merge: true });
      return { role: 'player', seatIndex: matchingLockedSeatIndex };
"""
new_locked = """      const restoredNickname = lockedSeat.isSubstitutedByAI ? (lockedSeat.nickname || params.nickname) : params.nickname;
      const presenceGeneration = nextPresenceGeneration(lockedSeat.presenceGeneration);
      transaction.set(playerRef, { nickname: restoredNickname, ready: true, color: restoredColor, seatIndex: matchingLockedSeatIndex, team: restoredTeam, isAI: false, isSubstitutedByAI: false, isSpectator: false, joinedAt: serverTimestamp(), lastSeen: serverTimestamp(), presenceGeneration }, { merge: true });
      transaction.set(seatRefs[matchingLockedSeatIndex], { playerId: params.userId, originalPlayerId: params.userId, currentPlayerId: params.userId, nickname: restoredNickname, color: restoredColor, team: restoredTeam, seatIndex: matchingLockedSeatIndex, label: `P${matchingLockedSeatIndex + 1}`, aiActive: false, aiName: '', isSubstitutedByAI: false, status: 'human', presenceGeneration, updatedAt: serverTimestamp() }, { merge: true });
      transaction.set(roomRef, { emptySince: null, currentPlayers }, { merge: true });
      return { role: 'player', seatIndex: matchingLockedSeatIndex, presenceGeneration };
"""
assert service.count(old_locked) == 1
service = service.replace(old_locked, new_locked)

service = service.replace("return { role: 'spectator', seatIndex: null };", "return { role: 'spectator', seatIndex: null, presenceGeneration: 0 };", 1)

old_new_player = """    transaction.set(playerRef, {
      nickname: params.nickname,
      ready: false,
      color: COLORS[seatIndex] ?? 'black',
      seatIndex,
      team: params.playMode === 'team' ? TEAMS[seatIndex] : '청팀',
      joinedAt: serverTimestamp(),
      lastSeen: serverTimestamp(),
    }, { merge: true });
    transaction.set(seatRefs[seatIndex], { playerId: params.userId, originalPlayerId: params.userId, currentPlayerId: params.userId, nickname: params.nickname, color: COLORS[seatIndex] ?? 'black', team: params.playMode === 'team' ? TEAMS[seatIndex] : '청팀', seatIndex, label: `P${seatIndex + 1}`, aiActive: false, status: 'human', createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    transaction.set(roomRef, { emptySince: null, currentPlayers: currentPlayers + 1 }, { merge: true });
    return { role: 'player', seatIndex };
"""
new_new_player = """    const presenceGeneration = 0;
    transaction.set(playerRef, {
      nickname: params.nickname,
      ready: false,
      color: COLORS[seatIndex] ?? 'black',
      seatIndex,
      team: params.playMode === 'team' ? TEAMS[seatIndex] : '청팀',
      joinedAt: serverTimestamp(),
      lastSeen: serverTimestamp(),
      presenceGeneration,
    }, { merge: true });
    transaction.set(seatRefs[seatIndex], { playerId: params.userId, originalPlayerId: params.userId, currentPlayerId: params.userId, nickname: params.nickname, color: COLORS[seatIndex] ?? 'black', team: params.playMode === 'team' ? TEAMS[seatIndex] : '청팀', seatIndex, label: `P${seatIndex + 1}`, aiActive: false, status: 'human', presenceGeneration, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    transaction.set(roomRef, { emptySince: null, currentPlayers: currentPlayers + 1 }, { merge: true });
    return { role: 'player', seatIndex, presenceGeneration };
"""
assert service.count(old_new_player) == 1
service = service.replace(old_new_player, new_new_player)

old_cleanup = """    const seatIndex = Number(player.seatIndex);
    const hasSeat = Number.isInteger(seatIndex) && seatIndex >= 0;
    if (action === 'substitute_ai' && hasSeat) {
      transaction.set(playerRef, {
"""
new_cleanup = """    const seatIndex = Number(player.seatIndex);
    const hasSeat = Number.isInteger(seatIndex) && seatIndex >= 0;
    const seatRef = hasSeat ? doc(db!, 'rooms', roomId, 'seats', String(seatIndex)) : null;
    const seatSnapshot = seatRef ? await transaction.get(seatRef) : null;
    const seat = seatSnapshot?.exists() ? seatSnapshot.data() as RoomSeat : null;
    const presenceGeneration = nextPresenceGeneration(player.presenceGeneration, seat?.presenceGeneration);
    if (action === 'substitute_ai' && seatRef) {
      transaction.set(playerRef, {
"""
assert service.count(old_cleanup) == 1
service = service.replace(old_cleanup, new_cleanup)
service = service.replace("isSpectator: false,\n        lastSeen: serverTimestamp(),", "isSpectator: false,\n        lastSeen: serverTimestamp(),\n        presenceGeneration,", 1)
service = service.replace("transaction.set(doc(db!, 'rooms', roomId, 'seats', String(seatIndex)), {", "transaction.set(seatRef, {", 1)
service = service.replace("status: 'ai_substitute',\n        updatedAt: serverTimestamp(),", "status: 'ai_substitute',\n        presenceGeneration,\n        updatedAt: serverTimestamp(),", 1)
service = service.replace("transaction.set(doc(db!, 'rooms', roomId, 'seats', String(seatIndex)), {", "transaction.set(seatRef!, {", 1)
service = service.replace("status: 'disconnected',\n        updatedAt: serverTimestamp(),", "status: 'disconnected',\n        presenceGeneration,\n        updatedAt: serverTimestamp(),", 1)
service_path.write_text(service)

helper_path = Path('src/features/room/services/roomPresenceGeneration.ts')
helper_path.write_text("""export function normalizePresenceGeneration(value: unknown) {
  const generation = Number(value ?? 0);
  return Number.isInteger(generation) && generation >= 0 ? generation : 0;
}

export function nextPresenceGeneration(...values: unknown[]) {
  return Math.max(0, ...values.map(normalizePresenceGeneration)) + 1;
}

export function makePresenceRestoreKey(roomId: string, userId: string, seatIndex: number, generation: unknown) {
  return `${roomId}:${userId}:${seatIndex}:${normalizePresenceGeneration(generation)}`;
}

export function isCurrentPresenceRestoreResult(params: {
  requestVersion: number;
  currentRequestVersion: number;
  requestRoomId: string;
  currentRoomId: string;
  requestUserId: string;
  currentUserId: string;
  observedGeneration: number;
  restoredGeneration: number;
}) {
  return params.requestVersion === params.currentRequestVersion
    && params.requestRoomId === params.currentRoomId
    && params.requestUserId === params.currentUserId
    && params.restoredGeneration > params.observedGeneration;
}
""")

app_path = Path('src/app/App.tsx')
app = app_path.read_text()
app_import_anchor = "import { getHumanSeatsWaitingForGameEntry, getOnlineGameCoordinatorSeatId, haveAllHumanSeatsEnteredGame } from './flows/onlineGameCoordinator';\n"
app_import_line = "import { isCurrentPresenceRestoreResult, makePresenceRestoreKey, normalizePresenceGeneration } from '../features/room/services/roomPresenceGeneration';\n"
assert app.count(app_import_anchor) == 1
app = app.replace(app_import_anchor, app_import_anchor + app_import_line)

old_map = "const roomPlayerAiStatesRef = useRef<Map<string, { isAI: boolean; isSubstitutedByAI: boolean; isSpectator: boolean; nickname: string }>>(new Map());"
new_map = "const roomPlayerAiStatesRef = useRef<Map<string, { isAI: boolean; isSubstitutedByAI: boolean; isSpectator: boolean; nickname: string; presenceGeneration: number }>>(new Map());"
assert app.count(old_map) == 1
app = app.replace(old_map, new_map)

ref_anchor = "  const presenceRestoreKeyRef = useRef('');\n"
ref_add = "  const presenceRestoreRequestVersionRef = useRef(0);\n  const roomRecoveryRequestVersionRef = useRef(0);\n"
assert app.count(ref_anchor) == 1
app = app.replace(ref_anchor, ref_anchor + ref_add)

active_reset = """    activeRoomIdRef.current = activeRoomId;
    activeRoomHostIdRef.current = '';
"""
active_reset_new = """    activeRoomIdRef.current = activeRoomId;
    activeRoomHostIdRef.current = '';
    presenceRestoreRequestVersionRef.current += 1;
    presenceRestoreKeyRef.current = '';
"""
assert app.count(active_reset) == 1
app = app.replace(active_reset, active_reset_new)

old_recovery_start = """    let cancelled = false;
    setLoadingMessage('참여 중이던 방을 확인하고 있습니다...');
    void (async () => {
"""
new_recovery_start = """    let cancelled = false;
    const recoveryRequestVersion = ++roomRecoveryRequestVersionRef.current;
    const isCurrentRecoveryRequest = () => !cancelled
      && roomRecoveryRequestVersionRef.current === recoveryRequestVersion
      && window.localStorage.getItem(STORAGE_KEYS.activeRoomId) === storedRoomId
      && (userRef.current ?? currentUser)?.uid === currentUser.uid;
    setLoadingMessage('참여 중이던 방을 확인하고 있습니다...');
    void (async () => {
"""
assert app.count(old_recovery_start) == 1
app = app.replace(old_recovery_start, new_recovery_start)
app = app.replace("if (cancelled) return;", "if (!isCurrentRecoveryRequest()) return;", 3)

old_host_join = """        const restoredAsHost = storedRoom.hostId === currentUser.uid;
        const restoredMaxPlayers = storedRoom.maxPlayers as 2 | 3 | 4;
        const joinResult = restoredAsHost ? null : await joinRoom(storedRoom.id, { userId: currentUser.uid, nickname, playMode: storedRoom.playMode });
        if (restoredAsHost) {
          await updateRoomPlayer(storedRoom.id, currentUser.uid, { nickname, ready: true, color: 'red', seatIndex: 0, team: '청팀', isSpectator: false });
        }
        if (!isCurrentRecoveryRequest()) return;
"""
new_host_join = """        const restoredAsHost = storedRoom.hostId === currentUser.uid;
        const restoredMaxPlayers = storedRoom.maxPlayers as 2 | 3 | 4;
        const joinResult = await joinRoom(storedRoom.id, { userId: currentUser.uid, nickname, playMode: storedRoom.playMode });
        if (!isCurrentRecoveryRequest()) return;
"""
assert app.count(old_host_join) == 1
app = app.replace(old_host_join, new_host_join)

old_seat_apply = """        if (joinResult?.role === 'player') {
          setSeats(seatsWithJoinedPlayer([], currentUser.uid, nickname, storedRoom.playMode, restoredMaxPlayers, joinResult.seatIndex));
        } else if (restoredAsHost) {
          setSeats(createSeats(nickname, storedRoom.playMode, restoredMaxPlayers).map((seat) => seat.isHost ? { ...seat, id: currentUser.uid } : seat));
        }
"""
new_seat_apply = """        if (restoredAsHost) {
          setSeats(createSeats(nickname, storedRoom.playMode, restoredMaxPlayers).map((seat) => seat.isHost ? { ...seat, id: currentUser.uid } : seat));
        } else if (joinResult.role === 'player') {
          setSeats(seatsWithJoinedPlayer([], currentUser.uid, nickname, storedRoom.playMode, restoredMaxPlayers, joinResult.seatIndex));
        }
"""
assert app.count(old_seat_apply) == 1
app = app.replace(old_seat_apply, new_seat_apply)

old_cleanup_return = "    return () => { cancelled = true; };"
new_cleanup_return = "    return () => { cancelled = true; if (roomRecoveryRequestVersionRef.current === recoveryRequestVersion) roomRecoveryRequestVersionRef.current += 1; };"
assert app.count(old_cleanup_return) == 1
app = app.replace(old_cleanup_return, new_cleanup_return)

old_restore_flow = """      const substitutedLocalPlayer = localPresencePlayer && localPresencePlayer.isAI && localPresencePlayer.isSubstitutedByAI && !localPresencePlayer.isSpectator ? localPresencePlayer : undefined;
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
new_restore_flow = """      const substitutedLocalPlayer = localPresencePlayer && localPresencePlayer.isAI && localPresencePlayer.isSubstitutedByAI && !localPresencePlayer.isSpectator ? localPresencePlayer : undefined;
      if (substitutedLocalPlayer && activeRoomId && screen === 'game' && !leavingRoomRef.current) {
        const observedGeneration = normalizePresenceGeneration(substitutedLocalPlayer.presenceGeneration);
        const restoreKey = makePresenceRestoreKey(activeRoomId, currentUserId!, substitutedLocalPlayer.seatIndex, observedGeneration);
        if (presenceRestoreKeyRef.current !== restoreKey) {
          presenceRestoreKeyRef.current = restoreKey;
          const requestVersion = ++presenceRestoreRequestVersionRef.current;
          const requestRoomId = activeRoomId;
          const requestUserId = currentUserId!;
          void joinRoom(requestRoomId, { userId: requestUserId, nickname: substitutedLocalPlayer.nickname || nickname, playMode })
            .then((result) => {
              const latestUserId = (userRef.current ?? currentUser)?.uid ?? '';
              if (result.role !== 'player' || !isCurrentPresenceRestoreResult({
                requestVersion,
                currentRequestVersion: presenceRestoreRequestVersionRef.current,
                requestRoomId,
                currentRoomId: activeRoomIdRef.current,
                requestUserId,
                currentUserId: latestUserId,
                observedGeneration,
                restoredGeneration: result.presenceGeneration,
              })) return;
              setMessage('연결이 복구되어 원래 좌석으로 다시 참여했습니다.');
            })
            .catch(() => {
              if (presenceRestoreRequestVersionRef.current === requestVersion) presenceRestoreKeyRef.current = '';
            });
        }
      } else if (!substitutedLocalPlayer) {
        presenceRestoreRequestVersionRef.current += 1;
        presenceRestoreKeyRef.current = '';
      }
"""
assert app.count(old_restore_flow) == 1
app = app.replace(old_restore_flow, new_restore_flow)

old_state_map = "roomPlayerAiStatesRef.current = new Map(players.map((player) => [player.id, { isAI: Boolean(player.isAI), isSubstitutedByAI: Boolean(player.isSubstitutedByAI), isSpectator: Boolean(player.isSpectator), nickname: player.nickname }]));"
new_state_map = "roomPlayerAiStatesRef.current = new Map(players.map((player) => [player.id, { isAI: Boolean(player.isAI), isSubstitutedByAI: Boolean(player.isSubstitutedByAI), isSpectator: Boolean(player.isSpectator), nickname: player.nickname, presenceGeneration: normalizePresenceGeneration(player.presenceGeneration) }]));"
assert app.count(old_state_map) == 1
app = app.replace(old_state_map, new_state_map)
app_path.write_text(app)

test_path = Path('tests/unit/roomPresenceGeneration.test.ts')
test_path.write_text("""import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isCurrentPresenceRestoreResult,
  makePresenceRestoreKey,
  nextPresenceGeneration,
  normalizePresenceGeneration,
} from '../../src/features/room/services/roomPresenceGeneration.js';

test('presence generation은 잘못된 값을 0으로 정규화하고 최신 값보다 증가한다', () => {
  assert.equal(normalizePresenceGeneration(-1), 0);
  assert.equal(normalizePresenceGeneration('3'), 3);
  assert.equal(nextPresenceGeneration(2, 5), 6);
});

test('복구 key는 room, user, seat, generation을 모두 포함한다', () => {
  assert.equal(makePresenceRestoreKey('room-1', 'user-1', 2, 4), 'room-1:user-1:2:4');
});

test('오래된 복구 응답은 방·사용자·요청 버전·세대 중 하나라도 바뀌면 무효다', () => {
  const base = {
    requestVersion: 3,
    currentRequestVersion: 3,
    requestRoomId: 'room-1',
    currentRoomId: 'room-1',
    requestUserId: 'user-1',
    currentUserId: 'user-1',
    observedGeneration: 5,
    restoredGeneration: 6,
  };
  assert.equal(isCurrentPresenceRestoreResult(base), true);
  assert.equal(isCurrentPresenceRestoreResult({ ...base, currentRequestVersion: 4 }), false);
  assert.equal(isCurrentPresenceRestoreResult({ ...base, currentRoomId: 'room-2' }), false);
  assert.equal(isCurrentPresenceRestoreResult({ ...base, currentUserId: 'user-2' }), false);
  assert.equal(isCurrentPresenceRestoreResult({ ...base, restoredGeneration: 5 }), false);
});
""")

tsconfig_path = Path('tsconfig.test.json')
tsconfig = tsconfig_path.read_text()
anchor = '    "src/features/room/services/roomPresenceCleanupPolicy.ts",\n'
addition = anchor + '    "src/features/room/services/roomPresenceGeneration.ts",\n'
assert tsconfig.count(anchor) == 1
tsconfig_path.write_text(tsconfig.replace(anchor, addition))
