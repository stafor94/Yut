import type { User } from 'firebase/auth';
import { isRoomInGame, type RoomSummary } from '../../features/room/services/roomService';
import { getRoomRuleBadges, normalizeMaxPlayers } from '../appUtils';

type LobbyScreenProps = {
  title: string;
  rooms: RoomSummary[];
  isCreatingRoom: boolean;
  isFirebaseConfigured: boolean;
  currentUser: User | null;
  resumableRoomId: string;
  onTitleChange: (title: string) => void;
  onCreateRoom: () => void;
  onOpenWaitingRoom: (room: RoomSummary) => void;
};

export function LobbyScreen({ title, rooms, isCreatingRoom, isFirebaseConfigured, currentUser, resumableRoomId, onTitleChange, onCreateRoom, onOpenWaitingRoom }: LobbyScreenProps) {
  const getLobbyRoomBadges = (room: RoomSummary) => getRoomRuleBadges(room.playMode, normalizeMaxPlayers(room.maxPlayers, room.playMode), room.pieceCount ?? 4, room.itemMode, Boolean(room.stackedRollMode));
  const getLobbyRoomOccupancy = (room: RoomSummary) => {
    const maxPlayers = normalizeMaxPlayers(room.maxPlayers, room.playMode);
    const rawCurrentPlayers = Number(room.currentPlayers ?? room.playerIds?.length ?? 0);
    const currentPlayers = Number.isFinite(rawCurrentPlayers) ? Math.min(maxPlayers, Math.max(0, Math.trunc(rawCurrentPlayers))) : 0;
    return { currentPlayers, maxPlayers, label: `${currentPlayers}/${maxPlayers}명` };
  };
  const getRoomActionText = (room: RoomSummary) => {
    if (isFirebaseConfigured && !currentUser) return '준비 중';
    if (!isRoomInGame(room)) return '참여';
    return currentUser && resumableRoomId === room.id && room.playerIds?.includes(currentUser.uid) ? '참여' : '관전';
  };

  return <section data-testid="lobby-screen" className="lobby-layout premium-lobby" aria-label="첫 대기 화면">
    <section id="create-room-section" className="panel room-panel create-room-panel">
      <div className="lobby-panel-heading create-room-heading">
        <p className="section-kicker">방 만들기</p>
      </div>
      <div className="form-grid lobby-form">
        <label htmlFor="room-title-input">방 제목<input id="room-title-input" data-testid="room-title-input" value={title} onChange={(event) => onTitleChange(event.target.value)} placeholder="민초맛 삼성폰's 방" /></label>
        <button data-testid="create-room-button" className="primary-cta create-room-submit-button" onClick={onCreateRoom} disabled={isCreatingRoom}>{isCreatingRoom ? <span className="button-loading" aria-hidden="true"></span> : null}{isCreatingRoom ? '생성 중...' : '방 생성하기'}</button>
      </div>
    </section>
    <section className="panel room-panel join-room-panel">
      <div className="lobby-panel-heading">
        <p className="section-kicker">방 참여</p>
      </div>
      <div className="room-list lobby-room-list">{rooms.length ? rooms.map((room) => {
        const badges = getLobbyRoomBadges(room);
        const occupancy = getLobbyRoomOccupancy(room);
        const roomStatus = isRoomInGame(room) ? '게임중' : '대기중';
        return <article className="room-card lobby-room-card" key={room.id}>
          <div className="lobby-room-content">
            <div className="lobby-room-main">
              <div className="lobby-room-title-row">
                <span className={`lobby-room-state-dot ${isRoomInGame(room) ? 'in-game' : 'waiting'}`} role="img" aria-label={roomStatus} title={roomStatus}></span>
                <b>{room.title}</b>
              </div>
              <span className="lobby-room-meta" aria-label={`방 옵션: ${badges.map((badge) => badge.label).join(', ')}, 현재 인원 ${occupancy.currentPlayers}/${occupancy.maxPlayers}`}>{badges.map((badge) => badge.label).join(' · ')}</span>
            </div>
            <span className="lobby-room-occupancy" aria-label={`현재 인원 ${occupancy.currentPlayers}/${occupancy.maxPlayers}`}>{occupancy.label}</span>
            <button className="lobby-room-action" disabled={isFirebaseConfigured && !currentUser} onClick={() => onOpenWaitingRoom(room)}>{getRoomActionText(room)}</button>
          </div>
        </article>;
      }) : <div className="empty-lobby-room"><strong>아직 열린 방이 없습니다</strong></div>}</div>
    </section>
  </section>;
}
