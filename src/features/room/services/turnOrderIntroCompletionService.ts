import { doc, runTransaction, serverTimestamp } from 'firebase/firestore';
import { auth } from '../../../services/firebase/firebaseAuth';
import { db } from '../../../services/firebase/firebaseDb';
import {
  getGameCoordinatorLeaseSnapshot,
  matchesActiveGameCoordinatorLease,
} from './roomCoordinatorLease';
import {
  getClientMutationDocRef,
  makeSequenceDocId,
  sanitizeForFirestore,
} from './roomFirestore';
import {
  makeSequenceEventFields,
  type SyncedGameState,
} from './roomServiceCore';
import { getTurnOrderIntroCompletionTiming } from './roomTiming';

export async function completeTurnOrderIntroAtActionReady(
  roomId: string,
  params: { readyAt: number; actorId: string; coordinatorEpoch: number },
) {
  const firestore = db;
  if (!firestore || !roomId || !params.readyAt) return null;
  const clientMutationId = `turn_order_intro_completed:${roomId}:${params.readyAt}`;
  const processedActionRef = getClientMutationDocRef(roomId, clientMutationId);
  const gameStateRef = doc(firestore, 'rooms', roomId, 'state', 'current');

  return runTransaction(firestore, async (transaction) => {
    const processedActionSnapshot = await transaction.get(processedActionRef);
    if (processedActionSnapshot.exists()) return Number(processedActionSnapshot.data().turnVersion ?? 0);

    const snapshot = await transaction.get(gameStateRef);
    if (!snapshot.exists()) return null;
    const currentState = snapshot.data() as SyncedGameState;
    const completedAt = Date.now();
    const leaseToken = {
      coordinatorSeatId: params.actorId,
      coordinatorEpoch: params.coordinatorEpoch,
    };
    if (auth && auth.currentUser?.uid !== params.actorId) return null;
    if (!matchesActiveGameCoordinatorLease(currentState, leaseToken, completedAt)) return null;

    const currentIntro = currentState.turnOrderIntro as { readyAt?: unknown } | null | undefined;
    if (!currentIntro || Number(currentIntro.readyAt ?? 0) !== params.readyAt) {
      return Number(currentState.turnVersion ?? 0);
    }

    const currentVersion = Number(currentState.turnVersion ?? 0);
    const currentSequence = Number(currentState.lastSequence ?? 0);
    const nextVersion = currentVersion + 1;
    const nextSequence = currentSequence + 1;
    const timing = getTurnOrderIntroCompletionTiming({
      completedAt,
      turnOrderIds: currentState.turnOrderIds,
      turnIndex: currentState.turnIndex,
      turnActionTimeoutCountBySeatId: currentState.turnActionTimeoutCountBySeatId,
    });
    const statePatch = {
      turnOrderIntro: null,
      gameStartedAt: Number(currentState.gameStartedAt ?? 0) || completedAt,
      ...timing,
    };
    const coordinator = getGameCoordinatorLeaseSnapshot(currentState);
    const sequenceRef = doc(firestore, 'rooms', roomId, 'sequences', makeSequenceDocId(nextSequence));

    transaction.set(sequenceRef, {
      sequence: nextSequence,
      type: 'turn_order_intro_completed',
      actorId: params.actorId,
      coordinatorSeatId: coordinator.coordinatorSeatId,
      coordinatorEpoch: coordinator.coordinatorEpoch,
      payload: sanitizeForFirestore({ readyAt: params.readyAt }) as Record<string, unknown>,
      ...makeSequenceEventFields({
        stateBefore: currentState,
        stateAfter: { ...currentState, ...statePatch },
        patch: statePatch,
      }),
      expectedPreviousSequence: currentSequence,
      clientMutationId,
      clientCreatedAt: completedAt,
      createdAt: serverTimestamp(),
    });
    transaction.set(gameStateRef, {
      ...(sanitizeForFirestore(statePatch) as Record<string, unknown>),
      updatedAt: serverTimestamp(),
      turnVersion: nextVersion,
      lastSequence: nextSequence,
      lastClientMutationId: clientMutationId,
    }, { merge: true });
    transaction.set(processedActionRef, {
      clientMutationId,
      sequence: nextSequence,
      turnVersion: nextVersion,
      type: 'turn_order_intro_completed',
      actorId: params.actorId,
      coordinatorSeatId: coordinator.coordinatorSeatId,
      coordinatorEpoch: coordinator.coordinatorEpoch,
      createdAt: serverTimestamp(),
    });
    return nextVersion;
  });
}
