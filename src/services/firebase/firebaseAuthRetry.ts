export const DEFAULT_FIREBASE_AUTH_RETRY_DELAYS_MS = [400, 900, 1800, 3600] as const;

const TRANSIENT_FIREBASE_AUTH_ERROR_CODES = new Set([
  'auth/the-service-is-currently-unavailable',
  'auth/network-request-failed',
  'auth/internal-error',
  'auth/timeout',
]);

export function getFirebaseAuthErrorCode(error: unknown) {
  return typeof error === 'object' && error && 'code' in error ? String(error.code) : '';
}

export function isTransientFirebaseAuthError(error: unknown) {
  return TRANSIENT_FIREBASE_AUTH_ERROR_CODES.has(getFirebaseAuthErrorCode(error));
}

type FirebaseAuthRetryOptions = {
  retryDelaysMs?: readonly number[];
  wait?: (delayMs: number) => Promise<void>;
  onRetry?: (context: { attempt: number; delayMs: number; error: unknown }) => void;
};

const waitForDelay = (delayMs: number) => new Promise<void>((resolve) => {
  setTimeout(resolve, Math.max(0, delayMs));
});

export async function retryFirebaseAuthOperation<T>(
  operation: () => Promise<T>,
  options: FirebaseAuthRetryOptions = {},
) {
  const retryDelaysMs = options.retryDelaysMs ?? DEFAULT_FIREBASE_AUTH_RETRY_DELAYS_MS;
  const wait = options.wait ?? waitForDelay;
  let retryIndex = 0;

  while (true) {
    try {
      return await operation();
    } catch (error) {
      const delayMs = retryDelaysMs[retryIndex];
      if (delayMs === undefined || !isTransientFirebaseAuthError(error)) throw error;
      retryIndex += 1;
      options.onRetry?.({ attempt: retryIndex, delayMs, error });
      await wait(delayMs);
    }
  }
}
