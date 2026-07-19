import type { PlayMode } from '../appTypes';

export const STORAGE_KEYS = {
  nickname: 'yut-online:nickname',
  title: 'yut-online:title',
  playMode: 'yut-online:playMode',
  maxPlayers: 'yut-online:maxPlayers',
  itemMode: 'yut-online:itemMode',
  stackedRollMode: 'yut-online:stackedRollMode',
  pieceCount: 'yut-online:pieceCount',
  soundEnabled: 'yut-online:soundEnabled',
  activeRoomId: 'yut-online:activeRoomId',
  isRoomHost: 'yut-online:isRoomHost',
} as const;

export const NICKNAME_MAX_LENGTH = 7;
export const normalizeNickname = (value: string) => value.trim().slice(0, NICKNAME_MAX_LENGTH);

type StorageLike = { getItem: (key: string) => string | null };

const getLocalStorage = (): StorageLike | null => {
  const maybeGlobal = globalThis as typeof globalThis & { localStorage?: StorageLike };
  return maybeGlobal.localStorage ?? null;
};

export const getStoredText = (key: string, fallback: string) => getLocalStorage()?.getItem(key) || fallback;

export const getStoredBoolean = (key: string, fallback: boolean) => {
  const stored = getLocalStorage()?.getItem(key) ?? null;
  return stored === null ? fallback : stored === 'true';
};

export const getStoredNumber = <T extends number>(key: string, fallback: T, allowed: readonly T[]) => {
  const stored = Number(getLocalStorage()?.getItem(key));
  return allowed.includes(stored as T) ? stored as T : fallback;
};

export const getStoredPlayMode = (): PlayMode => {
  const stored = getStoredText(STORAGE_KEYS.playMode, 'individual');
  return stored === 'team' ? 'team' : 'individual';
};

export const RANDOM_NICKNAME_PREFIXES = ['민첩한', '행운의', '반짝이는', '용감한', '느긋한', '쾌활한', '든든한', '재빠른'];
export const RANDOM_NICKNAME_BASES = ['토끼', '호랑이', '두루미', '다람쥐', '구름', '단풍', '별님', '솔방울'];

export const makeRandomNickname = () => `${RANDOM_NICKNAME_PREFIXES[Math.floor(Math.random() * RANDOM_NICKNAME_PREFIXES.length)]} ${RANDOM_NICKNAME_BASES[Math.floor(Math.random() * RANDOM_NICKNAME_BASES.length)]}${Math.floor(Math.random() * 90) + 10}`;
export const getInitialNickname = () => normalizeNickname(getStoredText(STORAGE_KEYS.nickname, '') || makeRandomNickname());
