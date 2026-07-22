import { useCallback, useEffect, useRef, useState, type MutableRefObject, type Dispatch, type SetStateAction } from 'react';
import { deleteRoom, removeRoomPlayer, shouldDeleteWaitingRoomOnHostExit, updateRoomOptions, updateRoomPlayer, type RoomPlayer } from '../../features/room/services/roomService';
import { createSeats, STORAGE_KEYS, type PieceCount, type PlayMode, type Seat, type Team } from '../appState';
import { DEFAULT_AI_DIFFICULTY } from '../../game-core/aiDifficulty';
import { makeUniqueAIName } from '../flows/aiName';
import { getChangedWaitingRoomOptions, normalizeWaitingRoomSeatTeams, resolveWaitingRoomOptions, type WaitingRoomOptionPatch, type WaitingRoomOptions } from '../flows/waitingRoomOptions';

type Params = {
  activeRoomId: string; localSeatId: string; screen: 'lobby' | 'waitingRoom' | 'game'; nickname: string; playMode: PlayMode; maxPlayers: 2 | 3 | 4; itemMode: boolean; stackedRollMode: boolean; pieceCount: PieceCount; seats: Seat[]; canManageRoom: boolean; isRoomManager: boolean; activeRoomIdRef: MutableRefObject<string>; leavingRoomRef: MutableRefObject<boolean>; confirmedRoomPlayerRef: MutableRefObject<boolean>; hostingRoomUserIdRef: MutableRefObject<string>; addLog: (text: string) => void; setSeats: Dispatch<SetStateAction<Seat[]>>; setMessage: (message: string) => void; setScreen: (screen: 'lobby' | 'waitingRoom' | 'game') => void; setActiveRoomId: (id: string) => void; setActiveRoomTitle: (title: string) => void; setActiveRoomHostId: (id: string) => void; setIsRoomHost: (isHost: boolean) => void; setCountdown: (countdown: number) => void; setTurnOrderIds: (ids: string[]) => void; setGameStartedAt: (startedAt: number | null) => void; setPlayMode: (mode: PlayMode) => void; setMaxPlayers: (count: 2 | 3 | 4) => void; setItemMode: (enabled: boolean) => void; setStackedRollMode: (enabled: boolean) => void; setPieceCount: (count: PieceCount) => void;
};

const colors = ['red', 'blue', 'green', 'yellow'];
const seatIndex = (seat: Seat) => Number(seat.label.replace('P', '')) - 1;
const aiUpdate = (seat: Seat, nickname: string): Partial<Omit<RoomPlayer, 'id'>> => ({ nickname, ready: true, isAI: true, isSubstitutedByAI: false, aiDifficulty: DEFAULT_AI_DIFFICULTY, seatIndex: seatIndex(seat), color: colors[seatIndex(seat)] ?? 'black', team: seat.team });
export const getSubstitutedRoomPlayerUpdate = (seat: Seat): Partial<Omit<RoomPlayer, 'id'>> => ({ nickname: seat.name, ready: true, isAI: true, isSubstitutedByAI: true, seatIndex: seatIndex(seat), color: colors[seatIndex(seat)] ?? 'black', team: seat.team });

export function useWaitingRoomController(p: Params) {
  const [pendingAiSeatCount, setPendingAiSeatCount] = useState(0);
  const pendingAiSeatIdsRef = useRef<Set<string>>(new Set());
  const waitingOptionsRef = useRef<WaitingRoomOptions>({ playMode: p.playMode, maxPlayers: p.maxPlayers, itemMode: p.itemMode, stackedRollMode: p.stackedRollMode, pieceCount: p.pieceCount });
  const waitingOptionsRoomIdRef = useRef(p.activeRoomId);
  const waitingOptionsUpdateQueueRef = useRef<Promise<void>>(Promise.resolve());
  const pendingWaitingOptionsUpdateCountRef = useRef(0);
  const sync = () => setPendingAiSeatCount(pendingAiSeatIdsRef.current.size);
  const addPendingAiSeat = (id: string) => { if (id) { pendingAiSeatIdsRef.current.add(id); sync(); } };
  const clearPendingAiSeat = (id: string) => { if (id && pendingAiSeatIdsRef.current.delete(id)) sync(); };

  useEffect(() => {
    const renderedOptions = { playMode: p.playMode, maxPlayers: p.maxPlayers, itemMode: p.itemMode, stackedRollMode: p.stackedRollMode, pieceCount: p.pieceCount };
    if (waitingOptionsRoomIdRef.current !== p.activeRoomId) {
      waitingOptionsRoomIdRef.current = p.activeRoomId;
      waitingOptionsRef.current = renderedOptions;
      return;
    }
    if (pendingWaitingOptionsUpdateCountRef.current === 0) waitingOptionsRef.current = renderedOptions;
  }, [p.activeRoomId, p.itemMode, p.maxPlayers, p.pieceCount, p.playMode, p.stackedRollMode]);

  const enqueueWaitingOptionsUpdate = useCallback((roomId: string, patch: WaitingRoomOptionPatch) => {
    pendingWaitingOptionsUpdateCountRef.current += 1;
    const update = waitingOptionsUpdateQueueRef.current
      .catch(() => undefined)
      .then(() => updateRoomOptions(roomId, patch));
    waitingOptionsUpdateQueueRef.current = update.catch(() => undefined);
    return update.finally(() => {
      pendingWaitingOptionsUpdateCountRef.current = Math.max(0, pendingWaitingOptionsUpdateCountRef.current - 1);
    });
  }, []);

  const toggleMyReady = useCallback(async () => {
    if (p.isRoomManager) return;
    const mySeat = p.seats.find((seat) => seat.id === p.localSeatId && !seat.isEmpty && !seat.isAI);
    if (!mySeat) { p.setMessage('내 참가 정보를 찾는 중입니다. 잠시 뒤 다시 시도하세요.'); return; }
    const nextReady = !mySeat.ready;
    p.setSeats((current) => current.map((seat) => seat.id === mySeat.id ? { ...seat, ready: nextReady } : seat));
    try { if (p.activeRoomId) await updateRoomPlayer(p.activeRoomId, mySeat.id, { ready: nextReady }); p.setMessage(nextReady ? '준비 완료했습니다. 방장이 시작할 때까지 기다려주세요.' : '준비를 취소했습니다.'); }
    catch (error) { p.setSeats((current) => current.map((seat) => seat.id === mySeat.id ? { ...seat, ready: mySeat.ready } : seat)); p.setMessage(error instanceof Error ? error.message : '준비 상태 변경에 실패했습니다. 잠시 뒤 다시 시도해주세요.'); }
  }, [p]);

  const leaveRoom = useCallback(async () => {
    const leavingRoomId = p.activeRoomId; const leavingSeatId = p.localSeatId; const wasGameScreen = p.screen === 'game';
    const shouldDeleteWaitingRoom = shouldDeleteWaitingRoomOnHostExit(p.screen, p.isRoomManager);
    p.leavingRoomRef.current = true; const leavingSeat = p.seats.find((seat) => seat.id === leavingSeatId && !seat.isEmpty && !seat.isAI);
    if (wasGameScreen && leavingRoomId) p.addLog(`${p.nickname}님이 나갔습니다. AI가 이어서 플레이합니다.`);
    p.hostingRoomUserIdRef.current = ''; p.activeRoomIdRef.current = ''; p.confirmedRoomPlayerRef.current = false;
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    p.setScreen('lobby'); p.setActiveRoomId(''); p.setActiveRoomTitle(''); p.setActiveRoomHostId(''); p.setIsRoomHost(false); p.setCountdown(-1); p.setTurnOrderIds([]); p.setGameStartedAt(null); p.setSeats(createSeats(p.nickname, p.playMode, p.maxPlayers));
    window.requestAnimationFrame(() => window.scrollTo({ top: 0, left: 0, behavior: 'auto' }));
    window.localStorage.removeItem(STORAGE_KEYS.activeRoomId); window.localStorage.removeItem(STORAGE_KEYS.isRoomHost); p.setMessage(shouldDeleteWaitingRoom ? '방을 종료하고 로비로 이동했습니다.' : '방에서 나왔습니다.');
    if (!leavingRoomId || !leavingSeatId) { p.leavingRoomRef.current = false; return; }
    try { if (shouldDeleteWaitingRoom) await deleteRoom(leavingRoomId); else if (wasGameScreen && leavingSeat) { addPendingAiSeat(leavingSeatId); await updateRoomPlayer(leavingRoomId, leavingSeatId, getSubstitutedRoomPlayerUpdate(leavingSeat)); clearPendingAiSeat(leavingSeatId); } else await removeRoomPlayer(leavingRoomId, leavingSeatId); }
    catch (error) { clearPendingAiSeat(leavingSeatId); console.warn('방 나가기 정리에 실패했습니다.', error); }
    finally { p.leavingRoomRef.current = false; }
  }, [p]);

  const changeWaitingOptions = useCallback(async (requested: WaitingRoomOptionPatch) => {
    const current = waitingOptionsRef.current;
    const next = resolveWaitingRoomOptions(current, requested);
    const activePlayerCount = p.seats.filter((seat) => !seat.isEmpty && !seat.isSpectator).length;
    if (next.maxPlayers < activePlayerCount) { p.setMessage(`현재 참가 인원 ${activePlayerCount}명보다 적게 인원을 줄일 수 없습니다.`); return; }
    const patch = getChangedWaitingRoomOptions(current, next);
    if (Object.keys(patch).length === 0) return;
    waitingOptionsRef.current = next;
    if (patch.playMode !== undefined) {
      p.setPlayMode(next.playMode);
      p.setSeats((seats) => normalizeWaitingRoomSeatTeams(seats, next.playMode));
    }
    if (patch.maxPlayers !== undefined) p.setMaxPlayers(next.maxPlayers);
    if (patch.itemMode !== undefined) p.setItemMode(next.itemMode);
    if (patch.stackedRollMode !== undefined) p.setStackedRollMode(next.stackedRollMode);
    if (patch.pieceCount !== undefined) p.setPieceCount(next.pieceCount);
    if (p.canManageRoom && p.activeRoomId) {
      try { await enqueueWaitingOptionsUpdate(p.activeRoomId, patch); }
      catch (error) { p.setMessage(error instanceof Error ? error.message : '방 옵션 변경에 실패했습니다. 잠시 뒤 다시 시도해주세요.'); }
    }
  }, [enqueueWaitingOptionsUpdate, p]);

  const markPlayerAsAI = useCallback((playerId: string) => { if (pendingAiSeatIdsRef.current.has(playerId)) return; p.setSeats((current) => { const name = makeUniqueAIName(current, DEFAULT_AI_DIFFICULTY); const target = current.find((seat) => seat.id === playerId); if (p.activeRoomId && target) { addPendingAiSeat(playerId); void updateRoomPlayer(p.activeRoomId, playerId, aiUpdate(target, name)).catch((error) => { console.warn('AI 추가에 실패했습니다.', error); p.setMessage('AI 추가에 실패했습니다. 잠시 뒤 다시 시도해주세요.'); p.setSeats((latest) => latest.map((seat) => seat.id === playerId && seat.isAI ? { ...seat, name: '빈 자리', ready: false, isAI: false, isEmpty: true } : seat)); }).finally(() => clearPendingAiSeat(playerId)); } return current.map((seat) => seat.id === playerId ? { ...seat, name, ready: true, isAI: true, isSubstitutedByAI: false, isEmpty: false } : seat); }); }, [p]);
  const cancelAISeat = useCallback((playerId: string) => { clearPendingAiSeat(playerId); if (p.activeRoomId) void removeRoomPlayer(p.activeRoomId, playerId); p.setSeats((current) => current.map((seat) => seat.id === playerId && seat.isAI ? { ...seat, name: '빈 자리', ready: false, isAI: false, isEmpty: true } : seat)); }, [p]);
  const kickWaitingPlayer = useCallback(async (seat: Seat) => { if (!p.activeRoomId || !p.canManageRoom || seat.isEmpty || seat.isHost || seat.isAI) return; const previous = seat; p.setSeats((current) => current.map((s) => s.id === previous.id ? { ...s, id: `slot-${Number(s.label.replace('P', ''))}`, name: '빈 자리', ready: false, isEmpty: true } : s)); try { await removeRoomPlayer(p.activeRoomId, previous.id); p.setMessage(`${previous.name}님을 방에서 내보냈습니다.`); } catch (error) { p.setSeats((current) => current.map((s) => s.label === previous.label ? previous : s)); p.setMessage(error instanceof Error ? error.message : '플레이어 강퇴에 실패했습니다. 잠시 뒤 다시 시도해주세요.'); } }, [p]);
  const changeTeam = useCallback((playerId: string, team: Team) => { if (p.activeRoomId) void updateRoomPlayer(p.activeRoomId, playerId, { team }); p.setSeats((current) => current.map((seat) => seat.id === playerId ? { ...seat, team } : seat)); }, [p]);

  return { pendingAiSeatCount, pendingAiSeatIdsRef, addPendingAiSeat, clearPendingAiSeat, toggleMyReady, leaveRoom, changeWaitingOptions, markPlayerAsAI, cancelAISeat, kickWaitingPlayer, changeTeam };
}
