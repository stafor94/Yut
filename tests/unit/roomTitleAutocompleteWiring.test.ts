import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const lobbyScreenSource = readFileSync('src/app/screens/LobbyScreen.tsx', 'utf8');

test('방 제목 입력은 브라우저 자동완성 제안을 비활성화한다', () => {
  const roomTitleInput = lobbyScreenSource.match(/<input id="room-title-input"[\s\S]*?\/>/u)?.[0] ?? '';

  assert.match(roomTitleInput, /name="new-room-title"/u);
  assert.match(roomTitleInput, /autoComplete="off"/u);
});
