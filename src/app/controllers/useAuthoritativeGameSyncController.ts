import { useCallback, useRef, useState } from 'react';
import { commitAuthoritativeGameAction, type GameAction } from '../../features/room/services/roomService';

export type AuthoritativeCommitResult = Awaited<ReturnType<typeof commitAuthoritativeGameAction>>;

type RemoteActionType = GameAction['type'];
type PendingMeta = { type?: RemoteActionType; actorId?: string; createdSequence?: number; createdTurnIndex?: number; optimisticApplied?: boolean };

type Params = {
  activeRoomIdRef: React.MutableRefObject<string>;
  applyAuthoritativeResultSequence: (result: AuthoritativeCommitResult) => Promise<unknown>;
  syncLatestAuthoritativeState: (reason: string, options?: { allowRollAnimation?: boolean; diagnosticType?: 'roll_yut' | 'move_piece' }) => Promise<boolean>;
  syncLatestSequencesFromBadge: () => Promise<void>;
  reconcilePendingLocalRemoteActions: (options?: { forceStaleClear?: boolean }) => Promise<boolean>;
  addPendingLocalRemoteAction: (actionKey: string, metadata?: PendingMeta) => void;
  acknowledgePendingLocalRemoteAction: (clientMutationId: unknown) => void;
  removeSettledPendingLocalRemoteAction: (actionKey: string) => void;
  clearPendingLocalRemoteActions: () => void;
  hasPendingCurrentTurnAction: (type: RemoteActionType, actorId?: string) => boolean;
  pendingLocalRemoteActionCount: number;
};

export function useAuthoritativeGameSyncController(params: Params) {
  const localActionCommitQueueRef = useRef<Promise<void>>(Promise.resolve());
  const localActionApplyQueueRef = useRef<Promise<void>>(Promise.resolve());
  const [manualSequenceSyncing] = useState(false);

  const commitQueuedAuthoritativeGameAction = useCallback((roomId: string, action: Omit<GameAction, 'id' | 'createdAt' | 'processed'>) => {
    const runCommit = () => commitAuthoritativeGameAction(roomId, action);
    const queuedCommit = localActionCommitQueueRef.current.then(runCommit, runCommit);
    localActionCommitQueueRef.current = queuedCommit.then(() => undefined, () => undefined);
    return queuedCommit;
  }, []);

  const enqueueAuthoritativeResultApplication = useCallback(<T,>(roomId: string, applyResult: () => Promise<T> | T): Promise<T | null> => {
    const runApply = async () => {
      if (params.activeRoomIdRef.current !== roomId) return null;
      return await applyResult();
    };
    const queuedApply = localActionApplyQueueRef.current.then(runApply, runApply);
    localActionApplyQueueRef.current = queuedApply.then(() => undefined, () => undefined);
    return queuedApply;
  }, [params.activeRoomIdRef]);

  const enqueueAuthoritativeGameAction = useCallback((
    roomId: string,
    action: Omit<GameAction, 'id' | 'createdAt' | 'processed'>,
    handleResult: (result: AuthoritativeCommitResult) => Promise<void> | void,
    handleError: (error: unknown) => void,
    handleFinally: () => void,
  ) => {
    void commitQueuedAuthoritativeGameAction(roomId, action)
      .then((result) => enqueueAuthoritativeResultApplication(roomId, async () => {
        try { await handleResult(result); }
        finally { handleFinally(); }
      }))
      .catch((error) => {
        void enqueueAuthoritativeResultApplication(roomId, () => {
          try { handleError(error); }
          finally { handleFinally(); }
        });
      });
  }, [commitQueuedAuthoritativeGameAction, enqueueAuthoritativeResultApplication]);

  return {
    commitQueuedAuthoritativeGameAction,
    enqueueAuthoritativeResultApplication,
    enqueueAuthoritativeGameAction,
    applyAuthoritativeResultSequence: params.applyAuthoritativeResultSequence,
    syncLatestAuthoritativeState: params.syncLatestAuthoritativeState,
    syncLatestSequencesFromBadge: params.syncLatestSequencesFromBadge,
    reconcilePendingLocalRemoteActions: params.reconcilePendingLocalRemoteActions,
    addPendingLocalRemoteAction: params.addPendingLocalRemoteAction,
    acknowledgePendingLocalRemoteAction: params.acknowledgePendingLocalRemoteAction,
    removeSettledPendingLocalRemoteAction: params.removeSettledPendingLocalRemoteAction,
    clearPendingLocalRemoteActions: params.clearPendingLocalRemoteActions,
    hasPendingCurrentTurnAction: params.hasPendingCurrentTurnAction,
    pendingLocalRemoteActionCount: params.pendingLocalRemoteActionCount,
    manualSequenceSyncing,
  };
}
