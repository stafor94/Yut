import { spawnSync } from 'node:child_process';
import { collection, endAt, getDocs, orderBy, query, startAt, where } from 'firebase/firestore';
import { deleteRoomForQa, getTestDb } from './rooms.js';

const qaRunId = String(process.env.QA_RUN_ID ?? '').trim();
const cleanupMode = String(process.env.QA_CLEANUP_MODE ?? 'current-run').trim();
const workflowPrefix = String(process.env.QA_WORKFLOW_PREFIX ?? '').trim();
const orphanMaxAgeMs = Number(process.env.QA_ORPHAN_MAX_AGE_MS ?? 2 * 60 * 60 * 1000);
const shouldReportRemainingRooms = process.env.QA_CLEANUP_REPORT_REMAINING === '1';
const strictQaTitlePattern = /^QA-gh-\d+-\d+-(online-flow|roll-movement|lobby-desktop|mobile-layout)-/u;
const cleanupAuthRetryDelaysMs = [500, 1000, 2000, 4000];

function formatDeletedCounts(deletedCounts) {
  return Object.entries(deletedCounts)
    .map(([name, count]) => `${name}:${count}`)
    .join(', ');
}

function getTimestampMillis(value) {
  if (value && typeof value === 'object' && typeof value.toMillis === 'function') return value.toMillis();
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  return 0;
}

function normalizeRoom(documentSnapshot) {
  const data = documentSnapshot.data();
  return {
    id: documentSnapshot.id,
    title: String(data.title ?? ''),
    qaRunId: String(data.qaRunId ?? ''),
    isQaRoom: data.isQaRoom === true,
    qaCreatedAt: data.qaCreatedAt,
    createdAt: data.createdAt,
  };
}

function getFirebaseAuthErrorCode(error) {
  return typeof error === 'object' && error && 'code' in error ? String(error.code) : '';
}

function isTransientFirebaseAuthError(error) {
  return [
    'auth/the-service-is-currently-unavailable',
    'auth/network-request-failed',
    'auth/internal-error',
    'auth/timeout',
  ].includes(getFirebaseAuthErrorCode(error));
}

async function rerunCleanupAfterTransientAuthFailure(error) {
  const retryAttempt = Number(process.env.QA_CLEANUP_AUTH_RETRY_ATTEMPT ?? 0);
  const delayMs = cleanupAuthRetryDelaysMs[retryAttempt];
  if (!isTransientFirebaseAuthError(error) || delayMs === undefined) return false;

  console.warn(`QA cleanup Firebase 인증 일시 오류로 새 프로세스에서 재시도합니다. attempt=${retryAttempt + 1}, delayMs=${delayMs}, code=${getFirebaseAuthErrorCode(error)}`);
  await new Promise((resolve) => setTimeout(resolve, delayMs));
  const child = spawnSync(process.execPath, [process.argv[1], ...process.argv.slice(2)], {
    stdio: 'inherit',
    env: {
      ...process.env,
      QA_CLEANUP_AUTH_RETRY_ATTEMPT: String(retryAttempt + 1),
    },
  });
  if (child.error) throw child.error;
  process.exit(child.status ?? 1);
}

async function getCurrentRunRooms(db) {
  const snapshot = await getDocs(query(collection(db, 'rooms'), where('qaRunId', '==', qaRunId)));
  return snapshot.docs.map(normalizeRoom);
}

async function getQaRoomCandidates(db) {
  const [flaggedSnapshot, titledSnapshot] = await Promise.all([
    getDocs(query(collection(db, 'rooms'), where('isQaRoom', '==', true))),
    getDocs(query(collection(db, 'rooms'), orderBy('title'), startAt('QA-gh-'), endAt(`QA-gh-\uf8ff`))),
  ]);
  const rooms = new Map();
  [...flaggedSnapshot.docs, ...titledSnapshot.docs].forEach((documentSnapshot) => {
    rooms.set(documentSnapshot.id, normalizeRoom(documentSnapshot));
  });
  return [...rooms.values()];
}

function isCurrentWorkflowRoom(room) {
  if (!workflowPrefix) return false;
  return room.qaRunId.startsWith(workflowPrefix) || room.title.startsWith(`QA-${workflowPrefix}`);
}

function isConfirmedQaRoom(room) {
  return (room.isQaRoom && Boolean(room.qaRunId)) || strictQaTitlePattern.test(room.title);
}

function isOldQaRoom(room, now = Date.now()) {
  const createdAt = getTimestampMillis(room.qaCreatedAt) || getTimestampMillis(room.createdAt);
  return createdAt > 0 && now - createdAt >= orphanMaxAgeMs;
}

async function getCleanupTargets(db) {
  if (cleanupMode === 'current-run') return getCurrentRunRooms(db);
  if (cleanupMode !== 'orphans') throw new Error(`지원하지 않는 QA_CLEANUP_MODE입니다: ${cleanupMode}`);
  const candidates = await getQaRoomCandidates(db);
  return candidates.filter((room) => isConfirmedQaRoom(room) && (isCurrentWorkflowRoom(room) || isOldQaRoom(room)));
}

async function findRemainingTargets(db) {
  if (cleanupMode === 'current-run') return getCurrentRunRooms(db);
  const candidates = await getQaRoomCandidates(db);
  return candidates.filter((room) => isConfirmedQaRoom(room) && (isCurrentWorkflowRoom(room) || isOldQaRoom(room)));
}

async function cleanupQaRooms() {
  if (!qaRunId) throw new Error('QA_RUN_ID 없이 QA cleanup을 실행할 수 없습니다.');
  if (!Number.isFinite(orphanMaxAgeMs) || orphanMaxAgeMs < 60_000) throw new Error(`잘못된 QA_ORPHAN_MAX_AGE_MS: ${orphanMaxAgeMs}`);
  const db = await getTestDb();
  if (!db) throw new Error('Firebase 설정이 없습니다.');

  const qaRooms = await getCleanupTargets(db);
  console.log(`QA cleanup mode=${cleanupMode}, namespace=${qaRunId}, workflowPrefix=${workflowPrefix || '없음'}, rooms=${qaRooms.length}`);
  const failures = [];
  for (const room of qaRooms) {
    try {
      const deletedCounts = await deleteRoomForQa(room.id);
      const summary = formatDeletedCounts(deletedCounts);
      console.log(`정리 완료: ${room.id} (${room.title || '제목 없음'})${summary ? ` - ${summary}` : ''}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push(`${room.id}: ${message}`);
      console.error(`정리 실패: ${room.id} - ${message}`);
    }
  }

  const remainingRooms = await findRemainingTargets(db);
  if (shouldReportRemainingRooms || remainingRooms.length > 0) {
    console.log(`cleanup-after mode=${cleanupMode}, remaining=${remainingRooms.length}`);
    remainingRooms.forEach((room) => console.log(`남은 QA 방: ${room.id} (${room.title || '제목 없음'})`));
  }
  if (failures.length || remainingRooms.length) throw new Error(`QA cleanup incomplete: failures=${failures.length}, remaining=${remainingRooms.length}`);
}

cleanupQaRooms()
  .then(() => process.exit(0))
  .catch(async (error) => {
    try {
      if (await rerunCleanupAfterTransientAuthFailure(error)) return;
    } catch (retryError) {
      console.error('QA cleanup 재시도 프로세스 실행에 실패했습니다.', retryError);
      process.exit(1);
    }
    console.error('QA 방 정리에 실패했습니다.', error);
    process.exit(1);
  });
