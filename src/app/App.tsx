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

type Screen = 'lobby' | 'waitingRoom' | 'countdown' | 'game';

type Seat = {
  id: string;
  label: string;
  name: string;
  color: string;
  ready: boolean;
  isHost?: boolean;
  isAI?: boolean;
};

const createSeats = (hostName: string): Seat[] => [
  { id: 'host', label: 'P1', name: hostName || '플레이어', color: '빨강', ready: true, isHost: true },
  { id: 'friend-1', label: 'P2', name: '친구 1', color: '파랑', ready: true },
  { id: 'friend-2', label: 'P3', name: '친구 2', color: '초록', ready: true },
  { id: 'friend-3', label: 'P4', name: '친구 3', color: '노랑', ready: true },
];

export function App() {
  const [user, setUser] = useState<User | null>(null);
  const [nickname, setNickname] = useState('플레이어');
  const [title, setTitle] = useState('친구들과 윷놀이');
  const [message, setMessage] = useState('');
  const [screen, setScreen] = useState<Screen>('lobby');
  const [activeRoomTitle, setActiveRoomTitle] = useState('');
  const [countdown, setCountdown] = useState(3);
  const [seats, setSeats] = useState<Seat[]>(() => createSeats('플레이어'));
  const rooms = useRooms();
  const ownedItems: ItemType[] = [];
  const serverStatus = isFirebaseConfigured ? (user ? '정상' : '연결 중') : '설정 필요';
  const serverStatusTone = isFirebaseConfigured ? (user ? 'online' : 'pending') : 'offline';
  const allReady = seats.every((seat) => seat.ready || seat.isAI);

  useEffect(() => {
    const unsubscribe = listenAuthState(setUser);
    signInAsGuest().catch((error) => setMessage(error.message));
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (screen !== 'countdown') return undefined;
    if (countdown === 0) {
      setScreen('game');
      return undefined;
    }
    const timer = window.setTimeout(() => setCountdown((current) => current - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [countdown, screen]);

  async function handleCreateRoom() {
    if (!user) { setMessage('Firebase 익명 로그인 완료 후 다시 시도하세요.'); return; }
    try {
      await createRoom({ title, hostId: user.uid, nickname, maxPlayers: 4, itemMode: true, playMode: 'individual' });
      openWaitingRoom(title, `${title} 방이 생성되었습니다. 모두 준비되면 방장이 게임을 시작할 수 있습니다.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '방 생성 실패');
    }
  }

  function openWaitingRoom(roomTitle: string, nextMessage = '') {
    setActiveRoomTitle(roomTitle);
    setSeats(createSeats(nickname));
    setScreen('waitingRoom');
    setMessage(nextMessage);
  }

  function handleStartGame() {
    if (!allReady) {
      setMessage('아직 준비하지 않은 플레이어가 있습니다.');
      return;
    }
    setCountdown(3);
    setScreen('countdown');
    setMessage('');
  }

  function markPlayerAsAI(playerId: string) {
    setSeats((currentSeats) => currentSeats.map((seat) => seat.id === playerId ? { ...seat, name: `${seat.name} AI`, ready: true, isAI: true } : seat));
  }

  function finishGame() {
    setScreen('lobby');
    setActiveRoomTitle('');
    setCountdown(3);
    setSeats(createSeats(nickname));
    setMessage('게임이 종료되어 첫 대기화면으로 돌아왔습니다.');
  }

  return <main className={`shell ${screen === 'game' ? 'game-shell' : 'lobby-shell'}`}>
    <section className="hero panel">
      <div><p className="eyebrow">온라인 윷놀이</p><h1>{screen === 'lobby' ? '대기실에서 친구를 모으세요' : activeRoomTitle}</h1><p>{screen === 'game' ? '플레이 중 나간 자리는 AI가 이어받아 게임을 계속 진행합니다.' : '방을 만들거나 참여한 뒤, 모두 준비되면 방장이 게임 시작을 누릅니다.'}</p></div>
      <div className="hero-actions"><div className={`status-card ${serverStatusTone}`} aria-label={`서버 상태: ${serverStatus}`}><span className={`status-dot ${serverStatusTone}`} aria-hidden="true"></span><strong>서버 상태</strong><span>{serverStatus}</span></div></div>
    </section>

    {screen === 'lobby' && <section className="lobby-layout" aria-label="첫 대기 화면">
      <section className="panel room-panel"><p className="section-kicker">방 만들기</p><h2>새 방 설정</h2><div className="form-grid"><label>닉네임<input value={nickname} onChange={(e) => setNickname(e.target.value)} placeholder="닉네임" /></label><label>방 제목<input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="방 제목" /></label><button onClick={handleCreateRoom}>방 만들기</button></div>{message && <p className="notice">{message}</p>}</section>
      <section className="panel room-panel"><p className="section-kicker">방 참여</p><h2>대기중 방</h2><div className="room-list">{rooms.length ? rooms.map((room) => <article className="room-card" key={room.id}><div><b>{room.title}</b><span>{room.playMode} · {room.itemMode ? '아이템 ON' : '아이템 OFF'} · {room.maxPlayers}인</span></div><button onClick={() => openWaitingRoom(room.title)}>참여</button></article>) : <span>방 목록이 비어있거나 Firebase 환경변수가 없습니다.</span>}</div></section>
    </section>}

    {screen === 'waitingRoom' && <section className="panel waiting-room" aria-label="방 대기 화면">
      <p className="section-kicker">게임 시작 대기</p><h2>모두 준비되면 방장이 시작합니다</h2>{message && <p className="notice">{message}</p>}<div className="ready-list">{seats.map((seat) => <article className={`ready-card ${seat.isAI ? 'ai' : ''}`} key={seat.id}><b>{seat.label}</b><span>{seat.name}</span><em>{seat.isAI ? 'AI 대체' : seat.ready ? '준비 완료' : '준비 중'}</em>{seat.isHost && <small>방장</small>}</article>)}</div><div className="waiting-actions"><button onClick={handleStartGame} disabled={!allReady}>게임 시작</button><button className="secondary" onClick={() => setScreen('lobby')}>방 나가기</button></div></section>}

    {screen === 'countdown' && <section className="panel countdown-panel" aria-label="게임 시작 카운트다운"><p>게임 시작까지</p><strong>{countdown}</strong><span>모든 플레이어 화면이 곧 게임으로 이동합니다.</span></section>}

    {screen === 'game' && <section className="game-layout" aria-label="게임 플레이 화면">
      <aside className="panel players"><h2>플레이어</h2>{seats.map((seat, i) => <div className={`player ${seat.isAI ? 'ai' : ''}`} key={seat.id}><b>{seat.label}</b><span>{seat.color} 말 · {seat.name}</span><em>{seat.isAI ? 'AI 플레이' : i===0 ? '현재 턴' : '대기'}</em>{!seat.isHost && !seat.isAI && <button className="mini-button" onClick={() => markPlayerAsAI(seat.id)}>나감 처리</button>}</div>)}<button className="secondary end-game" onClick={finishGame}>게임 종료</button></aside>
      <section className="panel board-panel"><GameBoard /></section>
      <aside className="panel side"><h2>보유 아이템</h2>{ownedItems.length ? <div className="item-grid">{ownedItems.map((type) => <ItemCard key={type} type={type} />)}</div> : <p className="empty-state">보유한 아이템이 없습니다.</p>}</aside>
    </section>}
  </main>;
}
