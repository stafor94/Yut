export const DEFAULT_FIRESTORE_DATABASE_ID = '(default)';
export const TARGET_PRODUCTION_FIRESTORE_DATABASE_ID = 'yut-prod-stafor94';

export const PRODUCTION_FIRESTORE_DATABASE_ID = TARGET_PRODUCTION_FIRESTORE_DATABASE_ID;

export function getFirestoreDatabaseId(isEmulatorMode: boolean) {
  return isEmulatorMode ? DEFAULT_FIRESTORE_DATABASE_ID : PRODUCTION_FIRESTORE_DATABASE_ID;
}
