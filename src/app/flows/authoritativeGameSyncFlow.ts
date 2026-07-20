import { waitForNextRenderTask } from './renderTaskBoundary';

export type RoomIdRef = { current: string };

export type AuthoritativeQueueHooks<T> = {
  handleResult: (result: T) => Promise<void> | void;
  handleError: (error: unknown) => void;
  handleFinally: () => void;
};

export function createAuthoritativeGameActionQueues<TAction, TResult>(params: {
  activeRoomIdRef: RoomIdRef;
  commit: (roomId: string, action: TAction) => Promise<TResult>;
  onApplySettled?: (roomId: string, appliedValue: unknown) => void;
  yieldBetweenApplies?: () => Promise<void>;
}) {
  let commitQueue: Promise<void> = Promise.resolve();
  let applyQueue: Promise<void> = Promise.resolve();

  const reset = () => {
    commitQueue = Promise.resolve();
    applyQueue = Promise.resolve();
  };

  const commitQueuedAuthoritativeGameAction = (roomId: string, action: TAction) => {
    const runCommit = () => params.commit(roomId, action);
    const queuedCommit = commitQueue.then(runCommit, runCommit);
    commitQueue = queuedCommit.then(() => undefined, () => undefined);
    return queuedCommit;
  };

  const enqueueAuthoritativeResultApplication = <T,>(roomId: string, applyResult: () => Promise<T> | T): Promise<T | null> => {
    const runApply = async () => {
      if (params.activeRoomIdRef.current !== roomId) return null;
      return await applyResult();
    };
    const notifyApplySettled = (appliedValue: unknown) => {
      try {
        params.onApplySettled?.(roomId, appliedValue);
      } catch {
        // 후속 화면 재평가 실패가 authoritative action 결과를 변경하지 않게 한다.
      }
    };
    const queuedApply = applyQueue.then(runApply, runApply);
    const settledApply = queuedApply.then(
      (appliedValue) => {
        notifyApplySettled(appliedValue);
        return appliedValue;
      },
      (error) => {
        notifyApplySettled(undefined);
        throw error;
      },
    );
    const waitForRenderBoundary = params.yieldBetweenApplies ?? waitForNextRenderTask;
    applyQueue = settledApply.then(waitForRenderBoundary, waitForRenderBoundary);
    return settledApply;
  };

  const enqueueAuthoritativeGameAction = (
    roomId: string,
    action: TAction,
    hooks: AuthoritativeQueueHooks<TResult>,
  ) => {
    void commitQueuedAuthoritativeGameAction(roomId, action)
      .then((result) => enqueueAuthoritativeResultApplication(roomId, async () => {
        try {
          await hooks.handleResult(result);
          return result;
        }
        finally { hooks.handleFinally(); }
      }))
      .catch((error) => {
        void enqueueAuthoritativeResultApplication(roomId, () => {
          try { hooks.handleError(error); }
          finally { hooks.handleFinally(); }
        });
      });
  };

  return {
    commitQueuedAuthoritativeGameAction,
    enqueueAuthoritativeResultApplication,
    enqueueAuthoritativeGameAction,
    reset,
  };
}
