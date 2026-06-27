import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import type { User } from 'firebase/auth';
import { GameBoard, type BoardPiece } from '../features/game/components/GameBoard';
import { ItemCard } from '../features/items/components/ItemCard';
import type { ItemType } from '../features/items/logic/items';
import { ITEM_DEFINITIONS } from '../features/items/logic/items';
import { BOARD_NODES, getBoardNodeById, getNextBoardNode, spawnInitialBoardItems, type BoardItem, type BranchChoice } from '../game-core/board/board';
import { createRoom, deleteRoom, subscribeRoom, updateRoomOptions, type RoomSummary } from '../features/room/services/roomService';
import { useRooms } from '../features/room/hooks/useRooms';
import { isFirebaseConfigured } from '../services/firebase/firebaseApp';
import { listenAuthState, signInAsGuest } from '../services/firebase/firebaseAuth';
import '../styles/globals.css';

type Screen = 'lobby' | 'waitingRoom' | 'game';
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
type ToastMessage = { id: number; title: string; description?: string; icon?: string };
type RollAnimation = { id: number; result: YutResult; sticks: boolean[] };

const PLAYER_COLORS = ['#d94a38', '#3a78c2', '#2f9e6f', '#d6a11d'];
const STORAGE_KEYS = { nickname: 'yut-online:nickname', title: 'yut-online:title' } as const;
const getStoredText = (key: string, fallback: string) => {
  if (typeof window === 'undefined') return fallback;
  return window.localStorage.getItem(key) || fallback;
};
const TURN_DELAY_MS = 650;
const AI_MOVE_DELAY_MS = 2000;
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
    nodeId: 'n01',
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
  const [countdown, setCountdown] = useState(-1);
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
  const [branchChoice, setBranchChoice] = useState<BranchChoice>('outer');
  const [rollAnimation, setRollAnimation] = useState<RollAnimation | null>(null);
  const rooms = useRooms();
  const serverStatus = isFirebaseConfigured ? (user ? '온라인' : '입장 준비 중') : '연결 정보 확인 필요';
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
        setMessage('방이 종료되어 대기실로 이동했습니다.');
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
    if (screen !== 'waitingRoom' || countdown < 0) return undefined;
    if (!allReady) { setCountdown(-1); setMessage('준비가 해제되어 게임 시작이 취소되었습니다.'); return undefined; }
    if (countdown === 0) { startLocalGame(); return undefined; }
    const timer = window.setTimeout(() => setCountdown((current) => current - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [allReady, countdown, screen]);

  async function handleCreateRoom() {
    if (!user) { setMessage('입장 준비가 끝난 뒤 다시 시도하세요.'); return; }
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
    setCountdown(3); setScreen('waitingRoom'); setMessage('');
  }

  function startLocalGame() {
    const nextPieces = makePieces(playableSeats, pieceCount);
    setPieces(nextPieces);
    setBoardItems(itemMode ? spawnInitialBoardItems(4, 8) : []);
    setOwnedItems([]); setRevealedItems([]); setSelectedPieceId(nextPieces[0]?.id ?? ''); setMovingPieceId(''); setTurnIndex(0); setRoll(null); setBranchChoice('outer');
    setLogs([{ id: Date.now(), text: '게임이 시작되었습니다. 윷을 던져주세요.' }]);
    setScreen('game');
  }

  function addLog(text: string) { setLogs((current) => [{ id: Date.now(), text }, ...current]); }
  function showToast(title: string, description?: string, icon?: string) {
    const nextToast = { id: Date.now(), title, description, icon };
    setToast(nextToast);
    window.setTimeout(() => setToast((current) => current?.id === nextToast.id ? null : current), 3000);
  }
  function makeRollSticks(result: YutResult) {
    const flatCount = result.name === '모' ? 0 : result.steps;
    return Array.from({ length: 4 }, (_, index) => index < flatCount);
  }
  function makeUniqueAIName(currentSeats: Seat[]) {
    const aiNames = ['단풍이', '구름이', '호랑이', '두루미', '반달이', '별님이', '솔방울', '바람이', '나무꾼', '달토끼', '해님이', '복주머니'];
    const usedNames = new Set(currentSeats.filter((seat) => !seat.isEmpty).map((seat) => seat.name));
    const candidates = aiNames.filter((name) => !usedNames.has(name));
    if (candidates.length) return candidates[Math.floor(Math.random() * candidates.length)];
    let suffix = 1;
    while (usedNames.has(`AI 친구 ${suffix}`)) suffix += 1;
    return `AI 친구 ${suffix}`;
  }

  function markPlayerAsAI(playerId: string) {
    setSeats((currentSeats) => {
      const aiName = makeUniqueAIName(currentSeats);
      return currentSeats.map((seat) => seat.id === playerId ? { ...seat, name: aiName, ready: true, isAI: true, isEmpty: false } : seat);
    });
  }
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
    let currentNodeId = movingPiece.nodeId;
    let finishedMove = false;
    for (let step = 0; step < steps; step += 1) {
      const nextNode = getNextBoardNode(getBoardNodeById(currentNodeId), step === 0 ? branchChoice : 'outer');
      finishedMove = !nextNode;
      currentNodeId = finishedMove ? 'finish' : nextNode?.id ?? 'finish';
      nextNodeIndex = finishedMove ? 20 : BOARD_NODES.findIndex((node) => node.id === nextNode?.id);
      setPieces((currentPieces) => currentPieces.map((piece) => piece.id === pieceId ? { ...piece, nodeIndex: nextNodeIndex, nodeId: currentNodeId, started: true, finished: finishedMove } : piece));
      await delay(STEP_DELAY_MS);
      if (finishedMove) break;
    }
    const landedNode = getBoardNodeById(currentNodeId);
    const landedItem = boardItems.find((item) => item.nodeId === landedNode?.id);
    if (landedItem) {
      setOwnedItems((items) => [...items, landedItem.type]);
      setRevealedItems((items) => Array.from(new Set([...items, landedItem.type])));
      setBoardItems((items) => items.filter((item) => item.id !== landedItem.id));
      const itemName = ITEM_DEFINITIONS[landedItem.type].name;
      addLog(`${seat.label}이(가) 아이템 '${itemName}'을 획득했습니다.`);
      showToast(`${seat.label} ${itemName} 획득`, ITEM_DEFINITIONS[landedItem.type].description, ITEM_DEFINITIONS[landedItem.type].icon);
      setHighlightedNodeId(landedNode?.id ?? '');
      window.setTimeout(() => setHighlightedNodeId((current) => current === landedNode?.id ? '' : current), 1400);
    }
    let captured = false;
    if (currentNodeId !== 'finish') {
      captured = pieces.some((piece) => piece.ownerId !== seat.id && !piece.finished && piece.started && piece.nodeId === currentNodeId);
      if (captured) {
        setPieces((currentPieces) => currentPieces.map((piece) => piece.ownerId !== seat.id && !piece.finished && piece.started && piece.nodeId === currentNodeId ? { ...piece, nodeIndex: 0, nodeId: 'n01', started: false } : piece));
        addLog(`${seat.label}이(가) 상대 말을 잡아 한 번 더 던집니다.`);
      }
    }
    if (finishedMove) addLog(`${seat.label} 말이 완주했습니다!`);
    const seatDone = pieces.filter((piece) => piece.ownerId === seat.id && piece.id !== pieceId).every((piece) => piece.finished) && finishedMove;
    if (seatDone) addLog(`${seat.label}이(가) 모든 말을 완주했습니다.`);
    if (result.bonus || captured) addLog(`${result.name} 또는 잡기 보너스로 한 번 더 던질 수 있습니다.`); else setTurnIndex((current) => (current + 1) % playableSeats.length);
    setBranchChoice('outer');
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
    await delay(AI_MOVE_DELAY_MS);
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
    setScreen('lobby'); setActiveRoomId(''); setActiveRoomTitle(''); setIsRoomHost(false); setCountdown(-1); setSeats(createSeats(nickname, playMode, maxPlayers));
    setMessage('방에서 나왔습니다.');
  }

  function finishGame() { setScreen('lobby'); setActiveRoomTitle(''); setActiveRoomId(''); setIsRoomHost(false); setCountdown(-1); setSeats(createSeats(nickname, playMode, maxPlayers)); setMessage('게임이 종료되어 첫 대기화면으로 돌아왔습니다.'); }

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
      <div className="hero-actions"><div className={`status-card ${serverStatusTone}`} aria-label={`서버 상태: ${serverStatus}`}><span className={`status-dot ${serverStatusTone}`} aria-hidden="true"></span><strong>접속</strong><span>{serverStatus}</span></div></div>
    </section>

    {screen === 'lobby' && <section className="lobby-layout" aria-label="첫 대기 화면">
      <section className="panel room-panel"><p className="section-kicker">방 만들기</p><h2>새 방 설정</h2><div className="form-grid"><label>닉네임<input value={nickname} onChange={(e) => setNickname(e.target.value)} placeholder="닉네임" /></label><label>방 제목<input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="방 제목" /></label><fieldset className="radio-group"><legend>진행 방식</legend><label><input type="radio" name="playMode" checked={playMode === 'individual'} onChange={() => setPlayMode('individual')} />개인전</label><label><input type="radio" name="playMode" checked={playMode === 'team'} onChange={() => setPlayMode('team')} />팀전</label></fieldset><fieldset className="radio-group"><legend>인원</legend>{([2, 3, 4] as const).map((count) => <label key={count} className={playMode === 'team' && count !== 4 ? 'disabled' : ''}><input type="radio" name="maxPlayers" checked={maxPlayers === count} disabled={playMode === 'team' && count !== 4} onChange={() => setMaxPlayers(count)} />{count}인</label>)}</fieldset><fieldset className="radio-group"><legend>말 개수</legend>{([1, 2, 3, 4] as const).map((count) => <label key={count}><input type="radio" name="pieceCount" checked={pieceCount === count} onChange={() => setPieceCount(count)} />{count}개</label>)}</fieldset><label className="check-row"><input type="checkbox" checked={itemMode} onChange={(e) => setItemMode(e.target.checked)} /> 아이템 모드</label><button onClick={handleCreateRoom}>방 만들기</button></div>{message && <p className="notice">{message}</p>}</section>
      <section className="panel room-panel"><p className="section-kicker">방 참여</p><h2>대기중 방</h2><div className="room-list">{rooms.length ? rooms.map((room) => <article className="room-card" key={room.id}><div><b>{room.title}</b><span>{room.playMode} · 말 {room.pieceCount ?? 4}개 · {room.itemMode ? '아이템 ON' : '아이템 OFF'} · {room.maxPlayers}인</span></div><button onClick={() => openWaitingRoom(room)}>참여</button></article>) : <span>아직 만들어진 방이 없습니다.</span>}</div></section>
    </section>}

    {screen === 'waitingRoom' && <section className="panel waiting-room" aria-label="방 대기 화면"><p className="section-kicker">게임 시작 대기</p><h2 className="room-title">{activeRoomTitle || title}</h2><p className="room-subtitle">{playMode === 'team' ? '팀을 고르고 인원을 맞춰주세요' : '모두 준비되면 방장이 시작합니다'}</p><div className="mode-summary"><b>{playMode === 'team' ? '팀전' : '개인전'}</b><span>{maxPlayers}인</span><span>말 {pieceCount}개</span><span>{itemMode ? '아이템 ON' : '아이템 OFF'}</span>{playMode === 'team' && <span>청팀 {teamCounts.청팀}명 / 홍팀 {teamCounts.홍팀}명</span>}</div>{isRoomHost && <div className="host-room-options"><label>말 개수<select value={pieceCount} onChange={(e) => changeWaitingOptions({ pieceCount: Number(e.target.value) as PieceCount })}><option value={1}>1개</option><option value={2}>2개</option><option value={3}>3개</option><option value={4}>4개</option></select></label><label className="check-row"><input type="checkbox" checked={itemMode} onChange={(e) => changeWaitingOptions({ itemMode: e.target.checked })} /> 아이템전</label></div>}<div className="ready-list">{seats.map((seat) => <article className={`ready-card ${seat.isAI ? 'ai' : ''} ${seat.isEmpty ? 'empty' : ''}`} key={seat.id}><b>{seat.label}</b><span>{seat.name}</span>{playMode === 'team' && <select value={seat.team} onChange={(e) => changeTeam(seat.id, e.target.value as Team)}><option value="청팀">청팀</option><option value="홍팀">홍팀</option></select>}<em>{seat.isAI ? 'AI 대체' : seat.isEmpty ? '빈 자리' : seat.ready ? '준비 완료' : '준비 중'}</em>{seat.isHost && <small>방장</small>}{seat.isEmpty && <button className="mini-button" onClick={() => markPlayerAsAI(seat.id)}>AI로 채우기</button>}</article>)}</div>{countdown >= 0 && <div className="countdown-overlay" role="status"><span>게임 시작</span><strong>{countdown}</strong><button className="secondary mini-button" onClick={() => { setCountdown(-1); setMessage('시작이 취소되었습니다.'); }}>취소</button></div>}{playMode === 'team' && !teamBalanced && <p className="notice warning">팀전은 4인전만 가능하며 청팀 2명, 홍팀 2명이어야 시작할 수 있습니다.</p>}<div className="waiting-actions"><button onClick={handleStartGame} disabled={!allReady}>게임 시작</button><button className="secondary" onClick={leaveRoom}>방 나가기</button></div>{message && <p className="notice">{message}</p>}</section>}



    {toast && <div className="toast-message" role="status" aria-live="polite"><strong>{toast.icon} {toast.title}</strong>{toast.description && <span>{toast.description}</span>}</div>}

    {screen === 'game' && <section className="game-layout" aria-label="게임 플레이 화면">
      <aside className="panel players"><h2>{activeRoomTitle || title}</h2><p className="game-end-guide">내 모든 말이 완주하면 개인전 승리, 팀전은 같은 팀 전원의 말이 모두 완주하면 승리합니다. 결과가 나오면 게임 종료로 대기화면에 돌아갈 수 있습니다.</p>{playableSeats.map((seat) => <div className={`player ${seat.isAI ? 'ai' : ''} ${activeSeat?.id === seat.id ? 'active' : ''}`} key={seat.id}><b>{seat.label}</b><span>{seat.color} 말 {pieceCount}개 · {seat.name}</span>{playMode === 'team' && <small>{seat.team}</small>}<em>{seat.isAI ? 'AI 플레이' : activeSeat?.id === seat.id ? '현재 턴' : '대기'}</em>{!seat.isHost && !seat.isAI && <button className="mini-button" onClick={() => markPlayerAsAI(seat.id)}>나감 처리</button>}</div>)}<div className="player-items"><h2>보유 아이템</h2>{ownedItems.length ? <div className="item-grid">{ownedItems.map((type, index) => <button className="item-button" key={`${type}-${index}`} onClick={() => useItem(type)}><ItemCard type={type} /></button>)}</div> : <p className="empty-state">보유한 아이템이 없습니다.</p>}</div><button className="secondary end-game" onClick={finishGame}>게임 종료</button></aside>
      <section className="panel board-panel"><GameBoard pieces={pieces} items={boardItems} selectedPieceId={selectedPieceId} movingPieceId={movingPieceId} onSelectPiece={setSelectedPieceId} revealedItems={revealedItems} highlightedNodeId={highlightedNodeId} />{rollAnimation && <div className="roll-stage" role="status" aria-live="polite"><div className="roll-mat"><span className="roll-label">{rollAnimation.result.name}</span>{rollAnimation.sticks.map((flat, index) => <span key={`${rollAnimation.id}-${index}`} className={`yut-stick ${flat ? 'flat' : 'round'}`} style={{ '--stick-index': index } as CSSProperties}><i></i></span>)}</div></div>}<div className="play-controls"><strong>{winner ? `${winner} · 게임 종료` : `${activeSeat?.label} 턴`}</strong><span>{roll ? `${roll.name} · ${roll.steps}칸` : isMyTurn ? '윷을 던져주세요' : '상대 턴입니다'}</span>{roll && isMyTurn && ['n06','n11','c01'].includes((pieces.find((piece) => piece.id === selectedPieceId)?.nodeId ?? '')) && <select value={branchChoice} onChange={(e) => setBranchChoice(e.target.value as BranchChoice)} aria-label="이동 방향 선택"><option value="shortcut">지름길</option><option value="outer">바깥길</option></select>}<button onClick={() => roll ? moveSelectedPiece() : rollYut()} disabled={!isMyTurn || Boolean(winner) || Boolean(movingPieceId)}>{roll ? '선택한 말 이동' : '윷 던지기'}</button></div></section>
      <aside className="panel side"><h2>진행 기록</h2><div className="log-list">{logs.map((log) => <p key={log.id}>{log.text}</p>)}</div></aside>
    </section>}
  </main>;
}
