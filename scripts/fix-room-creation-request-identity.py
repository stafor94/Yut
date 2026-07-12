from pathlib import Path

app_path = Path('src/app/App.tsx')
app = app_path.read_text()
old_import = "import { RoomCreationTimeoutError, createRoomRequestIdentity, isMatchingCreatedRoom, isRoomTransitionInProgress, withOperationTimeout } from './flows/roomCreationFlow';"
new_import = "import { RoomCreationTimeoutError, createRoomRequestIdentity, createRoomRequestKey, isMatchingCreatedRoom, isRoomTransitionInProgress, withOperationTimeout } from './flows/roomCreationFlow';"
assert app.count(old_import) == 1, app.count(old_import)
app = app.replace(old_import, new_import)

old_ref = "  const pendingRoomCreationRef = useRef<{ roomId: string; createRequestId: string; title: string } | null>(null);"
new_ref = "  const pendingRoomCreationRef = useRef<{ roomId: string; createRequestId: string; requestKey: string } | null>(null);"
assert app.count(old_ref) == 1
app = app.replace(old_ref, new_ref)

old_block = """  async function handleCreateRoom() {
    const normalizedTitle = title.trim();
    if (!nickname.trim()) { setMessage('닉네임을 먼저 정해주세요.'); return; }
    if (isCreatingRoom) return;
    setIsCreatingRoom(true);
    setMessage('');
    setLoadingMessage(isFirebaseConfigured && !currentUser ? '입장 준비를 마친 뒤 방을 만드는 중입니다...' : '방을 만드는 중입니다. 잠시만 기다려주세요...');
    let roomHost = userRef.current ?? currentUser;
    const existingRequest = pendingRoomCreationRef.current;
    const request = existingRequest?.title === normalizedTitle
      ? existingRequest
      : { ...createRoomRequestIdentity(typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`), title: normalizedTitle };
    pendingRoomCreationRef.current = request;
    try {
      const roomMaxPlayers = normalizeMaxPlayers(maxPlayers, playMode);
      if (roomMaxPlayers !== maxPlayers) setMaxPlayers(roomMaxPlayers);
"""
new_block = """  async function handleCreateRoom() {
    const normalizedTitle = title.trim();
    if (!nickname.trim()) { setMessage('닉네임을 먼저 정해주세요.'); return; }
    if (isCreatingRoom) return;
    const roomMaxPlayers = normalizeMaxPlayers(maxPlayers, playMode);
    const requestKey = createRoomRequestKey({
      title: normalizedTitle,
      maxPlayers: roomMaxPlayers,
      itemMode,
      stackedRollMode,
      playMode,
      pieceCount,
    });
    setIsCreatingRoom(true);
    setMessage('');
    setLoadingMessage(isFirebaseConfigured && !currentUser ? '입장 준비를 마친 뒤 방을 만드는 중입니다...' : '방을 만드는 중입니다. 잠시만 기다려주세요...');
    let roomHost = userRef.current ?? currentUser;
    const existingRequest = pendingRoomCreationRef.current;
    const request = existingRequest?.requestKey === requestKey
      ? existingRequest
      : { ...createRoomRequestIdentity(typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`), requestKey };
    pendingRoomCreationRef.current = request;
    try {
      if (roomMaxPlayers !== maxPlayers) setMaxPlayers(roomMaxPlayers);
"""
assert app.count(old_block) == 1, app.count(old_block)
app_path.write_text(app.replace(old_block, new_block))

helper_path = Path('src/app/flows/roomCreationFlow.ts')
helper = helper_path.read_text()
anchor = """export function createRoomRequestIdentity(rawToken: string) {
"""
addition = """export type RoomCreationRequestConfig = {
  title: string;
  maxPlayers: number;
  itemMode: boolean;
  stackedRollMode: boolean;
  playMode: string;
  pieceCount: number;
};

export function createRoomRequestKey(config: RoomCreationRequestConfig) {
  return JSON.stringify([
    config.title.trim(),
    config.maxPlayers,
    config.itemMode,
    config.stackedRollMode,
    config.playMode,
    config.pieceCount,
  ]);
}

export function createRoomRequestIdentity(rawToken: string) {
"""
assert helper.count(anchor) == 1
helper_path.write_text(helper.replace(anchor, addition))

service_path = Path('src/features/room/services/roomService.ts')
service = service_path.read_text()
old_active = """  const activeRoomsSnapshot = await getDocs(query(roomsRef, where('status', 'in', ['waiting', 'playing'])));
  const inactiveRoomIds: string[] = [];
"""
new_active = """  const activeRoomsSnapshot = await getDocs(query(roomsRef, where('status', 'in', ['waiting', 'playing'])));
  if (params.createRequestId) {
    const concurrentlyCommittedRoom = activeRoomsSnapshot.docs.find((roomDoc) => roomDoc.id === roomRef.id);
    if (concurrentlyCommittedRoom) {
      const room = concurrentlyCommittedRoom.data() as Omit<RoomSummary, 'id'>;
      if (room.hostId === params.hostId && room.createRequestId === params.createRequestId) return roomRef.id;
      throw new Error('같은 방 식별자가 이미 다른 요청에 사용되었습니다. 다시 시도해주세요.');
    }
  }
  const inactiveRoomIds: string[] = [];
"""
assert service.count(old_active) == 1
service_path.write_text(service.replace(old_active, new_active))

test_path = Path('tests/unit/roomCreationFlow.test.ts')
test_text = test_path.read_text()
import_old = """  createRoomRequestIdentity,
  isMatchingCreatedRoom,
"""
import_new = """  createRoomRequestIdentity,
  createRoomRequestKey,
  isMatchingCreatedRoom,
"""
assert test_text.count(import_old) == 1
test_text = test_text.replace(import_old, import_new)
test_text += """

test('재시도 식별자는 방 제목뿐 아니라 전체 생성 설정을 반영한다', () => {
  const base = {
    title: '친구들과 윷놀이',
    maxPlayers: 4,
    itemMode: true,
    stackedRollMode: false,
    playMode: 'individual',
    pieceCount: 4,
  };
  assert.equal(createRoomRequestKey(base), createRoomRequestKey({ ...base }));
  assert.notEqual(createRoomRequestKey(base), createRoomRequestKey({ ...base, itemMode: false }));
  assert.notEqual(createRoomRequestKey(base), createRoomRequestKey({ ...base, maxPlayers: 2 }));
  assert.notEqual(createRoomRequestKey(base), createRoomRequestKey({ ...base, title: '다른 방' }));
});
"""
test_path.write_text(test_text)

# validation-trigger-v2
