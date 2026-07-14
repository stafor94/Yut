import { doc, runTransaction, serverTimestamp } from 'firebase/firestore';
import { db } from '../../../services/firebase/firebaseDb';
import { getClientMutationDocRef, makeSequenceDocId, sanitizeForFirestore } from './roomFirestore';
import {
  isRoomGameActivationWindowOpen,
  isRoomGamePreparationWindowOpen,
} from './roomGamePreparationPolicy';
import {
  makeSequenceEventFields,
  type RoomSummary,
  type SaveGameStateResult,
  type SyncedGameState,
} from './roomServiceCore';

type GameStartRequestIdentity = {
  startRequestVersion: number;
  startRequestId: string;
};

type GameStartRequestMeta = GameStartRequestIdentity & {
  actorId: string;
  initializedAt: number;
  clientMutationId: string;
};

const isCurrentStartRequest = (room: Omit<RoomSummary, 'id'>, identity: GameStartRequestIdentity) => (
  Number(room.startRequestVersion ?? 0) === identity.startRequestVersion
  && String(room.startRequestId ?? '') === identity.startRequestId
);

const isCancelledStartRequest = (room: Omit<RoomSummary, 'id'>) => {
  const startCancelledAt = Number(room.startCancelledAt ?? 0);
  return Boolean(startCancelledAt && startCancelledAt >= Number(room.startRequestedAt ?? 0));
};

const isPreparedForRequest = (state: SyncedGameState | null, identity: GameStartRequestIdentity) => (
  Number(state?.startRequestVersion ?? 0) === identity.startRequestVersion
  && String(state?.startRequestId ?? '') === identity.startRequestId
  && Array.isArray(state?.pieces)
  && state.pieces.length > 0
);

export async function prepareRoomGameState(
  roomId: string,
  state: Omit<SyncedGameState, 'updatedAt' | 'turnVersion'>,
  meta: GameStartRequestMeta,
): Promise<SaveGameStateResult> {
  if (!db || !roomId) return { status: 'unavailable' };
  const roomRef = doc(db, 'rooms', roomId);
  const gameStateRef = doc(db, 'rooms', roomId, 'state', 'current');
  const processedActionRef = getClientMutationDocRef(roomId, meta.clientMutationId);

  return runTransaction(db, async (transaction) => {
    const processedActionSnapshot = await transaction.get(processedActionRef);
    const currentStateSnapshot = await transaction.get(gameStateRef);
    const roomSnapshot = await transaction.get(roomRef);
    if (!roomSnapshot.exists()) return { status: 'unavailable' as const };

    const room = roomSnapshot.data() as Omit<RoomSummary, 'id'>;
    const currentState = currentStateSnapshot.exists() ? currentStateSnapshot.data() as SyncedGameState : null;
    const currentVersion = Number(currentState?.turnVersion ?? 0);
    const currentSequence = Number(currentState?.lastSequence ?? 0);
    if (!isCurrentStartRequest(room, meta)) return { status: 'sequence_mismatch' as const, turnVersion: currentVersion, lastSequence: currentSequence };

    if (processedActionSnapshot.exists()) {
      const processed = processedActionSnapshot.data();
      if (Number(processed.startRequestVersion ?? 0) !== meta.startRequestVersion || String(processed.startRequestId ?? '') !== meta.startRequestId) {
        return { status: 'sequence_mismatch' as const, turnVersion: currentVersion, lastSequence: currentSequence };
      }
      return {
        status: 'duplicate' as const,
        turnVersion: Number(processed.turnVersion ?? currentVersion),
        lastSequence: Number(processed.sequence ?? currentSequence),
      };
    }

    if (isPreparedForRequest(currentState, meta)) {
      transaction.set(processedActionRef, {
        clientMutationId: meta.clientMutationId,
        startRequestVersion: meta.startRequestVersion,
        startRequestId: meta.startRequestId,
        sequence: currentSequence,
        turnVersion: currentVersion,
        type: 'game_initialized',
        actorId: meta.actorId,
        createdAt: serverTimestamp(),
      });
      return { status: 'duplicate' as const, turnVersion: currentVersion, lastSequence: currentSequence };
    }

    const countdownEndsAt = Number(room.startCountdownEndsAt ?? room.startCountdownUntil ?? 0);
    const requestCanBePrepared = room.status === 'waiting'
      && room.startStatus === 'requested'
      && isRoomGamePreparationWindowOpen(countdownEndsAt)
      && !isCancelledStartRequest(room);
    if (!requestCanBePrepared) return { status: 'sequence_mismatch' as const, turnVersion: currentVersion, lastSequence: currentSequence };

    const nextVersion = currentVersion + 1;
    const nextSequence = currentSequence + 1;
    const sequenceRef = doc(db!, 'rooms', roomId, 'sequences', makeSequenceDocId(nextSequence));
    transaction.set(sequenceRef, {
      sequence: nextSequence,
      type: 'game_initialized',
      actorId: meta.actorId,
      payload: sanitizeForFirestore({
        startRequestVersion: meta.startRequestVersion,
        startRequestId: meta.startRequestId,
        initializedAt: meta.initializedAt,
        preparedBeforeCountdownEnd: true,
      }) as Record<string, unknown>,
      ...makeSequenceEventFields({ stateBefore: currentState, stateAfter: state }),
      expectedPreviousSequence: currentSequence,
      clientMutationId: meta.clientMutationId,
      clientCreatedAt: Date.now(),
      createdAt: serverTimestamp(),
    });
    transaction.set(gameStateRef, {
      ...(sanitizeForFirestore(state) as Record<string, unknown>),
      updatedAt: serverTimestamp(),
      turnVersion: nextVersion,
      lastSequence: nextSequence,
      lastClientMutationId: meta.clientMutationId,
    }, { merge: true });
    transaction.set(roomRef, {
      gamePreparedAt: serverTimestamp(),
      gamePreparedStartRequestVersion: meta.startRequestVersion,
      gamePreparedStartRequestId: meta.startRequestId,
    }, { merge: true });
    transaction.set(processedActionRef, {
      clientMutationId: meta.clientMutationId,
      startRequestVersion: meta.startRequestVersion,
      startRequestId: meta.startRequestId,
      sequence: nextSequence,
      turnVersion: nextVersion,
      type: 'game_initialized',
      actorId: meta.actorId,
      createdAt: serverTimestamp(),
    });
    return { status: 'committed' as const, turnVersion: nextVersion, lastSequence: nextSequence };
  });
}

export async function activatePreparedRoomGame(roomId: string, identity: GameStartRequestIdentity): Promise<boolean> {
  if (!db || !roomId) return false;
  const roomRef = doc(db, 'rooms', roomId);
  const gameStateRef = doc(db, 'rooms', roomId, 'state', 'current');

  return runTransaction(db, async (transaction) => {
    const roomSnapshot = await transaction.get(roomRef);
    const gameStateSnapshot = await transaction.get(gameStateRef);
    if (!roomSnapshot.exists() || !gameStateSnapshot.exists()) return false;

    const room = roomSnapshot.data() as Omit<RoomSummary, 'id'>;
    const state = gameStateSnapshot.data() as SyncedGameState;
    if (!isCurrentStartRequest(room, identity) || !isPreparedForRequest(state, identity)) return false;
    if (room.status === 'playing' && room.startStatus === 'playing') return true;

    const countdownEndsAt = Number(room.startCountdownEndsAt ?? room.startCountdownUntil ?? 0);
    const requestCanBeActivated = room.status === 'waiting'
      && room.startStatus === 'requested'
      && isRoomGameActivationWindowOpen(countdownEndsAt)
      && !isCancelledStartRequest(room);
    if (!requestCanBeActivated) return false;

    transaction.set(roomRef, {
      status: 'playing',
      startStatus: 'playing',
      startCountdownUntil: 0,
      gameActivatedAt: serverTimestamp(),
    }, { merge: true });
    return true;
  });
}
