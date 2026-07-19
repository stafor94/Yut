import type { MutableRefObject } from 'react';
import type { User } from 'firebase/auth';
import type { PieceCount, PlayMode, Seat } from '../appTypes';
import { STORAGE_KEYS } from '../preferences/localPreferences';
import { createSeats, seatsWithJoinedPlayer } from '../selectors/seatSelectors';
import { CREATE_ROOM_AUTH_TIMEOUT_MS } from '../config/gameTimings';
import { isRoomTransitionInProgress } from './roomCreationFlow';

export type EnterableRoom = Pick<RoomSummary, 'title' | 'itemMode' | 'stackedRollMode' | 'maxPlayers' | 'playMode' | 'pieceCount'> & Partial<Pick<RoomSummary, 'id' | 'hostId' | 'status'>>;

type Screen = 'lobby' | 'waitingRoom' | 'game';
export type JoinRoomResult = { role: 'player' | 'spectator'; seatIndex: number | null; presenceEpoch?: number };
export type RoomSummary = { id: string; title: string; hostId?: string; status: 'waiting' | 'playing' | 'finished'; maxPlayers: number; itemMode: boolean; stackedRollMode?: boolean; playMode: PlayMode; pieceCount: PieceCount; createRequestId?: string };

type RoomSessionActions = {
  onActiveRoomIdChange: (activeRoomId: string) => void;
  onRoomHostChange: (isRoomHost: boolean) => void;
  onActiveRoomTitleChange: (activeRoomTitle: string) => void;
  onRoomHostIdChange: (activeRoomHostId: string) => void;
  onPlayModeChange: (playMode: PlayMode) => void;
  onMaxPlayersChange: (maxPlayers: 2 | 3 | 4) => void;
  onItemModeChange: (itemMode: boolean) => void;
  onStackedRollModeChange: (stackedRollMode: boolean) => void;
  onPieceCountChange: (pieceCount: PieceCount) => void;
  onSeatsChange: (seats: Seat[]) => void;
  onScreenChange: (screen: Screen) => void;
  onMessage: (message: string) => void;
  onLoadingMessage: (loadingMessage: string) => void;
};

type RoomEntryRuntime = {
  firebaseConfigured: boolean;
  signInAsGuest: () => Promise<User | null>;
  getRoom: (roomId: string) => Promise<RoomSummary | null>;
  removeRoomPlayer: (roomId: string, userId: string) => Promise<void>;
  joinRoom: (roomId: string, params: { userId: string; nickname: string; playMode: PlayMode }) => Promise<JoinRoomResult>;
  leaveDuplicatePlayerRooms: (userId: string, activeRoomId: string) => Promise<unknown>;
  isRoomInGame: (room: RoomSummary) => boolean;
  setTimeout: (callback: () => void, delayMs: number) => number;
  localStorage: Pick<Storage, 'getItem' | 'removeItem'>;
};

export type RoomEntryControllerParams = RoomSessionActions & {
  nickname: string;
  currentUser: User | null;
  userRef: MutableRefObject<User | null>;
  rememberUser: (user: User | null) => void;
  activeRoomIdRef: MutableRefObject<string>;
  hostingRoomUserIdRef: MutableRefObject<string>;
  leavingRoomRef: MutableRefObject<boolean>;
  runtime: RoomEntryRuntime;
};

const normalizeEntryMaxPlayers = (value: number): 2 | 3 | 4 => (value === 2 || value === 3 || value === 4 ? value : 4);

const withJoinAuthTimeout = (signInAsGuest: () => Promise<User | null>, setTimeoutFn: RoomEntryRuntime['setTimeout']) => Promise.race([
  signInAsGuest(),
  new Promise<never>((_, reject) => setTimeoutFn(() => reject(new Error('JOIN_ROOM_TIMEOUT')), CREATE_ROOM_AUTH_TIMEOUT_MS)),
]);

export async function leavePreviousOnlineRoomForEntry(params: Pick<RoomEntryControllerParams, 'currentUser' | 'userRef' | 'activeRoomIdRef' | 'onActiveRoomIdChange' | 'runtime'> & { nextRoomId?: string }) {
  const nextRoomId = params.nextRoomId ?? '';
  const previousRoomId = params.activeRoomIdRef.current || params.runtime.localStorage.getItem(STORAGE_KEYS.activeRoomId) || '';
  const roomUser = params.userRef.current ?? params.currentUser;
  if (!previousRoomId || previousRoomId === nextRoomId || !params.runtime.firebaseConfigured || !roomUser) return;
  try {
    const previousRoom = await params.runtime.getRoom(previousRoomId);
    if (!previousRoom) return;
    await params.runtime.removeRoomPlayer(previousRoomId, roomUser.uid);
  } catch (error) {
    console.warn('이전 방 정리에 실패했습니다.', error);
  } finally {
    const transitioningToNextRoom = isRoomTransitionInProgress(previousRoomId, nextRoomId);
    const activeRoomIsPrevious = !params.activeRoomIdRef.current || params.activeRoomIdRef.current === previousRoomId;
    if (!transitioningToNextRoom && params.activeRoomIdRef.current === previousRoomId) params.onActiveRoomIdChange('');
    if (params.runtime.localStorage.getItem(STORAGE_KEYS.activeRoomId) === previousRoomId) params.runtime.localStorage.removeItem(STORAGE_KEYS.activeRoomId);
    if (!transitioningToNextRoom && activeRoomIsPrevious) params.runtime.localStorage.removeItem(STORAGE_KEYS.isRoomHost);
  }
}

export async function openWaitingRoomForEntry(params: RoomEntryControllerParams & { room: EnterableRoom; nextMessage?: string; asHost?: boolean; hostUserOverride?: User | null }) {
  const { room, runtime } = params;
  const asHost = Boolean(params.asHost);
  params.leavingRoomRef.current = false;
  params.onLoadingMessage('방으로 이동하는 중입니다...');
  const nextMaxPlayers = normalizeEntryMaxPlayers(room.maxPlayers);
  try {
    const roomUser = asHost && params.hostUserOverride ? params.hostUserOverride : params.userRef.current ?? params.currentUser;
    params.hostingRoomUserIdRef.current = asHost && roomUser ? roomUser.uid : '';
    if (asHost && roomUser) params.rememberUser(roomUser);
    const joiningUser = !asHost && room.id && runtime.firebaseConfigured ? roomUser ?? await withJoinAuthTimeout(runtime.signInAsGuest, runtime.setTimeout) : roomUser;
    if (!asHost && room.id && runtime.firebaseConfigured && !joiningUser) throw new Error('입장 준비가 끝난 뒤 다시 시도하세요.');
    if (joiningUser) params.rememberUser(joiningUser);
    const previousRoomCleanup = leavePreviousOnlineRoomForEntry(params);
    if (asHost) void previousRoomCleanup;
    else await previousRoomCleanup;
    const joinResult = !asHost && room.id && joiningUser ? await runtime.joinRoom(room.id, { userId: joiningUser.uid, nickname: params.nickname, playMode: room.playMode }) : null;
    params.onActiveRoomIdChange(room.id ?? '');
    params.onRoomHostChange(asHost);
    params.onActiveRoomTitleChange(room.title);
    params.onRoomHostIdChange(asHost && roomUser ? roomUser.uid : String(room.hostId ?? ''));
    params.onPlayModeChange(room.playMode);
    params.onMaxPlayersChange(nextMaxPlayers);
    params.onItemModeChange(room.itemMode);
    params.onStackedRollModeChange(Boolean(room.stackedRollMode));
    params.onPieceCountChange(room.pieceCount ?? 4);
    const nextSeats = createSeats(params.nickname, room.playMode, nextMaxPlayers);
    if (joinResult?.role === 'player' && joiningUser) params.onSeatsChange(seatsWithJoinedPlayer([], joiningUser.uid, params.nickname, room.playMode, nextMaxPlayers, joinResult.seatIndex));
    else if (asHost && roomUser) params.onSeatsChange(nextSeats.map((seat) => seat.isHost ? { ...seat, id: roomUser.uid } : seat));
    else params.onSeatsChange(nextSeats);
    params.onScreenChange(room.id && !asHost && runtime.isRoomInGame(room as RoomSummary) ? 'game' : 'waitingRoom');
    params.onLoadingMessage('');
    params.onMessage(params.nextMessage ?? '');
    if (asHost && roomUser && room.id) void runtime.leaveDuplicatePlayerRooms(roomUser.uid, room.id).catch((cleanupError) => console.warn('새 방 입장 후 중복 방 정리에 실패했습니다. 현재 방은 유지합니다.', cleanupError));
    if (!asHost && joiningUser && room.id) void runtime.leaveDuplicatePlayerRooms(joiningUser.uid, room.id).catch((cleanupError) => console.warn('중복 방 정리에 실패했습니다. 대상 방 입장은 유지합니다.', cleanupError));
  } catch (error) {
    params.hostingRoomUserIdRef.current = '';
    params.onActiveRoomIdChange('');
    params.onRoomHostChange(false);
    params.onActiveRoomTitleChange('');
    params.onRoomHostIdChange('');
    params.onScreenChange('lobby');
    params.onLoadingMessage('');
    params.onMessage(error instanceof Error ? error.message : '방 참가에 실패했습니다. 잠시 뒤 다시 시도해주세요.');
  }
}
