import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import type { User } from 'firebase/auth';
import { GameBoard, type BoardPiece } from '../features/game/components/GameBoard';
import { ItemCard } from '../features/items/components/ItemCard';
import type { ItemType } from '../features/items/logic/items';
import { ITEM_DEFINITIONS } from '../features/items/logic/items';
import { BOARD_NODES, spawnInitialBoardItems, type BoardItem } from '../game-core/board/board';
import { createRoom, deleteRoom, subscribeRoom, updateRoomOptions, type RoomSummary } from '../features/room/services/roomService';
import { useRooms } from '../features/room/hooks/useRooms';
import { isFirebaseConfigured } from '../services/firebase/firebaseApp';
import { listenAuthState, signInAsGuest } from '../services/firebase/firebaseAuth';
import '../styles/globals.css';

type Screen = 'lobby' | 'waitingRoom' | 'countdown' | 'game';
type PlayMode = 'individual' | 'team';
type Team = '청팀' | '홍팀';
type PieceCount = 1 | 2 | 3 | 4;

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
type ToastMessage = { id: number; text: string };
type RollAnimation = { id: number; result: YutResult; sticks: boolean[] };

const PLAYER_COLORS = ['#d94a38', '#3a78c2', '#2f9e6f', '#d6a11d'];
const STORAGE_KEYS = { nickname: 'yut-online:nickname', title: 'yut-online:title' } as const;
const getStoredText = (key: string, fallback: string) => {
  if (typeof window === 'undefined') return fallback;
  return window.localStorage.getItem(key) || fallback;
};
const TURN_DELAY_MS = 650;
const STEP_DELAY_MS = 240;
const delay = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

const YUT_RESULTS = [
  { name: '도', steps: 1 },
  { name: '개', steps: 2 },
  { name: '걸', steps: 3 },
  { name: '윷', steps: 4, bonus: true },
  { name: '모', steps: 5, bonus: true },
];
type YutResult = typeof YUT_RESULTS[number];

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

const makePieces = (seats: Seat[], pieceCount: PieceCount): BoardPiece[] => seats.filter((seat) => !seat.isEmpty).flatMap((seat, index) =>
  Array.from({ length: pieceCount }, (_, pieceIndex) => ({
    id: `${seat.id}-piece-${pieceIndex + 1}`,
    ownerId: seat.id,
    label: `${seat.label}-${pieceIndex + 1}`,
    color: PLAYER_COLORS[index] ?? '#2a1e17',
    nodeIndex: 0,
    started: false,
    finished: false,
  })),
);

export function App() {
  const [user, setUser] = useState<User | null>(null);
  const [nickname, setNickname] = useState(() => getStoredText(STORAGE_KEYS.nickname, '플레이어'));
  const [title, setTitle] = useState(() => getStoredText(STORAGE_KEYS.title, '친구들과 윷놀이'));
  const [playMode, setPlayMode] = useState<PlayMode>('individual');
  const [maxPlayers, setMaxPlayers] = useState<2 | 3 | 4>(4);
  const [itemMode, setItemMode] = useState(true);
  const [pieceCount, setPieceCount] = useState<PieceCount>(4);
  const [message, setMessage] = useState('');
  const [screen, setScreen] = useState<Screen>('lobby');
  const [activeRoomTitle, setActiveRoomTitle] = useState('');
  const [activeRoomId, setActiveRoomId] = useState('');
  const [isRoomHost, setIsRoomHost] = useState(false);
  const [countdown, setCountdown] = useState(3);
  const [seats, setSeats] = useState<Seat[]>(() => createSeats('플레이어', 'individual', 4));
  const [pieces, setPieces] = useState<BoardPiece[]>(() => makePieces(createSeats('플레이어', 'individual', 4), 4));
  const [boardItems, setBoardItems] = useState<BoardItem[]>([]);
  const [ownedItems, setOwnedItems] = useState<ItemType[]>([]);
  const [revealedItems, setRevealedItems] = useState<ItemType[]>([]);
  const [selectedPieceId, setSelectedPieceId] = useState('host-piece-1');
  const [turnIndex, setTurnIndex] = useState(0);
  const [roll, setRoll] = useState<YutResult | null>(null);
  const [movingPieceId, setMovingPieceId] = useState('');
  const [logs, setLogs] = useState<GameLog[]>([]);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [highlightedNodeId, setHighlightedNodeId] = useState('');
  const [rollAnimation, setRollAnimation] = useState<RollAnimation | null>(null);
  const rooms = useRooms();
  const serverStatus = isFirebaseConfigured ? (user ? '정상' : '연결 중') : '설정 필요';
  const serverStatusTone = isFirebaseConfigured ? (user ? 'online' : 'pending') : 'offline';
  const playableSeats = useMemo(() => seats.filter((seat) => !seat.isEmpty), [seats]);
  const teamCounts = useMemo(() => playableSeats.reduce<Record<Team, number>>((acc, seat) => ({ ...acc, [seat.team]: acc[seat.team] + 1 }), { 청팀: 0, 홍팀: 0 }), [playableSeats]);
  const teamBalanced = playMode === 'individual' || (maxPlayers === 4 && teamCounts.청팀 === 2 && teamCounts.홍팀 === 2);
  const allReady = seats.every((seat) => !seat.isEmpty && (seat.ready || seat.isAI)) && teamBalanced;
  const activeSeat = playableSeats[turnIndex % playableSeats.length];
  const isMyTurn = activeSeat?.id === 'host' && !activeSeat.isAI;
  const winner = useMemo(() => {
    if (playMode === 'team') {
      const finishedTeam = (['청팀', '홍팀'] as Team[]).find((team) => playableSeats.filter((seat) => seat.team === team).every((seat) => pieces.filter((piece) => piece.ownerId === seat.id).every((piece) => piece.finished)));
      return finishedTeam ? `${finishedTeam} 승리` : '';
    }
    const finishedSeat = playableSeats.find((seat) => pieces.filter((piece) => piece.ownerId === seat.id).every((piece) => piece.finished));
    return finishedSeat ? `${finishedSeat.label} 승리` : '';
  }, [pieces, playMode, playableSeats]);

  useEffect(() => {
    const unsubscribe = listenAuthState(setUser);
    signInAsGuest().catch((error) => setMessage(error.message));
    return unsubscribe;
  }, []);


  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEYS.nickname, nickname);
  }, [nickname]);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEYS.title, title);
  }, [title]);

  useEffect(() => {
    if (!activeRoomId) return undefined;
    return subscribeRoom(activeRoomId, (room: RoomSummary | null) => {
      if (!room) {
        setScreen('lobby');
        setActiveRoomId('');
        setActiveRoomTitle('');
        setIsRoomHost(false);
        setMessage('방장이 나가서 방이 폭파되었습니다. 대기실로 이동했습니다.');
        return;
      }
      setActiveRoomTitle(room.title);
      setPlayMode(room.playMode);
      setMaxPlayers(room.maxPlayers as 2 | 3 | 4);
      setItemMode(room.itemMode);
      setPieceCount(room.pieceCount ?? 4);
    });
  }, [activeRoomId]);

  useEffect(() => {
    if (playMode === 'team' && maxPlayers !== 4) setMaxPlayers(4);
  }, [maxPlayers, playMode]);

  useEffect(() => {
    if (screen !== 'game' || winner || !activeSeat || isMyTurn || roll || movingPieceId) return undefined;
    const timer = window.setTimeout(() => { void autoPlayTurn(activeSeat); }, TURN_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [activeSeat, isMyTurn, movingPieceId, pieces, roll, screen, winner]);

  useEffect(() => {
    if (screen !== 'countdown') return undefined;
    if (countdown === 0) { startLocalGame(); return undefined; }
    const timer = window.setTimeout(() => setCountdown((current) => current - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [countdown, screen]);

  async function handleCreateRoom() {
    if (!user) { setMessage('Firebase 익명 로그인 완료 후 다시 시도하세요.'); return; }
    try {
      const roomId = await createRoom({ title, hostId: user.uid, nickname, maxPlayers, itemMode, playMode, pieceCount });
      openWaitingRoom({ id: roomId, title, itemMode, maxPlayers, playMode, pieceCount }, `${title} 방이 생성되었습니다. 옵션을 확인하고 모두 준비되면 시작하세요.`, true);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '방 생성 실패');
    }
  }

  function openWaitingRoom(room: Pick<RoomSummary, 'title' | 'itemMode' | 'maxPlayers' | 'playMode' | 'pieceCount'> & { id?: string }, nextMessage = '', asHost = false) {
    setActiveRoomId(room.id ?? '');
    setIsRoomHost(asHost);
    setActiveRoomTitle(room.title);
    setPlayMode(room.playMode);
    setMaxPlayers(room.maxPlayers as 2 | 3 | 4);
    setItemMode(room.itemMode);
    setPieceCount(room.pieceCount ?? 4);
    const nextSeats = createSeats(nickname, room.playMode, room.maxPlayers as 2 | 3 | 4);
    setSeats(nextSeats);
    setScreen('waitingRoom');
    setMessage(nextMessage);
  }

  function handleStartGame() {
    if (!allReady) { setMessage(playMode === 'team' && !teamBalanced ? '팀전은 4인전만 가능하며 청팀 2명, 홍팀 2명이어야 시작할 수 있습니다.' : '아직 준비하지 않은 플레이어가 있습니다.'); return; }
    setCountdown(3); setScreen('countdown'); setMessage('');
  }

  function startLocalGame() {
    const nextPieces = makePieces(playableSeats, pieceCount);
    setPieces(nextPieces);
    setBoardItems(itemMode ? spawnInitialBoardItems(4, 8) : []);
    setOwnedItems([]); setRevealedItems([]); setSelectedPieceId(nextPieces[0]?.id ?? ''); setMovingPieceId(''); setTurnIndex(0); setRoll(null);
    setLogs([{ id: Date.now(), text: '게임이 시작되었습니다. 윷을 던져주세요.' }]);
    setScreen('game');
  }

  function addLog(text: string) { setLogs((current) => [{ id: Date.now(), text }, ...current]); }
  function showToast(text: string) {
    const nextToast = { id: Date.now(), text };
    setToast(nextToast);
    window.setTimeout(() => setToast((current) => current?.id === nextToast.id ? null : current), 2400);
  }
  function makeRollSticks(result: YutResult) {
    const flatCount = result.name === '모' ? 0 : result.steps;
    return Array.from({ length: 4 }, (_, index) => index < flatCount);
  }
  function markPlayerAsAI(playerId: string) { setSeats((currentSeats) => currentSeats.map((seat) => seat.id === playerId ? { ...seat, name: seat.isEmpty ? `${seat.label} AI` : `${seat.name} AI`, ready: true, isAI: true, isEmpty: false } : seat)); }
  function changeTeam(playerId: string, team: Team) { setSeats((currentSeats) => currentSeats.map((seat) => seat.id === playerId ? { ...seat, team } : seat)); }
  function rollYutFor(seat: Seat) {
    const nextRoll = YUT_RESULTS[Math.floor(Math.random() * YUT_RESULTS.length)];
    setRoll(nextRoll);
    setRollAnimation({ id: Date.now(), result: nextRoll, sticks: makeRollSticks(nextRoll) });
    window.setTimeout(() => setRollAnimation(null), 1900);
    addLog(`${seat.label}이(가) ${nextRoll.name}(${nextRoll.steps}칸)를 던졌습니다.`);
    return nextRoll;
  }
  function rollYut() { if (!activeSeat || !isMyTurn || movingPieceId) return; rollYutFor(activeSeat); }

  async function movePiece(pieceId: string, result: YutResult, seat: Seat, extraSteps = 0) {
    if (winner || movingPieceId) return;
    const movingPiece = pieces.find((piece) => piece.id === pieceId && piece.ownerId === seat.id && !piece.finished);
    if (!movingPiece) { setTurnIndex((current) => (current + 1) % playableSeats.length); setRoll(null); return; }
    const steps = Math.max(0, result.steps + extraSteps);
    setMovingPieceId(pieceId);
    let nextNodeIndex = movingPiece.nodeIndex;
    for (let step = 0; step < steps; step += 1) {
      nextNodeIndex += 1;
      const finished = nextNodeIndex >= 20;
      setPieces((currentPieces) => currentPieces.map((piece) => piece.id === pieceId ? { ...piece, nodeIndex: finished ? 20 : nextNodeIndex, started: true, finished } : piece));
      await delay(STEP_DELAY_MS);
      if (finished) break;
    }
    const landedNode = BOARD_NODES[Math.min(nextNodeIndex, BOARD_NODES.length - 1)];
    const landedItem = boardItems.find((item) => item.nodeId === landedNode?.id);
    if (landedItem) {
      setOwnedItems((items) => [...items, landedItem.type]);
      setRevealedItems((items) => Array.from(new Set([...items, landedItem.type])));
      setBoardItems((items) => items.filter((item) => item.id !== landedItem.id));
      const itemName = ITEM_DEFINITIONS[landedItem.type].name;
      addLog(`${seat.label}이(가) 아이템 '${itemName}'을 획득했습니다.`);
      showToast(`${seat.label} 아이템 획득! ${itemName}`);
      setHighlightedNodeId(landedNode?.id ?? '');
      window.setTimeout(() => setHighlightedNodeId((current) => current === landedNode?.id ? '' : current), 1400);
    }
    if (nextNodeIndex >= 20) addLog(`${seat.label} 말이 완주했습니다!`);
    if (result.bonus) addLog(`${result.name}이므로 한 번 더 던질 수 있습니다.`); else setTurnIndex((current) => (current + 1) % playableSeats.length);
    setMovingPieceId('');
    setRoll(null);
  }

  function moveSelectedPiece(extraSteps = 0) {
    if (!roll || !activeSeat || !isMyTurn) return;
    const selectedPiece = pieces.find((piece) => piece.id === selectedPieceId && piece.ownerId === activeSeat.id && !piece.finished);
    const fallbackPiece = pieces.find((piece) => piece.ownerId === activeSeat.id && !piece.finished);
    if (!selectedPiece && fallbackPiece) setSelectedPieceId(fallbackPiece.id);
    if (!selectedPiece && !fallbackPiece) return;
    void movePiece((selectedPiece ?? fallbackPiece)?.id ?? selectedPieceId, roll, activeSeat, extraSteps);
  }

  async function autoPlayTurn(seat: Seat) {
    const playablePiece = pieces.find((piece) => piece.ownerId === seat.id && !piece.finished);
    if (!playablePiece) { setTurnIndex((current) => (current + 1) % playableSeats.length); return; }
    const nextRoll = rollYutFor(seat);
    await delay(TURN_DELAY_MS);
    await movePiece(playablePiece.id, nextRoll, seat);
  }

  function useItem(type: ItemType) {
    if (!ownedItems.includes(type)) return;
    setOwnedItems((items) => { const copy = [...items]; copy.splice(copy.indexOf(type), 1); return copy; });
    if (type === 'golden_yut') { setRoll({ name: '황금 윷', steps: 4, bonus: true }); addLog('황금 윷으로 4칸 이동 결과를 선택했습니다.'); return; }
    if (type === 'reroll') { if (activeSeat) rollYutFor(activeSeat); return; }
    if (type === 'move_plus_one') { moveSelectedPiece(1); return; }
    if (type === 'move_minus_one') { moveSelectedPiece(-1); return; }
    addLog(`${ITEM_DEFINITIONS[type].name} 아이템을 사용했습니다.`);
  }

  async function leaveRoom() {
    if (isRoomHost && activeRoomId) await deleteRoom(activeRoomId);
    setScreen('lobby'); setActiveRoomId(''); setActiveRoomTitle(''); setIsRoomHost(false); setCountdown(3); setSeats(createSeats(nickname, playMode, maxPlayers));
    setMessage(isRoomHost ? '방장이 나가서 방이 폭파되었습니다.' : '방에서 나왔습니다.');
  }

  function finishGame() { setScreen('lobby'); setActiveRoomTitle(''); setActiveRoomId(''); setIsRoomHost(false); setCountdown(3); setSeats(createSeats(nickname, playMode, maxPlayers)); setMessage('게임이 종료되어 첫 대기화면으로 돌아왔습니다.'); }

  async function changeWaitingOptions(next: { itemMode?: boolean; pieceCount?: PieceCount }) {
    const nextItemMode = next.itemMode ?? itemMode;
    const nextPieceCount = next.pieceCount ?? pieceCount;
    setItemMode(nextItemMode);
    setPieceCount(nextPieceCount);
    if (isRoomHost && activeRoomId) await updateRoomOptions(activeRoomId, { itemMode: nextItemMode, pieceCount: nextPieceCount });
  }

  return <main className={`shell ${screen === 'game' ? 'game-shell' : 'lobby-shell'}`}>
    <section className="hero panel">
      <div className="hero-copy"><h1 className="brand-title">YUT ONLINE</h1></div>
      <div className="hero-actions"><div className={`status-card ${serverStatusTone}`} aria-label={`서버 상태: ${serverStatus}`}><span className={`status-dot ${serverStatusTone}`} aria-hidden="true"></span><strong>서버</strong><span>{serverStatus}</span></div></div>
    </section>

    {screen === 'lobby' && <section className="lobby-layout" aria-label="첫 대기 화면">
      <section className="panel room-panel"><p className="section-kicker">방 만들기</p><h2>새 방 설정</h2><div className="form-grid"><label>닉네임<input value={nickname} onChange={(e) => setNickname(e.target.value)} placeholder="닉네임" /></label><label>방 제목<input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="방 제목" /></label><label>진행 방식<select value={playMode} onChange={(e) => setPlayMode(e.target.value as PlayMode)}><option value="individual">개인전</option><option value="team">팀전</option></select></label><label>인원<select value={maxPlayers} onChange={(e) => setMaxPlayers(Number(e.target.value) as 2 | 3 | 4)} disabled={playMode === 'team'}><option value={2}>2인</option>{playMode === 'individual' && <option value={3}>3인</option>}<option value={4}>4인</option></select></label><label>말 개수<select value={pieceCount} onChange={(e) => setPieceCount(Number(e.target.value) as PieceCount)}><option value={1}>1개</option><option value={2}>2개</option><option value={3}>3개</option><option value={4}>4개</option></select></label><label className="check-row"><input type="checkbox" checked={itemMode} onChange={(e) => setItemMode(e.target.checked)} /> 아이템 모드</label><button onClick={handleCreateRoom}>방 만들기</button></div>{message && <p className="notice">{message}</p>}</section>
      <section className="panel room-panel"><p className="section-kicker">방 참여</p><h2>대기중 방</h2><div className="room-list">{rooms.length ? rooms.map((room) => <article className="room-card" key={room.id}><div><b>{room.title}</b><span>{room.playMode} · 말 {room.pieceCount ?? 4}개 · {room.itemMode ? '아이템 ON' : '아이템 OFF'} · {room.maxPlayers}인</span></div><button onClick={() => openWaitingRoom(room)}>참여</button></article>) : <span>방 목록이 비어있거나 Firebase 환경변수가 없습니다.</span>}</div></section>
    </section>}

    {screen === 'waitingRoom' && <section className="panel waiting-room" aria-label="방 대기 화면"><p className="section-kicker">게임 시작 대기</p><h2>{playMode === 'team' ? '팀을 고르고 인원을 맞춰주세요' : '모두 준비되면 방장이 시작합니다'}</h2>{message && <p className="notice">{message}</p>}<div className="mode-summary"><b>{playMode === 'team' ? '팀전' : '개인전'}</b><span>{maxPlayers}인</span><span>말 {pieceCount}개</span><span>{itemMode ? '아이템 ON' : '아이템 OFF'}</span>{playMode === 'team' && <span>청팀 {teamCounts.청팀}명 / 홍팀 {teamCounts.홍팀}명</span>}</div>{isRoomHost && <div className="host-room-options"><label>말 개수<select value={pieceCount} onChange={(e) => changeWaitingOptions({ pieceCount: Number(e.target.value) as PieceCount })}><option value={1}>1개</option><option value={2}>2개</option><option value={3}>3개</option><option value={4}>4개</option></select></label><label className="check-row"><input type="checkbox" checked={itemMode} onChange={(e) => changeWaitingOptions({ itemMode: e.target.checked })} /> 아이템전</label></div>}<div className="ready-list">{seats.map((seat) => <article className={`ready-card ${seat.isAI ? 'ai' : ''} ${seat.isEmpty ? 'empty' : ''}`} key={seat.id}><b>{seat.label}</b><span>{seat.name}</span>{playMode === 'team' && <select value={seat.team} onChange={(e) => changeTeam(seat.id, e.target.value as Team)}><option value="청팀">청팀</option><option value="홍팀">홍팀</option></select>}<em>{seat.isAI ? 'AI 대체' : seat.isEmpty ? '빈 자리' : seat.ready ? '준비 완료' : '준비 중'}</em>{seat.isHost && <small>방장</small>}{seat.isEmpty && <button className="mini-button" onClick={() => markPlayerAsAI(seat.id)}>AI로 채우기</button>}</article>)}</div>{playMode === 'team' && !teamBalanced && <p className="notice warning">팀전은 4인전만 가능하며 청팀 2명, 홍팀 2명이어야 시작할 수 있습니다.</p>}<div className="waiting-actions"><button onClick={handleStartGame} disabled={!allReady}>게임 시작</button><button className="secondary" onClick={leaveRoom}>방 나가기</button></div></section>}

    {screen === 'countdown' && <section className="panel countdown-panel" aria-label="게임 시작 카운트다운"><p>게임 시작까지</p><strong>{countdown}</strong><span>모든 플레이어 화면이 곧 게임으로 이동합니다.</span></section>}

    {toast && <div className="toast-message" role="status" aria-live="polite">{toast.text}</div>}

    {screen === 'game' && <section className="game-layout" aria-label="게임 플레이 화면">
      <aside className="panel players"><h2>플레이어</h2>{playableSeats.map((seat) => <div className={`player ${seat.isAI ? 'ai' : ''} ${activeSeat?.id === seat.id ? 'active' : ''}`} key={seat.id}><b>{seat.label}</b><span>{seat.color} 말 {pieceCount}개 · {seat.name}</span>{playMode === 'team' && <small>{seat.team}</small>}<em>{seat.isAI ? 'AI 플레이' : activeSeat?.id === seat.id ? '현재 턴' : '대기'}</em>{!seat.isHost && !seat.isAI && <button className="mini-button" onClick={() => markPlayerAsAI(seat.id)}>나감 처리</button>}</div>)}<div className="player-items"><h2>보유 아이템</h2>{ownedItems.length ? <div className="item-grid">{ownedItems.map((type, index) => <button className="item-button" key={`${type}-${index}`} onClick={() => useItem(type)}><ItemCard type={type} /></button>)}</div> : <p className="empty-state">보유한 아이템이 없습니다.</p>}</div><button className="secondary end-game" onClick={finishGame}>게임 종료</button></aside>
      <section className="panel board-panel"><GameBoard pieces={pieces} items={boardItems} selectedPieceId={selectedPieceId} movingPieceId={movingPieceId} onSelectPiece={setSelectedPieceId} revealedItems={revealedItems} highlightedNodeId={highlightedNodeId} />{rollAnimation && <div className="roll-stage" role="status" aria-live="polite"><div className="roll-mat"><span className="roll-label">{rollAnimation.result.name}</span>{rollAnimation.sticks.map((flat, index) => <span key={`${rollAnimation.id}-${index}`} className={`yut-stick ${flat ? 'flat' : 'round'}`} style={{ '--stick-index': index } as CSSProperties}><i></i></span>)}</div></div>}<div className="play-controls"><strong>{winner || `${activeSeat?.label} 턴`}</strong><span>{roll ? `${roll.name} · ${roll.steps}칸` : '윷을 던져주세요'}</span><button onClick={rollYut} disabled={!isMyTurn || Boolean(roll) || Boolean(winner) || Boolean(movingPieceId)}>윷 던지기</button><button className="secondary" onClick={() => moveSelectedPiece()} disabled={!isMyTurn || !roll || Boolean(winner) || Boolean(movingPieceId)}>선택한 말 이동</button></div></section>
      <aside className="panel side"><h2>진행 기록</h2><div className="log-list">{logs.map((log) => <p key={log.id}>{log.text}</p>)}</div></aside>
    </section>}
  </main>;
}
