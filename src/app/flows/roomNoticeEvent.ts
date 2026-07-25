export type RoomNotice = {
  title: string;
  message: string;
};

const ROOM_NOTICE_EVENT = 'yut:room-notice';

export function publishRoomNotice(notice: RoomNotice) {
  window.dispatchEvent(new CustomEvent<RoomNotice>(ROOM_NOTICE_EVENT, { detail: notice }));
}

export function subscribeRoomNotice(listener: (notice: RoomNotice) => void) {
  const handleRoomNotice = (event: Event) => {
    if (!(event instanceof CustomEvent)) return;
    listener(event.detail as RoomNotice);
  };
  window.addEventListener(ROOM_NOTICE_EVENT, handleRoomNotice);
  return () => window.removeEventListener(ROOM_NOTICE_EVENT, handleRoomNotice);
}
