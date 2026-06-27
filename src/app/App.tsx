import { useEffect, useState } from 'react';
import type { User } from 'firebase/auth';
import { GameBoard } from '../features/game/components/GameBoard';
import { ItemCard } from '../features/items/components/ItemCard';
import type { ItemType } from '../features/items/logic/items';
import { createRoom } from '../features/room/services/roomService';
import { useRooms } from '../features/room/hooks/useRooms';
import { isFirebaseConfigured } from '../services/firebase/firebaseApp';
import { listenAuthState, signInAsGuest } from '../services/firebase/firebaseAuth';
import '../styles/globals.css';

export function App() {
  const [user, setUser] = useState<User | null>(null);
  const [nickname, setNickname] = useState('플레이어');
  const [title, setTitle] = useState('친구들과 윷놀이');
  const [message, setMessage] = useState('');
  const rooms = useRooms();
  const ownedItems: ItemType[] = [];
  const serverStatus = isFirebaseConfigured ? (user ? '정상' : '연결 중') : '설정 필요';
  const serverStatusTone = isFirebaseConfigured ? (user ? 'online' : 'pending') : 'offline';

  useEffect(() => {
    const unsubscribe = listenAuthState(setUser);
    signInAsGuest().catch((error) => setMessage(error.message));
    return unsubscribe;
  }, []);

  async function handleCreateRoom() {
    if (!user) { setMessage('Firebase 익명 로그인 완료 후 다시 시도하세요.'); return; }
    try {
      await createRoom({ title, hostId: user.uid, nickname, maxPlayers: 4, itemMode: true, playMode: 'individual' });
      setMessage('방이 생성되었습니다.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '방 생성 실패');
    }
  }

  return <main className="shell">
    <section className="hero panel">
      <div><p className="eyebrow">온라인 윷놀이</p><h1>친구들과 바로 시작하세요</h1><p>닉네임과 방 제목을 입력한 뒤 방을 만들면 대기중 방 목록에서 함께 입장할 수 있습니다.</p></div>
      <div className={`status-card ${serverStatusTone}`} aria-label={`서버 상태: ${serverStatus}`}><span className={`status-dot ${serverStatusTone}`} aria-hidden="true"></span><strong>서버 상태</strong><span>{serverStatus}</span></div>
    </section>

    <section className="game-layout">
      <aside className="panel players"><h2>플레이어</h2>{['빨강','파랑','초록','노랑'].map((name, i) => <div className="player" key={name}><b>P{i+1}</b><span>{name} 말</span><em>{i===0 ? '현재 턴' : '대기'}</em></div>)}</aside>
      <section className="panel board-panel"><GameBoard /></section>
      <aside className="panel side"><h2>보유 아이템</h2>{ownedItems.length ? <div className="item-grid">{ownedItems.map((type) => <ItemCard key={type} type={type} />)}</div> : <p className="empty-state">보유한 아이템이 없습니다.</p>}</aside>
    </section>

    <section className="panel room-panel"><h2>새 방 만들기</h2><div className="form-row"><input value={nickname} onChange={(e) => setNickname(e.target.value)} placeholder="닉네임" /><input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="방 제목" /><button onClick={handleCreateRoom}>방 만들기</button></div>{message && <p className="notice">{message}</p>}<h3>대기중 방</h3><div className="room-list">{rooms.length ? rooms.map((room) => <article className="room-card" key={room.id}><b>{room.title}</b><span>{room.playMode} · {room.itemMode ? '아이템 ON' : '아이템 OFF'} · {room.maxPlayers}인</span></article>) : <span>방 목록이 비어있거나 Firebase 환경변수가 없습니다.</span>}</div></section>
  </main>;
}
