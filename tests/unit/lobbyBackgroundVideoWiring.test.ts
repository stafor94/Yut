import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const lobbyContainerSource = readFileSync('src/app/containers/LobbyContainer.tsx', 'utf8');
const lobbyVideoCss = readFileSync('src/styles/lobby-background-video.css', 'utf8');
const mainSource = readFileSync('src/main.tsx', 'utf8');

test('로비는 업로드된 MP4를 무음 자동 반복 배경으로 렌더링한다', () => {
  const videoMarkup = lobbyContainerSource.match(/<video[\s\S]*?\/>/u)?.[0] ?? '';

  assert.match(lobbyContainerSource, /`\$\{import\.meta\.env\.BASE_URL\}lobby-background\.mp4`/u);
  assert.match(lobbyContainerSource, /`\$\{import\.meta\.env\.BASE_URL\}lobby-background-original\.png`/u);
  assert.match(videoMarkup, /data-testid="lobby-background-video"/u);
  assert.match(videoMarkup, /src=\{LOBBY_BACKGROUND_VIDEO_URL\}/u);
  assert.match(videoMarkup, /poster=\{LOBBY_BACKGROUND_POSTER_URL\}/u);
  assert.match(videoMarkup, /\bautoPlay\b/u);
  assert.match(videoMarkup, /\bloop\b/u);
  assert.match(videoMarkup, /\bmuted\b/u);
  assert.match(videoMarkup, /\bplaysInline\b/u);
  assert.match(videoMarkup, /preload="auto"/u);
});

test('로비 배경 영상은 전체 화면 cover로 배치되고 동작 감소 설정에서는 정적 배경으로 폴백한다', () => {
  assert.match(mainSource, /import '\.\/styles\/lobby-background-video\.css';/u);
  assert.match(lobbyVideoCss, /position:\s*fixed/u);
  assert.match(lobbyVideoCss, /object-fit:\s*cover/u);
  assert.match(lobbyVideoCss, /pointer-events:\s*none/u);
  assert.match(lobbyVideoCss, /prefers-reduced-motion:\s*reduce/u);
  assert.match(lobbyVideoCss, /display:\s*none/u);
});
