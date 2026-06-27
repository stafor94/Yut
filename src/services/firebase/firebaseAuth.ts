import { getAuth, onAuthStateChanged, signInAnonymously, type User } from 'firebase/auth';
import { firebaseApp } from './firebaseApp';

export const auth = firebaseApp ? getAuth(firebaseApp) : null;

export async function signInAsGuest() {
  if (!auth) return null;
  const result = await signInAnonymously(auth);
  return result.user;
}

export function listenAuthState(callback: (user: User | null) => void) {
  if (!auth) {
    callback(null);
    return () => undefined;
  }
  return onAuthStateChanged(auth, callback);
}
