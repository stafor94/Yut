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
  const focusCreateRoom = () => {
    document.getElementById('room-title-input')?.focus();
    document.getElementById('create-room-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const getLobbyRoomBadges = (room: RoomSummary) => getRoomRuleBadges(room.playMode, normalizeMaxPlayers(room.maxPlayers, room.playMode), room.pieceCount ?? 4, room.itemMode, Boolean(room.stackedRollMode));
  const getRoomActionText = (room: RoomSummary) => {
    if (isFirebaseConfigured && !currentUser) return '준비 중';
    if (!isRoomInGame(room)) return '참여';
    return currentUser && resumableRoomId === room.id && room.playerIds?.includes(currentUser.uid) ? '참여' : '관전';
  };

  return <section className="lobby-layout premium-lobby" aria-label="첫 대기 화면">
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
      <div className="room-list lobby-room-list">{rooms.length ? rooms.map((room) => <article className="room-card lobby-room-card" key={room.id}><div className="lobby-room-content"><div className="lobby-room-main"><b>{room.title}</b><span className="room-rule-badges lobby-room-meta" aria-label={`방 옵션: ${getLobbyRoomBadges(room).map((badge) => badge.label).join(', ')}`}>{getLobbyRoomBadges(room).map((badge) => <span key={badge.key} className={`room-rule-badge ${badge.tone}`}>{badge.label}</span>)}</span></div><div className="lobby-room-side"><span className="lobby-room-status">{isRoomInGame(room) ? '게임중' : '대기중'}</span><button className="lobby-room-action" disabled={isFirebaseConfigured && !currentUser} onClick={() => onOpenWaitingRoom(room)}>{getRoomActionText(room)}</button></div></div></article>) : <div className="empty-lobby-room"><strong>아직 열린 방이 없습니다</strong><span>친구가 만든 방이 없다면 직접 방을 만들어 시작해보세요.</span><button type="button" className="secondary empty-lobby-action" onClick={focusCreateRoom}>방 만들기</button></div>}</div>
    </section>
  </section>;
}
