import type { User } from 'firebase/auth';
import { getRoom, type RoomSummary } from '../../features/room/services/roomService';
import { resolveRoomCodeEntry } from '../flows/lobbyRoomEntry';
import { LobbyScreen } from '../screens/LobbyScreen';

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
  return <LobbyScreen
    title={title}
    rooms={rooms}
    isCreatingRoom={isCreatingRoom}
    isFirebaseConfigured={isFirebaseConfigured}
    currentUser={currentUser}
    resumableRoomId={resumableRoomId}
    nickname={nickname}
    soundEnabled={soundEnabled}
    onTitleChange={onTitleChange}
    onCreateRoom={onCreateRoom}
    onOpenWaitingRoom={onOpenWaitingRoom}
    onJoinRoomByCode={async (code) => {
      const room = await resolveRoomCodeEntry(code, getRoom);
      await onOpenWaitingRoom(room);
    }}
    onNicknameChange={onNicknameChange}
    onSoundEnabledChange={onSoundEnabledChange}
  />;
}
