const RETRYABLE_ROOM_DELETION_CODES = new Set([
  'aborted',
  'failed-precondition',
]);

export type RoomDeletionRetryOptions = {
  maxAttempts?: number;
  delayMs?: (failedAttempt: number) => number;
  sleep?: (delayMs: number) => Promise<void>;
};

const normalizeErrorCode = (error: unknown) => {
  if (!error || typeof error !== 'object' || !('code' in error)) return '';
  const code = String((error as { code?: unknown }).code ?? '').trim().toLowerCase();
  return code.includes('/') ? code.slice(code.lastIndexOf('/') + 1) : code;
};

export function isRoomDeletionContentionError(error: unknown) {
  return RETRYABLE_ROOM_DELETION_CODES.has(normalizeErrorCode(error));
}

export async function retryRoomDeletionContention<T>(
  operation: (attempt: number) => Promise<T>,
  options: RoomDeletionRetryOptions = {},
): Promise<T> {
  const maxAttempts = Math.max(1, Math.floor(options.maxAttempts ?? 3));
  const sleep = options.sleep ?? ((delayMs: number) => new Promise<void>((resolve) => setTimeout(resolve, delayMs)));

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      if (!isRoomDeletionContentionError(error) || attempt >= maxAttempts) throw error;
      const delayMs = Math.max(0, Number(options.delayMs?.(attempt) ?? attempt * 100));
      if (delayMs > 0) await sleep(delayMs);
    }
  }

  throw new Error('방 삭제 재시도 횟수를 초과했습니다.');
}
