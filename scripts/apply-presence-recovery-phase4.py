from pathlib import Path

service_path = Path('src/features/room/services/roomService.ts')
service = service_path.read_text()

service = service.replace(
    "export interface RoomPlayer { id: string; nickname: string; ready: boolean; color: string; seatIndex: number; team: '청팀' | '홍팀'; isAI?: boolean; isSubstitutedByAI?: boolean; isSpectator?: boolean; joinedAt?: unknown; lastSeen?: unknown; enteredGameAt?: number; enteredStartVersion?: number; lastGamePresenceAt?: number; playerId?: string; currentPlayerId?: string; originalPlayerId?: string; }",
    "export interface RoomPlayer { id: string; nickname: string; ready: boolean; color: string; seatIndex: number; team: '청팀' | '홍팀'; isAI?: boolean; isSubstitutedByAI?: boolean; isSpectator?: boolean; joinedAt?: unknown; lastSeen?: unknown; enteredGameAt?: number; enteredStartVersion?: number; lastGamePresenceAt?: number; playerId?: string; currentPlayerId?: string; originalPlayerId?: string; presenceGeneration?: number; }",
)
service = service.replace(
    "export interface RoomSeat { id: string; playerId: string; originalPlayerId?: string; currentPlayerId?: string; nickname?: string; color?: string; team?: RoomPlayer['team']; seatIndex?: number; label?: string; isHost?: boolean; aiActive?: boolean; aiName?: string; isSubstitutedByAI?: boolean; status?: 'human' | 'ai_substitute' | 'disconnected' | 'removed'; updatedAt?: unknown; createdAt?: unknown; }",
    "export interface RoomSeat { id: string; playerId: string; originalPlayerId?: string; currentPlayerId?: string; nickname?: string; color?: string; team?: RoomPlayer['team']; seatIndex?: number; label?: string; isHost?: boolean; aiActive?: boolean; aiName?: string; isSubstitutedByAI?: boolean; status?: 'human' | 'ai_substitute' | 'disconnected' | 'removed'; presenceGeneration?: number; updatedAt?: unknown; createdAt?: unknown; }",
)
service = service.replace(
    "export type JoinRoomResult = { role: 'player' | 'spectator'; seatIndex: number | null };",
    "export type JoinRoomResult = { role: 'player' | 'spectator'; seatIndex: number | null; presenceGeneration: number };",
)

old = """        const restoredNickname = existingData.isSubstitutedByAI ? (existingData.nickname || params.nickname) : params.nickname;
        transaction.set(playerRef, { nickname: restoredNickname, ready: true, color: restoredColor, seatIndex: restoreSeatIndex, team: restoredTeam, isAI: false, isSubstitutedByAI: false, isSpectator: false, lastSeen: serverTimestamp() }, { merge: true });
        transaction.set(seatRefs[restoreSeatIndex], { playerId: params.userId, originalPlayerId: params.userId, currentPlayerId: params.userId, nickname: restoredNickname, color: restoredColor, team: restoredTeam, seatIndex: restoreSeatIndex, label: `P${restoreSeatIndex + 1}`, aiActive: false, aiName: '', isSubstitutedByAI: false, status: 'human', updatedAt: serverTimestamp() }, { merge: true });
        transaction.set(roomRef, { emptySince: null }, { merge: true });
        return { role: 'player', seatIndex: restoreSeatIndex };
"""
new = """        const restoredNickname = existingData.isSubstitutedByAI ? (existingData.nickname || params.nickname) : params.nickname;
        const restoredSeat = seatSnapshots[restoreSeatIndex].exists() ? seatSnapshots[restoreSeatIndex].data() as RoomSeat : null;
        const presenceGeneration = Math.max(Number(existingData.presenceGeneration ?? 0), Number(restoredSeat?.presenceGeneration ?? 0)) + 1;
        transaction.set(playerRef, { nickname: restoredNickname, ready: true, color: restoredColor, seatIndex: restoreSeatIndex, team: restoredTeam, isAI: false, isSubstitutedByAI: false, isSpectator: false, presenceGeneration, lastSeen: serverTimestamp() }, { merge: true });
        transaction.set(seatRefs[restoreSeatIndex], { playerId: params.userId, originalPlayerId: params.userId, currentPlayerId: params.userId, nickname: restoredNickname, color: restoredColor, team: restoredTeam, seatIndex: restoreSeatIndex, label: `P${restoreSeatIndex + 1}`, aiActive: false, aiName: '', isSubstitutedByAI: false, status: 'human', presenceGeneration, updatedAt: serverTimestamp() }, { merge: true });
        transaction.set(roomRef, { emptySince: null }, { merge: true });
        return { role: 'player', seatIndex: restoreSeatIndex, presenceGeneration };
"""
assert service.count(old) == 1
service = service.replace(old, new)

service = service.replace("return { role: 'spectator', seatIndex: null };", "return { role: 'spectator', seatIndex: null, presenceGeneration: Number(existingData.presenceGeneration ?? 0) };", 2)

old = """      transaction.set(playerRef, {
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
new = """      const presenceGeneration = Number(existingData.presenceGeneration ?? 0) + 1;
      transaction.set(playerRef, {
        nickname: params.nickname,
        ready: false,
        color: COLORS[seatIndex] ?? 'black',
        seatIndex,
        team: params.playMode === 'team' ? TEAMS[seatIndex] : '청팀',
        isSpectator: false,
        presenceGeneration,
        joinedAt: existingData.joinedAt ?? serverTimestamp(),
        lastSeen: serverTimestamp(),
      }, { merge: true });
      transaction.set(seatRefs[seatIndex], { playerId: params.userId, originalPlayerId: params.userId, currentPlayerId: params.userId, nickname: params.nickname, color: COLORS[seatIndex] ?? 'black', team: params.playMode === 'team' ? TEAMS[seatIndex] : '청팀', seatIndex, label: `P${seatIndex + 1}`, aiActive: false, status: 'human', presenceGeneration, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
      transaction.set(roomRef, { emptySince: null, currentPlayers: currentPlayers + 1 }, { merge: true });
      return { role: 'player', seatIndex, presenceGeneration };
"""
assert service.count(old) == 1
service = service.replace(old, new)

old = """      const restoredNickname = lockedSeat.isSubstitutedByAI ? (lockedSeat.nickname || params.nickname) : params.nickname;
      transaction.set(playerRef, { nickname: restoredNickname, ready: true, color: restoredColor, seatIndex: matchingLockedSeatIndex, team: restoredTeam, isAI: false, isSubstitutedByAI: false, isSpectator: false, joinedAt: serverTimestamp(), lastSeen: serverTimestamp() }, { merge: true });
      transaction.set(seatRefs[matchingLockedSeatIndex], { playerId: params.userId, originalPlayerId: params.userId, currentPlayerId: params.userId, nickname: restoredNickname, color: restoredColor, team: restoredTeam, seatIndex: matchingLockedSeatIndex, label: `P${matchingLockedSeatIndex + 1}`, aiActive: false, aiName: '', isSubstitutedByAI: false, status: 'human', updatedAt: serverTimestamp() }, { merge: true });
      transaction.set(roomRef, { emptySince: null, currentPlayers }, { merge: true });
      return { role: 'player', seatIndex: matchingLockedSeatIndex };
"""
new = """      const restoredNickname = lockedSeat.isSubstitutedByAI ? (lockedSeat.nickname || params.nickname) : params.nickname;
      const presenceGeneration = Number(lockedSeat.presenceGeneration ?? 0) + 1;
      transaction.set(playerRef, { nickname: restoredNickname, ready: true, color: restoredColor, seatIndex: matchingLockedSeatIndex, team: restoredTeam, isAI: false, isSubstitutedByAI: false, isSpectator: false, presenceGeneration, joinedAt: serverTimestamp(), lastSeen: serverTimestamp() }, { merge: true });
      transaction.set(seatRefs[matchingLockedSeatIndex], { playerId: params.userId, originalPlayerId: params.userId, currentPlayerId: params.userId, nickname: restoredNickname, color: restoredColor, team: restoredTeam, seatIndex: matchingLockedSeatIndex, label: `P${matchingLockedSeatIndex + 1}`, aiActive: false, aiName: '', isSubstitutedByAI: false, status: 'human', presenceGeneration, updatedAt: serverTimestamp() }, { merge: true });
      transaction.set(roomRef, { emptySince: null, currentPlayers }, { merge: true });
      return { role: 'player', seatIndex: matchingLockedSeatIndex, presenceGeneration };
"""
assert service.count(old) == 1
service = service.replace(old, new)

service = service.replace("return { role: 'spectator', seatIndex: null };", "return { role: 'spectator', seatIndex: null, presenceGeneration: 1 };", 1)
old = """    transaction.set(playerRef, {
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
new = """    const presenceGeneration = 1;
    transaction.set(playerRef, {
      nickname: params.nickname,
      ready: false,
      color: COLORS[seatIndex] ?? 'black',
      seatIndex,
      team: params.playMode === 'team' ? TEAMS[seatIndex] : '청팀',
      presenceGeneration,
      joinedAt: serverTimestamp(),
      lastSeen: serverTimestamp(),
    }, { merge: true });
    transaction.set(seatRefs[seatIndex], { playerId: params.userId, originalPlayerId: params.userId, currentPlayerId: params.userId, nickname: params.nickname, color: COLORS[seatIndex] ?? 'black', team: params.playMode === 'team' ? TEAMS[seatIndex] : '청팀', seatIndex, label: `P${seatIndex + 1}`, aiActive: false, status: 'human', presenceGeneration, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    transaction.set(roomRef, { emptySince: null, currentPlayers: currentPlayers + 1 }, { merge: true });
    return { role: 'player', seatIndex, presenceGeneration };
"""
assert service.count(old) == 1
service = service.replace(old, new)

old = """    if (action === 'substitute_ai' && hasSeat) {
      transaction.set(playerRef, {
"""
new = """    const presenceGeneration = Number(player.presenceGeneration ?? 0) + 1;
    if (action === 'substitute_ai' && hasSeat) {
      transaction.set(playerRef, {
"""
assert service.count(old) == 1
service = service.replace(old, new)
service = service.replace("        isSpectator: false,\n        lastSeen: serverTimestamp(),", "        isSpectator: false,\n        presenceGeneration,\n        lastSeen: serverTimestamp(),", 1)
service = service.replace("        status: 'ai_substitute',\n        updatedAt: serverTimestamp(),", "        status: 'ai_substitute',\n        presenceGeneration,\n        updatedAt: serverTimestamp(),", 1)
service = service.replace("        status: 'disconnected',\n        updatedAt: serverTimestamp(),", "        status: 'disconnected',\n        presenceGeneration,\n        updatedAt: serverTimestamp(),", 1)
service_path.write_text(service)

app_path = Path('src/app/App.tsx')
app = app_path.read_text()
import_anchor = "import { getStartGameBlockMessage } from './flows/gameStartFlow';\n"
helper_import = "import { createPresenceRecoveryAttempt, isPresenceRecoveryAttemptCurrent } from './flows/presenceRecoveryFlow';\n"
assert app.count(import_anchor) == 1
app = app.replace(import_anchor, import_anchor + helper_import)
app = app.replace("  const presenceRestoreKeyRef = useRef('');", "  const presenceRestoreKeyRef = useRef('');\n  const presenceRecoveryAttemptRef = useRef('');")

old = """        const restoredAsHost = storedRoom.hostId === currentUser.uid;
        const restoredMaxPlayers = storedRoom.maxPlayers as 2 | 3 | 4;
        const joinResult = restoredAsHost ? null : await joinRoom(storedRoom.id, { userId: currentUser.uid, nickname, playMode: storedRoom.playMode });
        if (restoredAsHost) {
          await updateRoomPlayer(storedRoom.id, currentUser.uid, { nickname, ready: true, color: 'red', seatIndex: 0, team: '청팀', isSpectator: false });
        }
        if (cancelled) return;
"""
new = """        const restoredAsHost = storedRoom.hostId === currentUser.uid;
        const restoredMaxPlayers = storedRoom.maxPlayers as 2 | 3 | 4;
        const recoveryAttempt = createPresenceRecoveryAttempt(storedRoom.id, currentUser.uid, 0);
        presenceRecoveryAttemptRef.current = recoveryAttempt;
        const joinResult = await joinRoom(storedRoom.id, { userId: currentUser.uid, nickname, playMode: storedRoom.playMode });
        if (cancelled || !isPresenceRecoveryAttemptCurrent(presenceRecoveryAttemptRef.current, recoveryAttempt, storedRoom.id, currentUser.uid)) return;
"""
assert app.count(old) == 1
app = app.replace(old, new)
app = app.replace("        if (joinResult?.role === 'player') {", "        if (joinResult.role === 'player') {")
app = app.replace("    return () => { cancelled = true; };", "    return () => { cancelled = true; presenceRecoveryAttemptRef.current = ''; };")

old = """        const restoreKey = `${activeRoomId}:${currentUserId}:${substitutedLocalPlayer.seatIndex}`;
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
"""
new = """        const observedGeneration = Number(substitutedLocalPlayer.presenceGeneration ?? 0);
        const restoreKey = `${activeRoomId}:${currentUserId}:${substitutedLocalPlayer.seatIndex}:${observedGeneration}`;
        if (presenceRestoreKeyRef.current !== restoreKey) {
          presenceRestoreKeyRef.current = restoreKey;
          const recoveryAttempt = createPresenceRecoveryAttempt(activeRoomId, currentUserId!, observedGeneration);
          presenceRecoveryAttemptRef.current = recoveryAttempt;
          void joinRoom(activeRoomId, { userId: currentUserId!, nickname: substitutedLocalPlayer.nickname || nickname, playMode })
            .then((result) => {
              if (!isPresenceRecoveryAttemptCurrent(presenceRecoveryAttemptRef.current, recoveryAttempt, activeRoomIdRef.current, (userRef.current ?? currentUser)?.uid ?? '')) return;
              if (result.role !== 'player' || result.presenceGeneration <= observedGeneration) {
                presenceRestoreKeyRef.current = '';
                return;
              }
              setMessage('연결이 복구되어 원래 좌석으로 다시 참여했습니다.');
            })
            .catch(() => {
              if (presenceRecoveryAttemptRef.current === recoveryAttempt) presenceRestoreKeyRef.current = '';
            });
        }
"""
assert app.count(old) == 1
app = app.replace(old, new)
app = app.replace("      } else if (!substitutedLocalPlayer) {\n        presenceRestoreKeyRef.current = '';", "      } else if (!substitutedLocalPlayer) {\n        presenceRestoreKeyRef.current = '';\n        presenceRecoveryAttemptRef.current = '';")

anchor = """    activeRoomIdRef.current = activeRoomId;
    activeRoomHostIdRef.current = '';
"""
replacement = """    activeRoomIdRef.current = activeRoomId;
    activeRoomHostIdRef.current = '';
    presenceRestoreKeyRef.current = '';
    presenceRecoveryAttemptRef.current = '';
"""
assert app.count(anchor) == 1
app = app.replace(anchor, replacement)
app_path.write_text(app)

Path('src/app/flows/presenceRecoveryFlow.ts').write_text("""export function createPresenceRecoveryAttempt(roomId: string, userId: string, generation: number) {
  return `${roomId}:${userId}:${Math.max(0, Number(generation) || 0)}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
}

export function isPresenceRecoveryAttemptCurrent(currentAttempt: string, expectedAttempt: string, currentRoomId: string, expectedUserId: string) {
  if (!currentAttempt || currentAttempt !== expectedAttempt) return false;
  const [expectedRoomId, attemptUserId] = expectedAttempt.split(':');
  return Boolean(expectedRoomId && attemptUserId && currentRoomId === expectedRoomId && expectedUserId === attemptUserId);
}
""")

Path('tests/unit/presenceRecoveryFlow.test.ts').write_text("""import assert from 'node:assert/strict';
import test from 'node:test';
import { createPresenceRecoveryAttempt, isPresenceRecoveryAttemptCurrent } from '../../src/app/flows/presenceRecoveryFlow.js';

test('같은 방과 사용자에 대한 최신 복구 요청만 적용한다', () => {
  const attempt = createPresenceRecoveryAttempt('room-a', 'user-a', 3);
  assert.equal(isPresenceRecoveryAttemptCurrent(attempt, attempt, 'room-a', 'user-a'), true);
  assert.equal(isPresenceRecoveryAttemptCurrent('new-attempt', attempt, 'room-a', 'user-a'), false);
  assert.equal(isPresenceRecoveryAttemptCurrent(attempt, attempt, 'room-b', 'user-a'), false);
  assert.equal(isPresenceRecoveryAttemptCurrent(attempt, attempt, 'room-a', 'user-b'), false);
});

test('AI 대체 generation이 달라지면 별도 복구 요청이 된다', () => {
  const first = createPresenceRecoveryAttempt('room-a', 'user-a', 3);
  const second = createPresenceRecoveryAttempt('room-a', 'user-a', 4);
  assert.notEqual(first, second);
});
""")

tsconfig_path = Path('tsconfig.test.json')
tsconfig = tsconfig_path.read_text()
anchor = '    "src/app/flows/roomCreationFlow.ts",\n'
if anchor not in tsconfig:
    anchor = '    "src/app/hooks/sequenceRecoveryWatchdog.ts",\n'
assert tsconfig.count(anchor) == 1
tsconfig_path.write_text(tsconfig.replace(anchor, anchor + '    "src/app/flows/presenceRecoveryFlow.ts",\n'))
