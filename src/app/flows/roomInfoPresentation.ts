type RoomInfoListener = () => void;

let roomInfoCollapsed = false;
const listeners = new Set<RoomInfoListener>();

export function getRoomInfoCollapsed() {
  return roomInfoCollapsed;
}

export function subscribeRoomInfoPresentation(listener: RoomInfoListener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setRoomInfoCollapsed(nextCollapsed: boolean) {
  if (roomInfoCollapsed === nextCollapsed) return;
  roomInfoCollapsed = nextCollapsed;
  listeners.forEach((listener) => listener());
}

export function toggleRoomInfoCollapsed() {
  setRoomInfoCollapsed(!roomInfoCollapsed);
}

export function resetRoomInfoCollapsed() {
  setRoomInfoCollapsed(false);
}
