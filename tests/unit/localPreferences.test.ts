import assert from 'node:assert/strict';
import test from 'node:test';
import {
  STORAGE_KEYS,
  getInitialNickname,
  getStoredBoolean,
  getStoredNumber,
  getStoredPlayMode,
  getStoredText,
  normalizeNickname,
} from '../../src/app/preferences/localPreferences';

const originalLocalStorage = (globalThis as { localStorage?: unknown }).localStorage;

test.afterEach(() => {
  if (originalLocalStorage === undefined) {
    delete (globalThis as { localStorage?: unknown }).localStorage;
    return;
  }
  (globalThis as { localStorage?: unknown }).localStorage = originalLocalStorage;
});

const installStorage = (values: Record<string, string>) => {
  (globalThis as { localStorage?: { getItem: (key: string) => string | null } }).localStorage = {
    getItem: (key) => values[key] ?? null,
  };
};

test('Node 저장소가 없어도 fallback 설정 값을 반환한다', () => {
  delete (globalThis as { localStorage?: unknown }).localStorage;

  assert.equal(getStoredText(STORAGE_KEYS.title, '기본 제목'), '기본 제목');
  assert.equal(getStoredBoolean(STORAGE_KEYS.itemMode, true), true);
  assert.equal(getStoredNumber(STORAGE_KEYS.maxPlayers, 4, [2, 3, 4] as const), 4);
  assert.equal(getStoredPlayMode(), 'individual');
});

test('저장된 설정을 허용된 타입으로 정규화한다', () => {
  installStorage({
    [STORAGE_KEYS.title]: '저장된 제목',
    [STORAGE_KEYS.itemMode]: 'false',
    [STORAGE_KEYS.maxPlayers]: '3',
    [STORAGE_KEYS.playMode]: 'team',
  });

  assert.equal(getStoredText(STORAGE_KEYS.title, '기본 제목'), '저장된 제목');
  assert.equal(getStoredBoolean(STORAGE_KEYS.itemMode, true), false);
  assert.equal(getStoredNumber(STORAGE_KEYS.maxPlayers, 4, [2, 3, 4] as const), 3);
  assert.equal(getStoredPlayMode(), 'team');
});

test('닉네임은 공백을 제거하고 최대 길이를 넘기지 않는다', () => {
  assert.equal(normalizeNickname('  길고긴닉네임입니다  '), '길고긴닉네임입');
});

test('저장된 닉네임이 없으면 생성 닉네임도 동일한 길이 규칙을 통과한다', () => {
  installStorage({});

  assert.ok(getInitialNickname().length <= 7);
});
