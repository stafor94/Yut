import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { collection, endAt, getDocs, orderBy, query, startAt, where } from 'firebase/firestore';
import { deleteRoomForQa, getTestDb } from './rooms.js';

const roomCapacityConfig = JSON.parse(fs.readFileSync(new URL('../../src/features/room/services/roomCapacityConfig.json', import.meta.url), 'utf8'));
const qaRoomLimit = Number(roomCapacityConfig.qaRoomLimit ?? 8);
const qaRunId = String(process.env.QA_RUN_ID ?? '').trim();
const cleanupMode = String(process.env.QA_CLEANUP_MODE ?? 'current-run').trim();
const workflowPrefix = String(process.env.QA_WORKFLOW_PREFIX ?? '').trim();
const orphanMaxAgeMs = Number(process.env.QA_ORPHAN_MAX_AGE_MS ?? 2 * 60 * 60 * 1000);
const shouldReportRemainingRooms = process.env.QA_CLEANUP_REPORT_REMAINING === '1';
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
    roomKind: String(data.roomKind ?? ''),
    qaRunId: String(data.qaRunId ?? ''),
    qaRole: String(data.qaRole ?? ''),
    isQaRoom: data.isQaRoom === true,
    qaCreatedAt: data.qaCreatedAt,
    createdAt: data.createdAt,
    lastActivityAt: data.lastActivityAt,
    status: String(data.status ?? ''),
    currentPlayers: Number(data.currentPlayers ?? 0),
    systemRoomType: String(data.systemRoomType ?? ''),
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

function isConfirmedQaRoom(room) {
  return !room.systemRoomType && (
    room.roomKind === 'qa'
    || room.isQaRoom
    || Boolean(room.qaRunId)
    || room.title.startsWith('QA-')
  );
}

function getRoomCreatedAt(room) {
  return getTimestampMillis(room.qaCreatedAt)
    || getTimestampMillis(room.createdAt)
    || getTimestampMillis(room.lastActivityAt);
}

function isCurrentWorkflowRoom(room) {
  if (!workflowPrefix) return false;
  return room.qaRunId.startsWith(workflowPrefix);
}

function isOldQaRoom(room, now = Date.now()) {
  const createdAt = getRoomCreatedAt(room);
  return createdAt > 0 && now - createdAt >= orphanMaxAgeMs;
}

function isInactiveQaRoom(room) {
  return room.status === 'finished' || room.currentPlayers <= 0;
}

function sortNewestFirst(rooms) {
  return [...rooms].sort((left, right) => getRoomCreatedAt(right) - getRoomCreatedAt(left));
}

async function getCurrentRunRooms(db) {
  const snapshot = await getDocs(query(collection(db, 'rooms'), where('qaRunId', '==', qaRunId)));
  return snapshot.docs.map(normalizeRoom).filter(isConfirmedQaRoom);
}

async function getQaRoomCandidates(db) {
  const [kindSnapshot, flaggedSnapshot, titledSnapshot] = await Promise.all([
    getDocs(query(collection(db, 'rooms'), where('roomKind', '==', 'qa'))),
    getDocs(query(collection(db, 'rooms'), where('isQaRoom', '==', true))),
    getDocs(query(collection(db, 'rooms'), orderBy('title'), startAt('QA-'), endAt(`QA-\uf8ff`))),
  ]);
  const rooms = new Map();
  [...kindSnapshot.docs, ...flaggedSnapshot.docs, ...titledSnapshot.docs].forEach((documentSnapshot) => {
    const room = normalizeRoom(documentSnapshot);
    if (isConfirmedQaRoom(room)) rooms.set(room.id, room);
  });
  return [...rooms.values()];
}

function getOrphanTargets(candidates, now = Date.now()) {
  const sorted = sortNewestFirst(candidates);
  const overflowIds = new Set(sorted.slice(qaRoomLimit).map((room) => room.id));
  return sorted.filter((room) => (
    isCurrentWorkflowRoom(room)
    || isOldQaRoom(room, now)
    || isInactiveQaRoom(room)
    || overflowIds.has(room.id)
  ));
}

async function getCleanupTargets(db) {
  if (cleanupMode === 'current-run') return getCurrentRunRooms(db);
  if (cleanupMode === 'orphans') return getOrphanTargets(await getQaRoomCandidates(db));
  throw new Error(`지원하지 않는 QA_CLEANUP_MODE입니다: ${cleanupMode}`);
}

async function findRemainingTargets(db) {
  if (cleanupMode === 'current-run') return getCurrentRunRooms(db);
  return getOrphanTargets(await getQaRoomCandidates(db));
}

async function validateQaRoomLimit(db) {
  const candidates = await getQaRoomCandidates(db);
  if (candidates.length > qaRoomLimit) {
    const details = sortNewestFirst(candidates)
      .map((room) => `${room.id}:${room.title || '제목 없음'}:${room.qaRunId || 'run 없음'}`)
      .join(', ');
    throw new Error(`QA room limit exceeded: count=${candidates.length}, limit=${qaRoomLimit}, rooms=${details}`);
  }
  return candidates.length;
}

async function cleanupQaRooms() {
  if (!qaRunId) throw new Error('QA_RUN_ID 없이 QA cleanup을 실행할 수 없습니다.');
  if (!Number.isFinite(orphanMaxAgeMs) || orphanMaxAgeMs < 60_000) throw new Error(`잘못된 QA_ORPHAN_MAX_AGE_MS: ${orphanMaxAgeMs}`);
  if (!Number.isInteger(qaRoomLimit) || qaRoomLimit < 1) throw new Error(`잘못된 QA room limit: ${qaRoomLimit}`);
  const db = await getTestDb();
  if (!db) throw new Error('Firebase 설정이 없습니다.');

  const qaRooms = await getCleanupTargets(db);
  console.log(`QA cleanup mode=${cleanupMode}, namespace=${qaRunId}, workflowPrefix=${workflowPrefix || '없음'}, rooms=${qaRooms.length}, limit=${qaRoomLimit}`);
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
  const remainingQaCount = await validateQaRoomLimit(db);
  if (shouldReportRemainingRooms || remainingRooms.length > 0) {
    console.log(`cleanup-after mode=${cleanupMode}, remaining=${remainingRooms.length}, qaRoomCount=${remainingQaCount}`);
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
