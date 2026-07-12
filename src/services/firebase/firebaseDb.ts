import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore';
import { firebaseApp, isFirebaseEmulatorMode } from './firebaseApp';

export const db = firebaseApp ? getFirestore(firebaseApp) : null;

if (db && isFirebaseEmulatorMode) {
  const host = String(import.meta.env.VITE_FIRESTORE_EMULATOR_HOST ?? '127.0.0.1');
  const port = Number(import.meta.env.VITE_FIRESTORE_EMULATOR_PORT ?? 8080);
  if (!['127.0.0.1', 'localhost'].includes(host) || !Number.isInteger(port) || port <= 0) {
    throw new Error(`잘못된 Firestore emulator endpoint: ${host}:${port}`);
  }
  connectFirestoreEmulator(db, host, port);
  console.info(`[QA Firebase] Firestore emulator connected ${host}:${port}`);
}
