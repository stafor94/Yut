import { connectAuthEmulator, getAuth, onAuthStateChanged, signInAnonymously, type User } from 'firebase/auth';
import { firebaseApp, isFirebaseEmulatorMode } from './firebaseApp';

export const auth = firebaseApp ? getAuth(firebaseApp) : null;

if (auth && isFirebaseEmulatorMode) {
  const emulatorUrl = String(import.meta.env.VITE_FIREBASE_AUTH_EMULATOR_URL ?? 'http://127.0.0.1:9099');
  const url = new URL(emulatorUrl);
  if (!['127.0.0.1', 'localhost'].includes(url.hostname)) throw new Error(`잘못된 Auth emulator endpoint: ${emulatorUrl}`);
  connectAuthEmulator(auth, url.origin, { disableWarnings: true });
  console.info(`[QA Firebase] Auth emulator connected ${url.origin}`);
}

let guestSignInPromise: Promise<User | null> | null = null;

export async function signInAsGuest() {
  if (!auth) return null;
  if (!guestSignInPromise) {
    guestSignInPromise = signInAnonymously(auth)
      .then((result) => result.user)
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
