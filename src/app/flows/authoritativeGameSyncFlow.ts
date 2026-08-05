import { canonicalizeTimeoutMoveAction } from '../../features/room/services/timeoutRollActionIdentity';
import { waitForNextRenderTask } from './renderTaskBoundary';

export type RoomIdRef = { current: string };

export type AuthoritativeQueueHooks<T> = {
  handleResult: (result: T) => Promise<void> | void;
  handleError: (error: unknown) => void;
  handleFinally: () => void;
};

type TimeoutMoveActionLike = {
  type?: unknown;
  payload?: Record<string, unknown>;
};

type TimeoutMoveResultLike = {
  status?: unknown;
  reason?: unknown;
};

const RECOVERABLE_TIMEOUT_MOVE_REJECTION_REASONS = new Set([
  '턴 전환 중입니다. 잠시 후 행동해주세요.',
  '말 이동 제한 시간이 만료되었습니다.',
]);

export function shouldDeferTimeoutMoveRecoveryResult(action: unknown, result: unknown) {
  if (!action || typeof action !== 'object' || !result || typeof result !== 'object') return false;
  const candidateAction = action as TimeoutMoveActionLike;
  const candidateResult = result as TimeoutMoveResultLike;
  const payload = candidateAction.payload;
  return candidateAction.type === 'move_piece'
    && payload?.deadlineAutoSubmitted === true
    && Number(payload.autoSubmittedDeadlineAt ?? 0) > 0
    && candidateResult.status === 'rejected'
    && typeof candidateResult.reason === 'string'
    && RECOVERABLE_TIMEOUT_MOVE_REJECTION_REASONS.has(candidateResult.reason);
}

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
    const committedAction = canonicalizeTimeoutMoveAction(roomId, action);
    const runCommit = () => params.commit(roomId, committedAction);
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
    applyQueue = settledApply.then(
      () => waitForRenderBoundary(),
      () => waitForRenderBoundary(),
    );
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
          if (!shouldDeferTimeoutMoveRecoveryResult(action, result)) {
            await hooks.handleResult(result);
          }
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
