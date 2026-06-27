import { useEffect, useMemo, useState } from 'react';
import type { User } from 'firebase/auth';
import { GameBoard, type BoardPiece } from '../features/game/components/GameBoard';
import { ItemCard } from '../features/items/components/ItemCard';
import type { ItemType } from '../features/items/logic/items';
import { ITEM_DEFINITIONS } from '../features/items/logic/items';
import { BOARD_NODES, spawnInitialBoardItems, type BoardItem } from '../game-core/board/board';
import { createRoom } from '../features/room/services/roomService';
import { useRooms } from '../features/room/hooks/useRooms';
import { isFirebaseConfigured } from '../services/firebase/firebaseApp';
import { listenAuthState, signInAsGuest } from '../services/firebase/firebaseAuth';
import '../styles/globals.css';

type Screen = 'lobby' | 'waitingRoom' | 'countdown' | 'game';
type PlayMode = 'individual' | 'team';
type Team = '청팀' | '홍팀';

type Seat = {
  id: string;
  label: string;
  name: string;
  color: string;
  ready: boolean;
  isHost?: boolean;
  isAI?: boolean;
  isEmpty?: boolean;
  team: Team;
};

type GameLog = { id: number; text: string };

const PLAYER_COLORS = ['#d94a38', '#3a78c2', '#2f9e6f', '#d6a11d'];
const YUT_RESULTS = [
  { name: '도', steps: 1 },
  { name: '개', steps: 2 },
  { name: '걸', steps: 3 },
  { name: '윷', steps: 4, bonus: true },
  { name: '모', steps: 5, bonus: true },
];

const createSeats = (hostName: string, playMode: PlayMode, playerCount: 2 | 3 | 4): Seat[] => {
  const defaultTeams: Team[] = playMode === 'team' ? ['청팀', '홍팀', '청팀', '홍팀'] : ['청팀', '청팀', '청팀', '청팀'];

  return Array.from({ length: playerCount }, (_, index) => ({
    id: index === 0 ? 'host' : `slot-${index + 1}`,
    label: `P${index + 1}`,
    name: index === 0 ? hostName || '플레이어' : '빈 자리',
    color: ['빨강', '파랑', '초록', '노랑'][index] ?? '검정',
    ready: index === 0,
    isHost: index === 0,
    isEmpty: index !== 0,
    team: defaultTeams[index] ?? '청팀',
  }));
};

const makePieces = (seats: Seat[]): BoardPiece[] => seats.filter((seat) => !seat.isEmpty).map((seat, index) => ({
  id: seat.id,
  label: seat.label,
  color: PLAYER_COLORS[index] ?? '#2a1e17',
  nodeIndex: 0,
  finished: false,
}));

export function App() {
  const [user, setUser] = useState<User | null>(null);
  const [nickname, setNickname] = useState('플레이어');
  const [title, setTitle] = useState('친구들과 윷놀이');
  const [playMode, setPlayMode] = useState<PlayMode>('individual');
  const [maxPlayers, setMaxPlayers] = useState<2 | 3 | 4>(4);
  const [itemMode, setItemMode] = useState(true);
  const [message, setMessage] = useState('');
  const [screen, setScreen] = useState<Screen>('lobby');
  const [activeRoomTitle, setActiveRoomTitle] = useState('');
  const [countdown, setCountdown] = useState(3);
  const [seats, setSeats] = useState<Seat[]>(() => createSeats('플레이어', 'individual', 4));
  const [pieces, setPieces] = useState<BoardPiece[]>(() => makePieces(createSeats('플레이어', 'individual', 4)));
  const [boardItems, setBoardItems] = useState<BoardItem[]>([]);
  const [ownedItems, setOwnedItems] = useState<ItemType[]>([]);
  const [revealedItems, setRevealedItems] = useState<ItemType[]>([]);
  const [selectedPieceId, setSelectedPieceId] = useState('host');
  const [turnIndex, setTurnIndex] = useState(0);
  const [roll, setRoll] = useState<typeof YUT_RESULTS[number] | null>(null);
  const [logs, setLogs] = useState<GameLog[]>([]);
  const rooms = useRooms();
  const serverStatus = isFirebaseConfigured ? (user ? '정상' : '연결 중') : '설정 필요';
  const serverStatusTone = isFirebaseConfigured ? (user ? 'online' : 'pending') : 'offline';
  const playableSeats = useMemo(() => seats.filter((seat) => !seat.isEmpty), [seats]);
  const teamCounts = useMemo(() => playableSeats.reduce<Record<Team, number>>((acc, seat) => ({ ...acc, [seat.team]: acc[seat.team] + 1 }), { 청팀: 0, 홍팀: 0 }), [playableSeats]);
  const teamBalanced = playMode === 'individual' || (maxPlayers === 4 && teamCounts.청팀 === 2 && teamCounts.홍팀 === 2);
  const allReady = seats.every((seat) => !seat.isEmpty && (seat.ready || seat.isAI)) && teamBalanced;
  const activeSeat = playableSeats[turnIndex % playableSeats.length];
  const winner = useMemo(() => {
    if (playMode === 'team') {
      const finishedTeam = (['청팀', '홍팀'] as Team[]).find((team) => playableSeats.filter((seat) => seat.team === team).every((seat) => pieces.find((piece) => piece.id === seat.id)?.finished));
      return finishedTeam ? `${finishedTeam} 승리` : '';
    }
    return pieces.find((piece) => piece.finished)?.label ? `${pieces.find((piece) => piece.finished)?.label} 승리` : '';
  }, [pieces, playMode, playableSeats]);

  useEffect(() => {
    const unsubscribe = listenAuthState(setUser);
    signInAsGuest().catch((error) => setMessage(error.message));
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (playMode === 'team' && maxPlayers !== 4) setMaxPlayers(4);
  }, [maxPlayers, playMode]);

  useEffect(() => {
    if (screen !== 'countdown') return undefined;
    if (countdown === 0) { startLocalGame(); return undefined; }
    const timer = window.setTimeout(() => setCountdown((current) => current - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [countdown, screen]);

  async function handleCreateRoom() {
    if (!user) { setMessage('Firebase 익명 로그인 완료 후 다시 시도하세요.'); return; }
    try {
      await createRoom({ title, hostId: user.uid, nickname, maxPlayers, itemMode, playMode });
      openWaitingRoom(title, `${title} 방이 생성되었습니다. 옵션을 확인하고 모두 준비되면 시작하세요.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '방 생성 실패');
    }
  }

  function openWaitingRoom(roomTitle: string, nextMessage = '') {
    setActiveRoomTitle(roomTitle);
    const nextSeats = createSeats(nickname, playMode, maxPlayers);
    setSeats(nextSeats);
    setScreen('waitingRoom');
    setMessage(nextMessage);
  }

  function handleStartGame() {
    if (!allReady) { setMessage(playMode === 'team' && !teamBalanced ? '팀전은 4인전만 가능하며 청팀 2명, 홍팀 2명이어야 시작할 수 있습니다.' : '아직 준비하지 않은 플레이어가 있습니다.'); return; }
    setCountdown(3); setScreen('countdown'); setMessage('');
  }

  function startLocalGame() {
    const nextPieces = makePieces(playableSeats);
    setPieces(nextPieces);
    setBoardItems(itemMode ? spawnInitialBoardItems(4, 8) : []);
    setOwnedItems([]); setRevealedItems([]); setSelectedPieceId(nextPieces[0]?.id ?? ''); setTurnIndex(0); setRoll(null);
    setLogs([{ id: Date.now(), text: '게임이 시작되었습니다. 윷을 던져주세요.' }]);
    setScreen('game');
  }

  function addLog(text: string) { setLogs((current) => [{ id: Date.now(), text }, ...current].slice(0, 8)); }
  function markPlayerAsAI(playerId: string) { setSeats((currentSeats) => currentSeats.map((seat) => seat.id === playerId ? { ...seat, name: seat.isEmpty ? `${seat.label} AI` : `${seat.name} AI`, ready: true, isAI: true, isEmpty: false } : seat)); }
  function changeTeam(playerId: string, team: Team) { setSeats((currentSeats) => currentSeats.map((seat) => seat.id === playerId ? { ...seat, team } : seat)); }
  function rollYut() { const nextRoll = YUT_RESULTS[Math.floor(Math.random() * YUT_RESULTS.length)]; setRoll(nextRoll); addLog(`${activeSeat.label}이(가) ${nextRoll.name}(${nextRoll.steps}칸)를 던졌습니다.`); }

  function moveSelectedPiece(extraSteps = 0) {
    if (!roll || winner) return;
    const steps = Math.max(0, roll.steps + extraSteps);
    setPieces((currentPieces) => currentPieces.map((piece) => {
      if (piece.id !== selectedPieceId || piece.finished) return piece;
      const nextIndex = piece.nodeIndex + steps;
      const finished = nextIndex >= 20;
      return { ...piece, nodeIndex: finished ? 20 : nextIndex, finished };
    }));
    const nextNodeIndex = (pieces.find((piece) => piece.id === selectedPieceId)?.nodeIndex ?? 0) + steps;
    const landedNode = BOARD_NODES[Math.min(nextNodeIndex, BOARD_NODES.length - 1)];
    const landedItem = boardItems.find((item) => item.nodeId === landedNode?.id);
    if (landedItem) {
      setOwnedItems((items) => [...items, landedItem.type]);
      setRevealedItems((items) => Array.from(new Set([...items, landedItem.type])));
      setBoardItems((items) => items.filter((item) => item.id !== landedItem.id));
      addLog(`${activeSeat.label}이(가) 아이템 '${ITEM_DEFINITIONS[landedItem.type].name}'을 획득했습니다.`);
    }
    if (nextNodeIndex >= 20) addLog(`${activeSeat.label} 말이 완주했습니다!`);
    if (roll.bonus) addLog(`${roll.name}이므로 한 번 더 던질 수 있습니다.`); else setTurnIndex((current) => (current + 1) % playableSeats.length);
    setRoll(null);
  }

  function useItem(type: ItemType) {
    if (!ownedItems.includes(type)) return;
    setOwnedItems((items) => { const copy = [...items]; copy.splice(copy.indexOf(type), 1); return copy; });
    if (type === 'golden_yut') { setRoll({ name: '황금 윷', steps: 4, bonus: true }); addLog('황금 윷으로 4칸 이동 결과를 선택했습니다.'); return; }
    if (type === 'reroll') { rollYut(); return; }
    if (type === 'move_plus_one') { moveSelectedPiece(1); return; }
    if (type === 'move_minus_one') { moveSelectedPiece(-1); return; }
    addLog(`${ITEM_DEFINITIONS[type].name} 아이템을 사용했습니다.`);
  }

  function finishGame() { setScreen('lobby'); setActiveRoomTitle(''); setCountdown(3); setSeats(createSeats(nickname, playMode, maxPlayers)); setMessage('게임이 종료되어 첫 대기화면으로 돌아왔습니다.'); }

  return <main className={`shell ${screen === 'game' ? 'game-shell' : 'lobby-shell'}`}>
    <section className="hero panel">
      <div className="hero-copy"><p className="eyebrow">YUT ONLINE</p><h1>{screen === 'lobby' ? '빠르고 깔끔한 온라인 윷놀이' : activeRoomTitle}</h1>{screen !== 'game' && <p>방 옵션을 고르고 친구를 초대한 뒤, 모두 준비되면 바로 시작하세요.</p>}</div>
      <div className="hero-actions"><div className={`status-card ${serverStatusTone}`} aria-label={`서버 상태: ${serverStatus}`}><span className={`status-dot ${serverStatusTone}`} aria-hidden="true"></span><strong>서버</strong><span>{serverStatus}</span></div></div>
    </section>

    {screen === 'lobby' && <section className="lobby-layout" aria-label="첫 대기 화면">
      <section className="panel room-panel"><p className="section-kicker">방 만들기</p><h2>새 방 설정</h2><div className="form-grid"><label>닉네임<input value={nickname} onChange={(e) => setNickname(e.target.value)} placeholder="닉네임" /></label><label>방 제목<input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="방 제목" /></label><label>진행 방식<select value={playMode} onChange={(e) => setPlayMode(e.target.value as PlayMode)}><option value="individual">개인전</option><option value="team">팀전</option></select></label><label>인원<select value={maxPlayers} onChange={(e) => setMaxPlayers(Number(e.target.value) as 2 | 3 | 4)} disabled={playMode === 'team'}><option value={2}>2인</option>{playMode === 'individual' && <option value={3}>3인</option>}<option value={4}>4인</option></select></label><label className="check-row"><input type="checkbox" checked={itemMode} onChange={(e) => setItemMode(e.target.checked)} /> 아이템 모드</label><button onClick={handleCreateRoom}>방 만들기</button></div>{message && <p className="notice">{message}</p>}</section>
      <section className="panel room-panel"><p className="section-kicker">방 참여</p><h2>대기중 방</h2><div className="room-list">{rooms.length ? rooms.map((room) => <article className="room-card" key={room.id}><div><b>{room.title}</b><span>{room.playMode} · {room.itemMode ? '아이템 ON' : '아이템 OFF'} · {room.maxPlayers}인</span></div><button onClick={() => openWaitingRoom(room.title)}>참여</button></article>) : <span>방 목록이 비어있거나 Firebase 환경변수가 없습니다.</span>}</div></section>
    </section>}

    {screen === 'waitingRoom' && <section className="panel waiting-room" aria-label="방 대기 화면"><p className="section-kicker">게임 시작 대기</p><h2>{playMode === 'team' ? '팀을 고르고 인원을 맞춰주세요' : '모두 준비되면 방장이 시작합니다'}</h2>{message && <p className="notice">{message}</p>}<div className="mode-summary"><b>{playMode === 'team' ? '팀전' : '개인전'}</b><span>{maxPlayers}인</span><span>{itemMode ? '아이템 ON' : '아이템 OFF'}</span>{playMode === 'team' && <span>청팀 {teamCounts.청팀}명 / 홍팀 {teamCounts.홍팀}명</span>}</div><div className="ready-list">{seats.map((seat) => <article className={`ready-card ${seat.isAI ? 'ai' : ''} ${seat.isEmpty ? 'empty' : ''}`} key={seat.id}><b>{seat.label}</b><span>{seat.name}</span>{playMode === 'team' && <select value={seat.team} onChange={(e) => changeTeam(seat.id, e.target.value as Team)}><option value="청팀">청팀</option><option value="홍팀">홍팀</option></select>}<em>{seat.isAI ? 'AI 대체' : seat.isEmpty ? '빈 자리' : seat.ready ? '준비 완료' : '준비 중'}</em>{seat.isHost && <small>방장</small>}{seat.isEmpty && <button className="mini-button" onClick={() => markPlayerAsAI(seat.id)}>AI로 채우기</button>}</article>)}</div>{playMode === 'team' && !teamBalanced && <p className="notice warning">팀전은 4인전만 가능하며 청팀 2명, 홍팀 2명이어야 시작할 수 있습니다.</p>}<div className="waiting-actions"><button onClick={handleStartGame} disabled={!allReady}>게임 시작</button><button className="secondary" onClick={() => setScreen('lobby')}>방 나가기</button></div></section>}

    {screen === 'countdown' && <section className="panel countdown-panel" aria-label="게임 시작 카운트다운"><p>게임 시작까지</p><strong>{countdown}</strong><span>모든 플레이어 화면이 곧 게임으로 이동합니다.</span></section>}

    {screen === 'game' && <section className="game-layout" aria-label="게임 플레이 화면">
      <aside className="panel players"><h2>플레이어</h2>{playableSeats.map((seat) => <div className={`player ${seat.isAI ? 'ai' : ''} ${activeSeat?.id === seat.id ? 'active' : ''}`} key={seat.id}><b>{seat.label}</b><span>{seat.color} 말 · {seat.name}</span>{playMode === 'team' && <small>{seat.team}</small>}<em>{seat.isAI ? 'AI 플레이' : activeSeat?.id === seat.id ? '현재 턴' : '대기'}</em>{!seat.isHost && !seat.isAI && <button className="mini-button" onClick={() => markPlayerAsAI(seat.id)}>나감 처리</button>}</div>)}<button className="secondary end-game" onClick={finishGame}>게임 종료</button></aside>
      <section className="panel board-panel"><GameBoard pieces={pieces} items={boardItems} selectedPieceId={selectedPieceId} onSelectPiece={setSelectedPieceId} revealedItems={revealedItems} /><div className="play-controls"><strong>{winner || `${activeSeat?.label} 턴`}</strong><span>{roll ? `${roll.name} · ${roll.steps}칸` : '윷을 던져주세요'}</span><button onClick={rollYut} disabled={Boolean(roll) || Boolean(winner)}>윷 던지기</button><button className="secondary" onClick={() => moveSelectedPiece()} disabled={!roll || Boolean(winner)}>선택한 말 이동</button></div></section>
      <aside className="panel side"><h2>보유 아이템</h2>{ownedItems.length ? <div className="item-grid">{ownedItems.map((type, index) => <button className="item-button" key={`${type}-${index}`} onClick={() => useItem(type)}><ItemCard type={type} /></button>)}</div> : <p className="empty-state">보유한 아이템이 없습니다.</p>}<h2>진행 기록</h2><div className="log-list">{logs.map((log) => <p key={log.id}>{log.text}</p>)}</div></aside>
    </section>}
  </main>;
}
