import { collection, getDocs } from 'firebase/firestore';
import { deleteInactiveRoomsForQa, deleteMissingParentRoomSubcollectionsForQa, deleteRoomForQa, getTestDb, isInactiveRoom, summarizeRemainingRoomReason } from './rooms.js';

const QA_ROOM_TITLE_PREFIX = 'QA-';
const shouldReportRemainingRooms = process.env.QA_CLEANUP_REPORT_REMAINING === '1';

function formatDeletedCounts(deletedCounts) {
  return Object.entries(deletedCounts)
    .map(([name, count]) => `${name}:${count}`)
    .join(', ');
}

function summarizeRoom(room) {
  return `${room.id} (${room.title || '제목 없음'})`;
}

async function reportRemainingRooms(db, deletionFailures) {
  if (!shouldReportRemainingRooms) return;

  const snapshot = await getDocs(collection(db, 'rooms'));
  if (snapshot.empty) {
    console.log('cleanup-after 확인 결과: 남아있는 rooms 문서가 없습니다.');
    return;
  }

  console.log(`cleanup-after 확인 결과: 남아있는 rooms 문서 ${snapshot.docs.length}개`);
  snapshot.docs.forEach((documentSnapshot) => {
    const data = documentSnapshot.data();
    const title = String(data.title ?? '');
    const failureReason = deletionFailures.get(documentSnapshot.id);
    const reason = failureReason ? `삭제 시도 실패: ${failureReason}` : summarizeRemainingRoomReason(data);
    console.log(`남은 방: ${documentSnapshot.id} (${title || '제목 없음'}) - ${reason}`);
  });
}

async function cleanupQaRooms() {
  const db = await getTestDb();
  if (!db) {
    console.error('Firebase 설정이 없어 QA 방 정리를 실행할 수 없습니다.');
    process.exitCode = 1;
    return;
  }

  const deletionFailures = new Map();
  const inactiveRooms = await deleteInactiveRoomsForQa((room, error) => {
    const message = error instanceof Error ? error.message : String(error);
    deletionFailures.set(room.id, message);
    console.error(`정리 실패: ${summarizeRoom(room)} - ${message}`);
  });
  if (inactiveRooms.length > 0) console.log(`비활성/2시간 초과 방 ${inactiveRooms.length}개를 정리했습니다.`);

  const orphanRoomIds = await deleteMissingParentRoomSubcollectionsForQa();
  orphanRoomIds.forEach((orphanRoom) => {
    const deletedSummary = formatDeletedCounts(orphanRoom.deletedCounts);
    console.log(`부모 문서 없는 방 하위 컬렉션 정리 완료: ${orphanRoom.id}${deletedSummary ? ` (${deletedSummary})` : ''}`);
  });

  const snapshot = await getDocs(collection(db, 'rooms'));
  const qaRooms = snapshot.docs
    .map((documentSnapshot) => ({
      id: documentSnapshot.id,
      title: String(documentSnapshot.data().title ?? ''),
      data: documentSnapshot.data(),
    }))
    .filter((room) => room.title.startsWith(QA_ROOM_TITLE_PREFIX) && !isInactiveRoom(room.data));

  if (qaRooms.length === 0) {
    if (inactiveRooms.length === 0 && orphanRoomIds.length === 0) console.log('정리할 QA/비활성/2시간 초과/고아 방 데이터가 없습니다.');
    await reportRemainingRooms(db, deletionFailures);
    if (deletionFailures.size > 0) process.exitCode = 1;
    return;
  }

  console.log(`활성 QA 방 ${qaRooms.length}개를 정리합니다.`);
  for (const room of qaRooms) {
    try {
      const deletedCounts = await deleteRoomForQa(room.id);
      const deletedSummary = formatDeletedCounts(deletedCounts);
      console.log(`정리 완료: ${summarizeRoom(room)}${deletedSummary ? ` - ${deletedSummary}` : ''}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      deletionFailures.set(room.id, message);
      console.error(`정리 실패: ${summarizeRoom(room)} - ${message}`);
    }
  }

  await reportRemainingRooms(db, deletionFailures);
  if (deletionFailures.size > 0) process.exitCode = 1;
}

cleanupQaRooms().catch((error) => {
  console.error('QA 방 정리에 실패했습니다.', error);
  process.exitCode = 1;
});
