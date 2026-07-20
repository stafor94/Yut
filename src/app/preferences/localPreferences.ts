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

export const NICKNAME_MIN_LENGTH = 2;
export const NICKNAME_MAX_LENGTH = 7;
export const NICKNAME_PATTERN = /^[가-힣A-Za-z0-9]{2,7}$/u;

export type NicknameValidationResult = { valid: true; value: string } | { valid: false; value: string; message: string };

export const normalizeNicknameForSave = (value: string) => value.normalize('NFC');

export const validateNickname = (value: string): NicknameValidationResult => {
  const normalized = normalizeNicknameForSave(value);
  if (!normalized) return { valid: false, value: normalized, message: '닉네임을 입력해 주세요.' };
  if (normalized.length < NICKNAME_MIN_LENGTH) return { valid: false, value: normalized, message: '닉네임은 2글자 이상이어야 합니다.' };
  if (normalized.length > NICKNAME_MAX_LENGTH) return { valid: false, value: normalized, message: '닉네임은 7글자 이하이어야 합니다.' };
  if (/\s/u.test(normalized)) return { valid: false, value: normalized, message: '공백은 사용할 수 없습니다.' };
  if (!NICKNAME_PATTERN.test(normalized)) return { valid: false, value: normalized, message: '완성형 한글, 영문, 숫자만 사용할 수 있습니다.' };
  return { valid: true, value: normalized };
};

export type PreferenceStorage = {
  getItem: (key: string) => string | null;
};

const getBrowserStorage = (): PreferenceStorage | null => {
  try {
    const browserWindow = (globalThis as { window?: { localStorage?: PreferenceStorage } }).window;
    return browserWindow?.localStorage ?? null;
  } catch {
    return null;
  }
};

const readStorageItem = (storage: PreferenceStorage | null, key: string) => {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
};

export const normalizeNickname = (value: string) => normalizeNicknameForSave(value).slice(0, NICKNAME_MAX_LENGTH);

export const readStoredText = (
  storage: PreferenceStorage | null,
  key: string,
  fallback: string,
) => readStorageItem(storage, key) || fallback;

export const readStoredBoolean = (
  storage: PreferenceStorage | null,
  key: string,
  fallback: boolean,
) => {
  const stored = readStorageItem(storage, key);
  return stored === null ? fallback : stored === 'true';
};

export const readStoredNumber = <T extends number>(
  storage: PreferenceStorage | null,
  key: string,
  fallback: T,
  allowed: readonly T[],
): T => {
  const stored = Number(readStorageItem(storage, key));
  return allowed.includes(stored as T) ? stored as T : fallback;
};

export const getStoredText = (key: string, fallback: string) =>
  readStoredText(getBrowserStorage(), key, fallback);

export const getStoredBoolean = (key: string, fallback: boolean) =>
  readStoredBoolean(getBrowserStorage(), key, fallback);

export const getStoredNumber = <T extends number>(
  key: string,
  fallback: T,
  allowed: readonly T[],
) => readStoredNumber(getBrowserStorage(), key, fallback, allowed);

export const getStoredPlayMode = (): PlayMode =>
  getStoredText(STORAGE_KEYS.playMode, 'individual') === 'team' ? 'team' : 'individual';

export const RANDOM_NICKNAME_PREFIXES = ['민첩한', '행운의', '반짝이는', '용감한', '느긋한', '쾌활한', '든든한', '재빠른'];
export const RANDOM_NICKNAME_BASES = ['토끼', '호랑이', '두루미', '다람쥐', '구름', '단풍', '별님', '솔방울'];

export const makeRandomNickname = () =>
  `${RANDOM_NICKNAME_PREFIXES[Math.floor(Math.random() * RANDOM_NICKNAME_PREFIXES.length)]} ${RANDOM_NICKNAME_BASES[Math.floor(Math.random() * RANDOM_NICKNAME_BASES.length)]}${Math.floor(Math.random() * 90) + 10}`;

export const getInitialNickname = () => {
  const stored = getStoredText(STORAGE_KEYS.nickname, '');
  const validation = validateNickname(stored);
  return validation.valid ? validation.value : '';
};
