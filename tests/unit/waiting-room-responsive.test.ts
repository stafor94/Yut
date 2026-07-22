import assert from 'node:assert/strict';
import test from 'node:test';

const isWaitingRoomSettingsOpenByDefault = (viewportWidth: number) => viewportWidth > 1024;

test('방 설정은 모바일과 태블릿에서 기본으로 접힌다', () => {
  assert.equal(isWaitingRoomSettingsOpenByDefault(390), false);
  assert.equal(isWaitingRoomSettingsOpenByDefault(768), false);
  assert.equal(isWaitingRoomSettingsOpenByDefault(1024), false);
});

test('방 설정은 넓은 데스크톱에서 기본으로 열린다', () => {
  assert.equal(isWaitingRoomSettingsOpenByDefault(1280), true);
});
