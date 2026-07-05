import type { User } from 'firebase/auth';
import type { RoomSummary } from '../../features/room/services/roomService';
import { LobbyScreen } from '../screens/LobbyScreen';

type LobbyContainerProps = {
  title: string;
  rooms: RoomSummary[];
  isCreatingRoom: boolean;
  isFirebaseConfigured: boolean;
  currentUser: User | null;
  resumableRoomId: string;
  onTitleChange: (title: string) => void;
  onCreateRoom: () => void;
  onOpenWaitingRoom: (room: RoomSummary) => Promise<void>;
};

export function LobbyContainer({
  title,
  rooms,
  isCreatingRoom,
  isFirebaseConfigured,
  currentUser,
  resumableRoomId,
  onTitleChange,
  onCreateRoom,
  onOpenWaitingRoom,
}: LobbyContainerProps) {
  return <LobbyScreen
    title={title}
    rooms={rooms}
    isCreatingRoom={isCreatingRoom}
    isFirebaseConfigured={isFirebaseConfigured}
    currentUser={currentUser}
    resumableRoomId={resumableRoomId}
    onTitleChange={onTitleChange}
    onCreateRoom={onCreateRoom}
    onOpenWaitingRoom={(room) => { void onOpenWaitingRoom(room); }}
  />;
}
