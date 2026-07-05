import { collection, getDocs } from 'firebase/firestore';
import { deleteInactiveRoomsForQa, deleteMissingParentRoomSubcollectionsForQa, deleteRoomForQa, getTestDb, isInactiveRoom } from './rooms.js';

const QA_ROOM_TITLE_PREFIX = 'QA-';

async function cleanupQaRooms() {
  const db = await getTestDb();
  if (!db) {
    console.log('Firebase 설정이 없어 QA 방 정리를 건너뜁니다.');
    return;
  }

  const inactiveRooms = await deleteInactiveRoomsForQa();
  if (inactiveRooms.length > 0) console.log(`비활성 방 ${inactiveRooms.length}개를 정리했습니다.`);

  const orphanRoomIds = await deleteMissingParentRoomSubcollectionsForQa();
  orphanRoomIds.forEach((orphanRoom) => {
    const deletedSummary = Object.entries(orphanRoom.deletedCounts)
      .map(([name, count]) => `${name}:${count}`)
      .join(', ');
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
    if (inactiveRooms.length === 0 && orphanRoomIds.length === 0) console.log('정리할 QA/비활성/고아 방 데이터가 없습니다.');
    return;
  }

  console.log(`활성 QA 방 ${qaRooms.length}개를 정리합니다.`);
  for (const room of qaRooms) {
    const deletedCounts = await deleteRoomForQa(room.id);
    const deletedSummary = Object.entries(deletedCounts)
      .map(([name, count]) => `${name}:${count}`)
      .join(', ');
    console.log(`정리 완료: ${room.id} (${room.title})${deletedSummary ? ` - ${deletedSummary}` : ''}`);
  }
}

cleanupQaRooms().catch((error) => {
  console.error('QA 방 정리에 실패했습니다.', error);
  process.exitCode = 1;
});
