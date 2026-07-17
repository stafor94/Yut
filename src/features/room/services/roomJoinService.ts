import { doc, runTransaction, serverTimestamp, type DocumentSnapshot } from 'firebase/firestore';
import { db } from '../../../services/firebase/firebaseDb';
import {
  isRoomInGame as isRoomInGameCore,
  joinRoom as joinRoomCore,
  type JoinRoomResult,
  type RoomPlayer,
  type RoomSeat,
} from './roomServiceCore';
import {
  isRoomCapacityFullError,
  ROOM_CAPACITY_FULL_ERROR_MESSAGE,
  ROOM_CAPACITY_FULL_EVENT,
} from './roomAvailabilityPolicy';
import { isReusableWaitingRoomSeat, isSystemRoom } from './roomLifecyclePolicy';
import type { ManagedRoomSummary } from './roomLifecycleStore';

const COLORS = ['red', 'blue', 'green', 'yellow'] as const;
const TEAMS: RoomPlayer['team'][] = ['청팀', '홍팀', '청팀', '홍팀'];

type SeatSnapshot = DocumentSnapshot;

export async function joinRoomSafely(...args: Parameters<typeof joinRoomCore>): Promise<JoinRoomResult> {
  if (!db) throw new Error('Firebase 환경변수가 설정되지 않았습니다.');
  const [roomId, params] = args;
  const roomRef = doc(db, 'rooms', roomId);
  const playerRef = doc(db, 'rooms', roomId, 'players', params.userId);
  try {
    return await runTransaction(db, async (transaction): Promise<JoinRoomResult> => {
      const roomSnapshot = await transaction.get(roomRef);
      if (!roomSnapshot.exists()) throw new Error('존재하지 않는 방입니다.');
      const room = roomSnapshot.data() as ManagedRoomSummary;
      if (room.status === 'finished' || room.deletingAt || isSystemRoom(room)) throw new Error('이미 종료되었거나 입장할 수 없는 방입니다.');

      const existingPlayer = await transaction.get(playerRef);
      const maxPlayers = room.maxPlayers as 2 | 3 | 4;
      const seatRefs = Array.from({ length: maxPlayers }, (_, index) => doc(db!, 'rooms', roomId, 'seats', String(index)));
      const seatSnapshots = await Promise.all(seatRefs.map((seatRef) => transaction.get(seatRef)));
      const isAvailableSeat = (seatSnapshot: SeatSnapshot) => (
        isReusableWaitingRoomSeat(seatSnapshot.exists() ? seatSnapshot.data() as RoomSeat : null)
      );
      const occupiedSeatCount = seatSnapshots.filter((seatSnapshot) => !isAvailableSeat(seatSnapshot)).length;
      const matchingLockedSeatIndex = seatSnapshots.findIndex((seatSnapshot) => {
        if (!seatSnapshot.exists()) return false;
        const seat = seatSnapshot.data() as RoomSeat;
        return String(seat.originalPlayerId ?? seat.playerId ?? '') === params.userId;
      });

      const clearReplacedSeatPlayer = (seatIndex: number) => {
        const seatSnapshot = seatSnapshots[seatIndex];
        if (!seatSnapshot.exists()) return;
        const replacedPlayerId = String((seatSnapshot.data() as RoomSeat).playerId ?? '');
        if (replacedPlayerId && replacedPlayerId !== params.userId) transaction.delete(doc(db!, 'rooms', roomId, 'players', replacedPlayerId));
      };

      const restorePlayerAt = (seatIndex: number, player: RoomPlayer | null, seat: RoomSeat | null, joinedAt: unknown) => {
        const currentPresenceEpoch = Math.max(Number(player?.presenceEpoch ?? 0), Number(seat?.presenceEpoch ?? 0));
        const wasSubstituted = Boolean(player?.isSubstitutedByAI || seat?.isSubstitutedByAI);
        if (wasSubstituted && params.expectedPresenceEpoch !== undefined && params.expectedPresenceEpoch !== currentPresenceEpoch) throw new Error('PRESENCE_RESTORE_STALE');
        const restoredPresenceEpoch = wasSubstituted ? currentPresenceEpoch + 1 : currentPresenceEpoch;
        const restoredTeam = player?.team ?? seat?.team ?? (params.playMode === 'team' ? TEAMS[seatIndex] : '청팀');
        const restoredColor = player?.color ?? seat?.color ?? COLORS[seatIndex] ?? 'black';
        const restoredNickname = wasSubstituted ? (player?.nickname || seat?.nickname || params.nickname) : params.nickname;
        const seatWasAvailable = isAvailableSeat(seatSnapshots[seatIndex]);
        transaction.set(playerRef, {
          nickname: restoredNickname,
          ready: true,
          color: restoredColor,
          seatIndex,
          team: restoredTeam,
          isAI: false,
          isSubstitutedByAI: false,
          isSpectator: false,
          presenceEpoch: restoredPresenceEpoch,
          restoredAt: serverTimestamp(),
          joinedAt,
          lastSeen: serverTimestamp(),
        }, { merge: true });
        transaction.set(seatRefs[seatIndex], {
          playerId: params.userId,
          originalPlayerId: params.userId,
          currentPlayerId: params.userId,
          nickname: restoredNickname,
          color: restoredColor,
          team: restoredTeam,
          seatIndex,
          label: `P${seatIndex + 1}`,
          aiActive: false,
          aiName: '',
          isSubstitutedByAI: false,
          status: 'human',
          presenceEpoch: restoredPresenceEpoch,
          restoredAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        }, { merge: true });
        transaction.set(roomRef, {
          emptySince: null,
          deletingAt: null,
          lastActivityAt: Date.now(),
          currentPlayers: occupiedSeatCount + (seatWasAvailable ? 1 : 0),
        }, { merge: true });
        return { role: 'player' as const, seatIndex, presenceEpoch: restoredPresenceEpoch };
      };

      if (existingPlayer.exists()) {
        const existingData = existingPlayer.data() as RoomPlayer;
        const existingSeatIndex = Number(existingData.seatIndex);
        const seatIndexForUser = seatSnapshots.findIndex((seatSnapshot) => seatSnapshot.exists() && String(seatSnapshot.data().playerId ?? '') === params.userId);
        const restoreSeatIndex = matchingLockedSeatIndex >= 0 ? matchingLockedSeatIndex : seatIndexForUser >= 0 ? seatIndexForUser : existingSeatIndex;
        const hasValidActiveSeat = Number.isInteger(restoreSeatIndex)
          && restoreSeatIndex >= 0
          && restoreSeatIndex < maxPlayers
          && (!existingData.isSpectator || seatIndexForUser >= 0 || matchingLockedSeatIndex >= 0);
        if (hasValidActiveSeat) {
          const restoreSeat = seatSnapshots[restoreSeatIndex].exists() ? seatSnapshots[restoreSeatIndex].data() as RoomSeat : null;
          return restorePlayerAt(restoreSeatIndex, existingData, restoreSeat, existingData.joinedAt ?? serverTimestamp());
        }
        if (isRoomInGameCore(room)) {
          transaction.set(playerRef, {
            nickname: params.nickname,
            ready: true,
            color: 'spectator',
            seatIndex: 99 + Date.now() % 100000,
            team: '청팀',
            isSpectator: true,
            joinedAt: existingData.joinedAt ?? serverTimestamp(),
            lastSeen: serverTimestamp(),
          }, { merge: true });
          transaction.set(roomRef, { emptySince: null, currentPlayers: occupiedSeatCount, lastActivityAt: Date.now() }, { merge: true });
          return { role: 'spectator', seatIndex: null };
        }
        const seatIndex = seatSnapshots.findIndex(isAvailableSeat);
        if (seatIndex < 0) throw new Error(ROOM_CAPACITY_FULL_ERROR_MESSAGE);
        clearReplacedSeatPlayer(seatIndex);
        transaction.set(playerRef, {
          nickname: params.nickname,
          ready: false,
          color: COLORS[seatIndex] ?? 'black',
          seatIndex,
          team: params.playMode === 'team' ? TEAMS[seatIndex] : '청팀',
          isAI: false,
          isSubstitutedByAI: false,
          isSpectator: false,
          joinedAt: existingData.joinedAt ?? serverTimestamp(),
          lastSeen: serverTimestamp(),
        }, { merge: true });
        transaction.set(seatRefs[seatIndex], {
          playerId: params.userId,
          originalPlayerId: params.userId,
          currentPlayerId: params.userId,
          nickname: params.nickname,
          color: COLORS[seatIndex] ?? 'black',
          team: params.playMode === 'team' ? TEAMS[seatIndex] : '청팀',
          seatIndex,
          label: `P${seatIndex + 1}`,
          aiActive: false,
          isSubstitutedByAI: false,
          status: 'human',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        transaction.set(roomRef, { emptySince: null, currentPlayers: occupiedSeatCount + 1, lastActivityAt: Date.now() }, { merge: true });
        return { role: 'player', seatIndex };
      }

      if (matchingLockedSeatIndex >= 0) {
        const lockedSeat = seatSnapshots[matchingLockedSeatIndex].data() as RoomSeat;
        return restorePlayerAt(matchingLockedSeatIndex, null, lockedSeat, serverTimestamp());
      }

      if (isRoomInGameCore(room)) {
        transaction.set(playerRef, {
          nickname: params.nickname,
          ready: true,
          color: 'spectator',
          seatIndex: 99 + Date.now() % 100000,
          team: '청팀',
          isSpectator: true,
          joinedAt: serverTimestamp(),
          lastSeen: serverTimestamp(),
        }, { merge: true });
        transaction.set(roomRef, { emptySince: null, currentPlayers: occupiedSeatCount, lastActivityAt: Date.now() }, { merge: true });
        return { role: 'spectator', seatIndex: null };
      }

      const seatIndex = seatSnapshots.findIndex(isAvailableSeat);
      if (seatIndex < 0) throw new Error(ROOM_CAPACITY_FULL_ERROR_MESSAGE);
      clearReplacedSeatPlayer(seatIndex);
      transaction.set(playerRef, {
        nickname: params.nickname,
        ready: false,
        color: COLORS[seatIndex] ?? 'black',
        seatIndex,
        team: params.playMode === 'team' ? TEAMS[seatIndex] : '청팀',
        isAI: false,
        isSubstitutedByAI: false,
        isSpectator: false,
        joinedAt: serverTimestamp(),
        lastSeen: serverTimestamp(),
      }, { merge: true });
      transaction.set(seatRefs[seatIndex], {
        playerId: params.userId,
        originalPlayerId: params.userId,
        currentPlayerId: params.userId,
        nickname: params.nickname,
        color: COLORS[seatIndex] ?? 'black',
        team: params.playMode === 'team' ? TEAMS[seatIndex] : '청팀',
        seatIndex,
        label: `P${seatIndex + 1}`,
        aiActive: false,
        isSubstitutedByAI: false,
        status: 'human',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      transaction.set(roomRef, { emptySince: null, currentPlayers: occupiedSeatCount + 1, lastActivityAt: Date.now() }, { merge: true });
      return { role: 'player', seatIndex };
    });
  } catch (error) {
    if (isRoomCapacityFullError(error) && typeof window !== 'undefined') {
      window.dispatchEvent(new Event(ROOM_CAPACITY_FULL_EVENT));
    }
    throw error;
  }
}
