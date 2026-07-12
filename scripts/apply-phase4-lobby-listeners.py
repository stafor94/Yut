from pathlib import Path


def replace_once(path: Path, old: str, new: str, label: str) -> None:
    source = path.read_text()
    count = source.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected 1 match, found {count}')
    path.write_text(source.replace(old, new, 1))


app = Path('src/app/App.tsx')
replace_once(
    app,
    '  const rooms = useRooms();',
    "  const rooms = useRooms({ enabled: screen === 'lobby' });",
    'lobby-only useRooms call',
)

room_service = Path('src/features/room/services/roomService.ts')
replace_once(
    room_service,
    """  return onSnapshot(roomsQuery, (snapshot) => {
    const now = Date.now();
    const rooms = snapshot.docs
      .map((roomDoc) => ({ id: roomDoc.id, ref: roomDoc.ref, hasPendingWrites: roomDoc.metadata.hasPendingWrites, ...(roomDoc.data() as Omit<RoomSummary, 'id'>) }))
      .filter((room) => {
        const inactive = isInactiveRoom(room, now);
        if (inactive && !room.hasPendingWrites) void deleteRoom(room.id).catch((error) => console.warn('비활성 방 정리에 실패했습니다.', error));
        return !inactive;
      })
      .map(({ ref: _ref, hasPendingWrites: _hasPendingWrites, ...room }) => room);
    callback(keepNewestRoomPerHost(rooms).slice(0, MAX_ACTIVE_ROOMS));
  }, () => callback([]));""",
    """  return onSnapshot(roomsQuery, (snapshot) => {
    const now = Date.now();
    const rooms = snapshot.docs
      .map((roomDoc) => ({ id: roomDoc.id, ...(roomDoc.data() as Omit<RoomSummary, 'id'>) }))
      .filter((room) => !isInactiveRoom(room, now));
    callback(keepNewestRoomPerHost(rooms).slice(0, MAX_ACTIVE_ROOMS));
  }, () => callback([]));""",
    'remove lobby listener cleanup side effect',
)

print('phase 4 lobby listener patch applied')
