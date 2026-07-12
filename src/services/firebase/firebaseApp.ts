import { initializeApp, type FirebaseApp } from 'firebase/app';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

export const isFirebaseEmulatorMode = import.meta.env.VITE_FIREBASE_EMULATOR_MODE === '1';
export const firebaseQaRunId = String(import.meta.env.VITE_QA_RUN_ID ?? '').trim();
export const firebaseProjectId = String(firebaseConfig.projectId ?? '').trim();

if (isFirebaseEmulatorMode) {
  if (!/^demo-[a-z0-9-]+$/u.test(firebaseProjectId)) throw new Error(`QA Firebase projectId는 demo- namespace여야 합니다: ${firebaseProjectId || '없음'}`);
  if (!firebaseQaRunId) throw new Error('QA Firebase emulator mode에는 VITE_QA_RUN_ID가 필요합니다.');
}

export const isFirebaseConfigured = Object.values(firebaseConfig).every(Boolean);

export const firebaseApp: FirebaseApp | null = isFirebaseConfigured
  ? initializeApp(firebaseConfig)
  : null;

if (typeof window !== 'undefined' && isFirebaseEmulatorMode) {
  (window as typeof window & { __YUT_QA_FIREBASE__?: Record<string, unknown> }).__YUT_QA_FIREBASE__ = {
    emulatorMode: true,
    projectId: firebaseProjectId,
    qaRunId: firebaseQaRunId,
    firestoreHost: String(import.meta.env.VITE_FIRESTORE_EMULATOR_HOST ?? ''),
    firestorePort: Number(import.meta.env.VITE_FIRESTORE_EMULATOR_PORT ?? 0),
    authUrl: String(import.meta.env.VITE_FIREBASE_AUTH_EMULATOR_URL ?? ''),
  };
  console.info(`[QA Firebase] emulator mode project=${firebaseProjectId} run=${firebaseQaRunId}`);
}
