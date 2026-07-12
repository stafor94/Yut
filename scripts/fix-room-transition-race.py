from pathlib import Path

app_path = Path('src/app/App.tsx')
app = app_path.read_text()
old_import = "import { RoomCreationTimeoutError, createRoomRequestIdentity, isMatchingCreatedRoom, withOperationTimeout } from './flows/roomCreationFlow';"
new_import = "import { RoomCreationTimeoutError, createRoomRequestIdentity, isMatchingCreatedRoom, isRoomTransitionInProgress, withOperationTimeout } from './flows/roomCreationFlow';"
assert app.count(old_import) == 1, app.count(old_import)
app = app.replace(old_import, new_import)

old_finally = """    } finally {
      const activeRoomIsPrevious = !activeRoomIdRef.current || activeRoomIdRef.current === previousRoomId;
      if (activeRoomIdRef.current === previousRoomId) setActiveRoomId('');
      if (window.localStorage.getItem(STORAGE_KEYS.activeRoomId) === previousRoomId) window.localStorage.removeItem(STORAGE_KEYS.activeRoomId);
      if (activeRoomIsPrevious) window.localStorage.removeItem(STORAGE_KEYS.isRoomHost);
    }
"""
new_finally = """    } finally {
      const transitioningToNextRoom = isRoomTransitionInProgress(previousRoomId, nextRoomId);
      const activeRoomIsPrevious = !activeRoomIdRef.current || activeRoomIdRef.current === previousRoomId;
      if (!transitioningToNextRoom && activeRoomIdRef.current === previousRoomId) setActiveRoomId('');
      if (window.localStorage.getItem(STORAGE_KEYS.activeRoomId) === previousRoomId) window.localStorage.removeItem(STORAGE_KEYS.activeRoomId);
      if (!transitioningToNextRoom && activeRoomIsPrevious) window.localStorage.removeItem(STORAGE_KEYS.isRoomHost);
    }
"""
assert app.count(old_finally) == 1, app.count(old_finally)
app_path.write_text(app.replace(old_finally, new_finally))

helper_path = Path('src/app/flows/roomCreationFlow.ts')
helper = helper_path.read_text()
anchor = """export function isMatchingCreatedRoom(
"""
addition = """export function isRoomTransitionInProgress(previousRoomId: string, nextRoomId: string) {
  return Boolean(nextRoomId && nextRoomId !== previousRoomId);
}

export function isMatchingCreatedRoom(
"""
assert helper.count(anchor) == 1
helper_path.write_text(helper.replace(anchor, addition))

test_path = Path('tests/unit/roomCreationFlow.test.ts')
test_text = test_path.read_text()
import_old = """  isMatchingCreatedRoom,
  withOperationTimeout,
"""
import_new = """  isMatchingCreatedRoom,
  isRoomTransitionInProgress,
  withOperationTimeout,
"""
assert test_text.count(import_old) == 1
test_text = test_text.replace(import_old, import_new)
test_text += """

test('다른 방으로 전환 중인 background cleanup은 새 방 화면 상태를 지우지 않는다', () => {
  assert.equal(isRoomTransitionInProgress('room-old', 'room-new'), true);
  assert.equal(isRoomTransitionInProgress('room-old', ''), false);
  assert.equal(isRoomTransitionInProgress('room-old', 'room-old'), false);
});
"""
test_path.write_text(test_text)
