export const AUTHORITATIVE_COMMIT_TIMEOUT_MS = 10000;
export const AUTHORITATIVE_COMMIT_RECOVERY_TIMEOUT_MS = 2500;
export const AUTHORITATIVE_ITEM_TIMEOUT_REASON = '서버 응답 시간이 초과되었습니다. 최신 상태로 다시 동기화합니다.';

const ITEM_ACTION_TYPES = new Set(['use_item', 'place_trap', 'item_pickup_decision']);

type AuthoritativeCommitResultShape = {
  status: string;
  sequence?: number;
  turnVersion?: number;
  reason?: string;
};

type ProcessedActionShape = {
  sequence: number;
  turnVersion: number;
} | null;

export class AuthoritativeCommitTimeoutError extends Error {
  readonly actionType: string;

  constructor(actionType: string) {
    super(`authoritative ${actionType} 요청 시간이 초과되었습니다.`);
    this.name = 'AuthoritativeCommitTimeoutError';
    this.actionType = actionType;
  }
}

const withTimeout = <T>(promise: Promise<T>, timeoutMs: number, makeError: () => Error) => new Promise<T>((resolve, reject) => {
  let settled = false;
  const timer = setTimeout(() => {
    if (settled) return;
    settled = true;
    reject(makeError());
  }, Math.max(0, timeoutMs));

  promise.then((value) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    resolve(value);
  }, (error) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    reject(error);
  });
});

const maybeReturnQaStatelessDuplicateMoveAck = <T extends AuthoritativeCommitResultShape>(actionType: string, result: T): T => {
  const qa = globalThis as typeof globalThis & {
    __YUT_QA_STATELESS_DUPLICATE_MOVE_ACK_COUNT__?: unknown;
    __YUT_QA_STATELESS_DUPLICATE_MOVE_ACK_USED__?: unknown;
  };
  const remaining = Math.max(0, Math.trunc(Number(qa.__YUT_QA_STATELESS_DUPLICATE_MOVE_ACK_COUNT__ ?? 0)));
  const sequence = Number(result.sequence ?? 0);
  if (actionType !== 'move_piece' || remaining <= 0 || !Number.isFinite(sequence) || sequence <= 0) return result;
  qa.__YUT_QA_STATELESS_DUPLICATE_MOVE_ACK_COUNT__ = remaining - 1;
  qa.__YUT_QA_STATELESS_DUPLICATE_MOVE_ACK_USED__ = Number(qa.__YUT_QA_STATELESS_DUPLICATE_MOVE_ACK_USED__ ?? 0) + 1;
  return { status: 'duplicate', sequence, turnVersion: result.turnVersion } as T;
};

export async function settleAuthoritativeCommit<T extends AuthoritativeCommitResultShape>(options: {
  actionType: string;
  commit: () => Promise<T>;
  recoverProcessed?: () => Promise<ProcessedActionShape>;
  timeoutMs?: number;
  recoveryTimeoutMs?: number;
}): Promise<T> {
  const timeoutMs = options.timeoutMs ?? AUTHORITATIVE_COMMIT_TIMEOUT_MS;
  const recoveryTimeoutMs = options.recoveryTimeoutMs ?? AUTHORITATIVE_COMMIT_RECOVERY_TIMEOUT_MS;

  try {
    const result = await withTimeout(
      Promise.resolve().then(options.commit),
      timeoutMs,
      () => new AuthoritativeCommitTimeoutError(options.actionType),
    );
    return maybeReturnQaStatelessDuplicateMoveAck(options.actionType, result);
  } catch (error) {
    if (!(error instanceof AuthoritativeCommitTimeoutError)) throw error;

    let processedAction: ProcessedActionShape = null;
    if (options.recoverProcessed) {
      try {
        processedAction = await withTimeout(
          Promise.resolve().then(options.recoverProcessed),
          recoveryTimeoutMs,
          () => new AuthoritativeCommitTimeoutError(`${options.actionType}:recovery`),
        );
      } catch {
        processedAction = null;
      }
    }

    if (processedAction && processedAction.sequence > 0) {
      return {
        status: 'duplicate',
        sequence: processedAction.sequence,
        turnVersion: processedAction.turnVersion,
      } as T;
    }

    if (ITEM_ACTION_TYPES.has(options.actionType)) {
      return {
        status: 'rejected',
        reason: AUTHORITATIVE_ITEM_TIMEOUT_REASON,
      } as T;
    }

    throw error;
  }
}
