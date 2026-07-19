import type { MutableRefObject } from 'react';
import type { User } from 'firebase/auth';
import type { PieceCount, PlayMode } from '../appTypes';

type RoomSummary = { id: string; title: string; hostId?: string; status: 'waiting' | 'playing' | 'finished'; maxPlayers: number; itemMode: boolean; stackedRollMode?: boolean; playMode: PlayMode; pieceCount: PieceCount; createRequestId?: string };
import {
  RoomCreationTimeoutError,
  createRoomRequestIdentity,
  isMatchingCreatedRoom,
  withOperationTimeout,
} from './roomCreationFlow';
import {
  CREATE_ROOM_AUTH_TIMEOUT_MS,
  CREATE_ROOM_COMMIT_TIMEOUT_MS,
  CREATE_ROOM_RECOVERY_TIMEOUT_MS,
} from '../config/gameTimings';

const normalizeRoomCreationMaxPlayers = (value: unknown, mode: PlayMode): 2 | 3 | 4 => {
  if (mode === 'team') return 4;
  return value === 2 || value === 3 || value === 4 ? value : 4;
};

export type RoomCreationRequest = { roomId: string; createRequestId: string; title: string };
type RoomNotice = { title: string; message: string };
export type CreatedRoom = Pick<RoomSummary, 'title' | 'itemMode' | 'stackedRollMode' | 'maxPlayers' | 'playMode' | 'pieceCount'> & { id?: string };

export type RoomCreationRuntime = {
  firebaseConfigured: boolean;
  signInAsGuest: () => Promise<User | null>;
  createRoom: (params: { title: string; hostId: string; nickname: string; maxPlayers: 2 | 3 | 4; itemMode: boolean; stackedRollMode: boolean; playMode: PlayMode; pieceCount: PieceCount; roomId: string; createRequestId: string }) => Promise<string>;
  getRoom: (roomId: string) => Promise<RoomSummary | null>;
  makeRequestToken: () => string;
};

export type RequestRoomCreationParams = {
  title: string;
  nickname: string;
  playMode: PlayMode;
  maxPlayers: number;
  itemMode: boolean;
  stackedRollMode: boolean;
  pieceCount: PieceCount;
  currentUser: User | null;
  userRef: MutableRefObject<User | null>;
  pendingRoomCreationRef: MutableRefObject<RoomCreationRequest | null>;
  rememberUser: (user: User | null) => void;
  onMaxPlayersChange: (maxPlayers: 2 | 3 | 4) => void;
  onMessage: (message: string) => void;
  onLoadingMessage: (message: string) => void;
  onRoomNotice: (notice: RoomNotice | null) => void;
  onRoomCreated: (room: CreatedRoom, hostUser: User, nextMessage?: string) => Promise<void>;
  runtime: Partial<RoomCreationRuntime>;
};

type RoomCreationRecoveryOptions = {
  pollIntervalMs?: number;
  wait?: (delayMs: number) => Promise<void>;
};

const ROOM_CREATION_RECOVERY_POLL_INTERVAL_MS = 250;
const waitForRoomCreationRecovery = (delayMs: number) => new Promise<void>((resolve) => setTimeout(resolve, delayMs));

function showRoomCreationFailure(
  messageText: string,
  onMessage: (message: string) => void,
  onRoomNotice: (notice: RoomNotice | null) => void,
) {
  onMessage(messageText);
  onRoomNotice({ title: '방 생성에 실패했습니다', message: messageText });
}

export async function findCreatedRoomWithTimeout(
  request: { roomId: string; createRequestId: string },
  hostId: string,
  getRoomById: RoomCreationRuntime['getRoom'],
  options: RoomCreationRecoveryOptions = {},
) {
  let stopped = false;
  const pollIntervalMs = Math.max(0, options.pollIntervalMs ?? ROOM_CREATION_RECOVERY_POLL_INTERVAL_MS);
  const wait = options.wait ?? waitForRoomCreationRecovery;
  const pollForCreatedRoom = async () => {
    while (!stopped) {
      try {
        const room = await getRoomById(request.roomId);
        if (isMatchingCreatedRoom(room, { ...request, hostId })) return room;
      } catch {
        // Firestore가 생성 직후 일시적으로 조회되지 않으면 recovery 제한 시간 안에서 다시 확인한다.
      }
      if (stopped) break;
      await wait(pollIntervalMs);
    }
    return null;
  };

  try {
    return await withOperationTimeout(pollForCreatedRoom(), CREATE_ROOM_RECOVERY_TIMEOUT_MS, 'recover');
  } catch {
    return null;
  } finally {
    stopped = true;
  }
}

export async function requestRoomCreation(params: RequestRoomCreationParams) {
  const runtime = params.runtime;
  if (!runtime.signInAsGuest || !runtime.createRoom || !runtime.getRoom || !runtime.makeRequestToken || runtime.firebaseConfigured === undefined) throw new Error('방 생성 의존성이 준비되지 않았습니다.');
  const normalizedTitle = params.title.trim();
  if (!params.nickname.trim()) { params.onMessage('닉네임을 먼저 정해주세요.'); return; }
  params.onMessage('');
  params.onLoadingMessage(runtime.firebaseConfigured && !params.currentUser ? '입장 준비를 마친 뒤 방을 만드는 중입니다...' : '방을 만드는 중입니다. 잠시만 기다려주세요...');
  let roomHost = params.userRef.current ?? params.currentUser;
  const existingRequest = params.pendingRoomCreationRef.current;
  const request = existingRequest?.title === normalizedTitle
    ? existingRequest
    : { ...createRoomRequestIdentity(runtime.makeRequestToken()), title: normalizedTitle };
  params.pendingRoomCreationRef.current = request;
  try {
    const roomMaxPlayers = normalizeRoomCreationMaxPlayers(params.maxPlayers, params.playMode);
    if (roomMaxPlayers !== params.maxPlayers) params.onMaxPlayersChange(roomMaxPlayers);
    if (!runtime.firebaseConfigured) {
      params.pendingRoomCreationRef.current = null;
      params.onLoadingMessage('');
      params.onMessage('Firebase 연결 정보가 없어 온라인 방을 만들 수 없습니다.');
      return;
    }
    roomHost = roomHost ?? await withOperationTimeout(runtime.signInAsGuest(), CREATE_ROOM_AUTH_TIMEOUT_MS, 'auth');
    if (!roomHost) throw new Error('입장 준비가 끝난 뒤 다시 시도하세요.');
    params.rememberUser(roomHost);
    const roomId = await withOperationTimeout(runtime.createRoom({
      title: normalizedTitle,
      hostId: roomHost.uid,
      nickname: params.nickname,
      maxPlayers: roomMaxPlayers,
      itemMode: params.itemMode,
      stackedRollMode: params.stackedRollMode,
      playMode: params.playMode,
      pieceCount: params.pieceCount,
      roomId: request.roomId,
      createRequestId: request.createRequestId,
    }), CREATE_ROOM_COMMIT_TIMEOUT_MS, 'create');
    params.pendingRoomCreationRef.current = null;
    await params.onRoomCreated({ id: roomId, title: normalizedTitle, itemMode: params.itemMode, stackedRollMode: params.stackedRollMode, maxPlayers: roomMaxPlayers, playMode: params.playMode, pieceCount: params.pieceCount }, roomHost);
  } catch (error) {
    if (runtime.firebaseConfigured && roomHost && error instanceof RoomCreationTimeoutError && error.operation === 'create') {
      params.onLoadingMessage('응답이 지연되어 생성된 방을 확인하고 있습니다...');
      const recoveredRoom = await findCreatedRoomWithTimeout(request, roomHost.uid, runtime.getRoom);
      if (recoveredRoom) {
        params.pendingRoomCreationRef.current = null;
        await params.onRoomCreated(recoveredRoom, roomHost, '방 생성은 완료되어 대기실로 이동했습니다.');
      } else {
        params.onLoadingMessage('');
        showRoomCreationFailure('방 만들기 응답이 지연되고 있습니다. 같은 요청으로 다시 확인할 수 있으니 잠시 뒤 방 만들기를 다시 눌러주세요.', params.onMessage, params.onRoomNotice);
      }
    } else {
      params.pendingRoomCreationRef.current = null;
      params.onLoadingMessage('');
      const messageText = error instanceof RoomCreationTimeoutError && error.operation === 'auth'
        ? '입장 준비 시간이 초과되었습니다. 네트워크 상태를 확인한 뒤 다시 시도해주세요.'
        : error instanceof Error ? error.message : '방 생성에 실패했습니다. 잠시 뒤 다시 시도해주세요.';
      showRoomCreationFailure(messageText, params.onMessage, params.onRoomNotice);
    }
  }
}
