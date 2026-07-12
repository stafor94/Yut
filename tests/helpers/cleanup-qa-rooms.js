import { collection, getDocs, query, where } from 'firebase/firestore';
import { deleteRoomForQa, getTestDb } from './rooms.js';

const qaRunId = String(process.env.QA_RUN_ID ?? '').trim();
const shouldReportRemainingRooms = process.env.QA_CLEANUP_REPORT_REMAINING === '1';

function formatDeletedCounts(deletedCounts) {
  return Object.entries(deletedCounts)
    .map(([name, count]) => `${name}:${count}`)
    .join(', ');
}

async function getCurrentRunRooms(db) {
  const snapshot = await getDocs(query(collection(db, 'rooms'), where('qaRunId', '==', qaRunId)));
  return snapshot.docs.map((documentSnapshot) => ({
    id: documentSnapshot.id,
    title: String(documentSnapshot.data().title ?? ''),
  }));
}

async function cleanupQaRooms() {
  if (!qaRunId) throw new Error('QA_RUN_ID 없이 QA cleanup을 실행할 수 없습니다.');
  const db = await getTestDb();
  if (!db) throw new Error('격리된 QA Firebase 설정이 없습니다.');

  const qaRooms = await getCurrentRunRooms(db);
  console.log(`QA cleanup namespace=${qaRunId}, rooms=${qaRooms.length}`);
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

  const remainingRooms = await getCurrentRunRooms(db);
  if (shouldReportRemainingRooms || remainingRooms.length > 0) {
    console.log(`cleanup-after namespace=${qaRunId}, remaining=${remainingRooms.length}`);
    remainingRooms.forEach((room) => console.log(`남은 QA 방: ${room.id} (${room.title || '제목 없음'})`));
  }
  if (failures.length || remainingRooms.length) throw new Error(`QA cleanup incomplete: failures=${failures.length}, remaining=${remainingRooms.length}`);
}

cleanupQaRooms().catch((error) => {
  console.error('현재 QA run 방 정리에 실패했습니다.', error);
  process.exitCode = 1;
});
