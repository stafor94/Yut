export const DEFAULT_FIRESTORE_DATABASE_ID = '(default)';
export const PRODUCTION_FIRESTORE_DATABASE_ID = 'yut-prod-stafor94';

export function getFirestoreDatabaseId(isEmulatorMode: boolean) {
  return isEmulatorMode ? DEFAULT_FIRESTORE_DATABASE_ID : PRODUCTION_FIRESTORE_DATABASE_ID;
}
