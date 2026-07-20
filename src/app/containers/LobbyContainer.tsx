import { useCallback, useEffect, useRef, useState } from 'react';
import type { User } from 'firebase/auth';
import type { RoomSummary } from '../../features/room/services/roomService';
import { LobbyScreen } from '../screens/LobbyScreen';

const ROOM_QUERY_MIN_VISIBLE_MS = 600;
const ROOM_QUERY_TIMEOUT_MS = 8_000;

type LobbyContainerProps = {
  title: string;
  rooms: RoomSummary[];
  isCreatingRoom: boolean;
  isFirebaseConfigured: boolean;
  currentUser: User | null;
  resumableRoomId: string;
  nickname: string;
  soundEnabled: boolean;
  onTitleChange: (title: string) => void;
  onCreateRoom: () => void;
  onOpenWaitingRoom: (room: RoomSummary) => Promise<void>;
  onNicknameChange: (nickname: string) => void;
  onSoundEnabledChange: (enabled: boolean) => void;
};

export function LobbyContainer({
  title,
  rooms,
  isCreatingRoom,
  isFirebaseConfigured,
  currentUser,
  resumableRoomId,
  nickname,
  soundEnabled,
  onTitleChange,
  onCreateRoom,
  onOpenWaitingRoom,
  onNicknameChange,
  onSoundEnabledChange,
}: LobbyContainerProps) {
  const [isInitialRoomQuerying, setIsInitialRoomQuerying] = useState(false);
  const roomQueryStartedAtRef = useRef(0);
  const roomQueryCompleteTimerRef = useRef<number | null>(null);
  const roomQueryTimeoutRef = useRef<number | null>(null);

  const clearRoomQueryTimers = useCallback(() => {
    if (roomQueryCompleteTimerRef.current !== null) {
      window.clearTimeout(roomQueryCompleteTimerRef.current);
      roomQueryCompleteTimerRef.current = null;
    }
    if (roomQueryTimeoutRef.current !== null) {
      window.clearTimeout(roomQueryTimeoutRef.current);
      roomQueryTimeoutRef.current = null;
    }
  }, []);

  const resetInitialRoomQuery = useCallback(() => {
    clearRoomQueryTimers();
    roomQueryStartedAtRef.current = 0;
    document.documentElement.classList.remove('yut-room-list-querying');
    setIsInitialRoomQuerying(false);
  }, [clearRoomQueryTimers]);

  const startInitialRoomQuery = useCallback(() => {
    clearRoomQueryTimers();
    roomQueryStartedAtRef.current = window.performance.now();
    document.documentElement.classList.add('yut-room-list-querying');
    setIsInitialRoomQuerying(true);
    roomQueryTimeoutRef.current = window.setTimeout(() => {
      roomQueryTimeoutRef.current = null;
      roomQueryStartedAtRef.current = 0;
      document.documentElement.classList.remove('yut-room-list-querying');
      setIsInitialRoomQuerying(false);
    }, ROOM_QUERY_TIMEOUT_MS);
    window.dispatchEvent(new Event('yut:refresh-rooms'));
  }, [clearRoomQueryTimers]);

  useEffect(() => {
    const handleRoomsRefreshed = () => {
      if (roomQueryStartedAtRef.current <= 0) return;
      const elapsed = window.performance.now() - roomQueryStartedAtRef.current;
      const remaining = Math.max(0, ROOM_QUERY_MIN_VISIBLE_MS - elapsed);
      if (roomQueryCompleteTimerRef.current !== null) window.clearTimeout(roomQueryCompleteTimerRef.current);
      roomQueryCompleteTimerRef.current = window.setTimeout(resetInitialRoomQuery, remaining);
    };

    window.addEventListener('yut:rooms-refreshed', handleRoomsRefreshed);
    return () => window.removeEventListener('yut:rooms-refreshed', handleRoomsRefreshed);
  }, [resetInitialRoomQuery]);

  useEffect(() => {
    const handleLobbyClick = (event: Event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest('button[aria-label="게임 참가"]')) {
        startInitialRoomQuery();
        return;
      }
      if (target.closest('.lobby-join-sheet .sheet-close') || (target.classList.contains('lobby-sheet-backdrop') && target.querySelector('.lobby-join-sheet'))) {
        resetInitialRoomQuery();
      }
    };

    document.addEventListener('click', handleLobbyClick, true);
    return () => {
      document.removeEventListener('click', handleLobbyClick, true);
      resetInitialRoomQuery();
    };
  }, [resetInitialRoomQuery, startInitialRoomQuery]);

  return <>
    <LobbyScreen
      title={title}
      rooms={isInitialRoomQuerying ? [] : rooms}
      isCreatingRoom={isCreatingRoom}
      isFirebaseConfigured={isFirebaseConfigured}
      currentUser={currentUser}
      resumableRoomId={resumableRoomId}
      nickname={nickname}
      soundEnabled={soundEnabled}
      onTitleChange={onTitleChange}
      onCreateRoom={onCreateRoom}
      onOpenWaitingRoom={onOpenWaitingRoom}
      onNicknameChange={onNicknameChange}
      onSoundEnabledChange={onSoundEnabledChange}
    />
    {isInitialRoomQuerying && <div className="join-room-query-status" data-testid="room-list-loading" role="status" aria-live="polite">
      <span className="join-room-query-spinner" aria-hidden="true"></span>
      <strong>방 목록 조회 중</strong>
      <p>조회가 끝나면 참가 가능한 방을 보여드릴게요.</p>
    </div>}
  </>;
}
