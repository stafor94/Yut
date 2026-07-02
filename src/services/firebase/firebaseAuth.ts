import { getAuth, onAuthStateChanged, signInAnonymously, type User } from 'firebase/auth';
import { firebaseApp } from './firebaseApp';

export const auth = firebaseApp ? getAuth(firebaseApp) : null;

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
