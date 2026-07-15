import { connectAuthEmulator, getAuth, onAuthStateChanged, signInAnonymously, type User } from 'firebase/auth';
import { firebaseApp, isFirebaseEmulatorMode } from './firebaseApp';
import { getFirebaseAuthErrorCode, retryFirebaseAuthOperation } from './firebaseAuthRetry';

export const auth = firebaseApp ? getAuth(firebaseApp) : null;

if (auth && isFirebaseEmulatorMode) {
  const emulatorUrl = String(import.meta.env.VITE_FIREBASE_AUTH_EMULATOR_URL ?? 'http://127.0.0.1:9099');
  const url = new URL(emulatorUrl);
  if (!['127.0.0.1', 'localhost'].includes(url.hostname)) throw new Error(`잘못된 Auth emulator endpoint: ${emulatorUrl}`);
  connectAuthEmulator(auth, url.origin, { disableWarnings: true });
  console.info(`[QA Firebase] Auth emulator connected ${url.origin}`);
}

let guestSignInPromise: Promise<User | null> | null = null;

const normalizeGuestSignInError = (error: unknown) => {
  const code = getFirebaseAuthErrorCode(error);
  if (code === 'auth/operation-not-allowed') {
    return new Error('Firebase Anonymous Authentication이 비활성화되어 있습니다. yut-online 프로젝트의 Authentication > Sign-in method에서 익명 로그인을 활성화해주세요.');
  }
  if (code === 'auth/network-request-failed') {
    return new Error('Firebase 인증 서버에 연결하지 못했습니다. 네트워크 상태를 확인한 뒤 다시 시도해주세요.');
  }
  if (code === 'auth/the-service-is-currently-unavailable' || code === 'auth/internal-error' || code === 'auth/timeout') {
    return new Error('Firebase 인증 서버가 일시적으로 응답하지 않습니다. 잠시 후 다시 시도해주세요.');
  }
  return error instanceof Error ? error : new Error('익명 로그인에 실패했습니다.');
};

export async function signInAsGuest() {
  if (!auth) return null;
  if (!guestSignInPromise) {
    guestSignInPromise = retryFirebaseAuthOperation(
      () => signInAnonymously(auth).then((result) => result.user),
      {
        onRetry: ({ attempt, delayMs, error }) => {
          console.warn(`[Firebase Auth] 익명 로그인 일시 오류로 재시도합니다. attempt=${attempt}, delayMs=${delayMs}, code=${getFirebaseAuthErrorCode(error) || 'unknown'}`);
        },
      },
    )
      .catch((error) => {
        throw normalizeGuestSignInError(error);
      })
      .finally(() => {
        guestSignInPromise = null;
      });
  }
  return guestSignInPromise;
}

export function listenAuthState(callback: (user: User | null) => void) {
  if (!auth) {
    callback(null);
    return () => undefined;
  }
  return onAuthStateChanged(auth, callback);
}
