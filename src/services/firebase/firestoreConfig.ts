export const DEFAULT_FIRESTORE_DATABASE_ID = '(default)';
export const TARGET_PRODUCTION_FIRESTORE_DATABASE_ID = 'yut-prod-stafor94';

// yut-prod-stafor94에 firestore.rules가 배포되기 전까지 기존 운영 DB를 사용한다.
export const PRODUCTION_FIRESTORE_DATABASE_ID = DEFAULT_FIRESTORE_DATABASE_ID;

export function getFirestoreDatabaseId(isEmulatorMode: boolean) {
  return isEmulatorMode ? DEFAULT_FIRESTORE_DATABASE_ID : PRODUCTION_FIRESTORE_DATABASE_ID;
}
