import type { User } from 'firebase/auth';
import type { RoomSummary } from '../../features/room/services/roomService';

type LobbyScreenProps = {
  title: string;
  rooms: RoomSummary[];
  isCreatingRoom: boolean;
  isFirebaseConfigured: boolean;
  currentUser: User | null;
  onTitleChange: (title: string) => void;
  onCreateRoom: () => void;
  onOpenWaitingRoom: (room: RoomSummary) => void;
};

export function LobbyScreen({ title, rooms, isCreatingRoom, isFirebaseConfigured, currentUser, onTitleChange, onCreateRoom, onOpenWaitingRoom }: LobbyScreenProps) {
  return <section className="lobby-layout premium-lobby" aria-label="첫 대기 화면">
    <section className="panel room-panel create-room-panel">
      <div className="lobby-panel-heading create-room-heading">
        <p className="section-kicker">방 만들기</p>
        <button data-testid="create-room-button" className="primary-cta create-room-heading-button" onClick={onCreateRoom} disabled={isCreatingRoom}>{isCreatingRoom ? <span className="button-loading" aria-hidden="true"></span> : null}{isCreatingRoom ? '생성 중...' : '방 만들기'}</button>
      </div>
      <div className="form-grid lobby-form">
        <label>방 제목<input data-testid="room-title-input" value={title} onChange={(event) => onTitleChange(event.target.value)} placeholder="방 제목" /></label>
      </div>
    </section>
    <section className="panel room-panel join-room-panel">
      <div className="lobby-panel-heading">
        <p className="section-kicker">방 참여</p>
      </div>
      <div className="room-list lobby-room-list">{rooms.length ? rooms.map((room) => <article className="room-card lobby-room-card" key={room.id}><div className="lobby-room-content"><div className="lobby-room-main"><b>{room.title}</b><span className="lobby-room-meta">{room.playMode === 'team' ? '팀전' : '개인전'} · {room.currentPlayers ?? 0}/{room.maxPlayers} · 말 {room.pieceCount ?? 4}개 · {room.itemMode ? '아이템 ON' : '아이템 OFF'}</span></div><div className="lobby-room-side"><span className="lobby-room-status">대기중</span><button className="lobby-room-action" disabled={isFirebaseConfigured && !currentUser} onClick={() => onOpenWaitingRoom(room)}>{isFirebaseConfigured && !currentUser ? '준비 중' : room.status === 'playing' ? '관전' : '참여'}</button></div></div></article>) : <div className="empty-lobby-room"><strong>아직 열린 방이 없습니다</strong></div>}</div>
    </section>
  </section>;
}
