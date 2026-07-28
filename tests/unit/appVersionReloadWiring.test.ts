import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const lobbySource = readFileSync('src/app/containers/LobbyContainer.tsx', 'utf8');
const hookSource = readFileSync('src/app/hooks/useLobbyAppVersionReload.ts', 'utf8');
const viteConfigSource = readFileSync('vite.config.ts', 'utf8');
const viteEnvSource = readFileSync('src/vite-env.d.ts', 'utf8');
const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as { scripts?: Record<string, string> };

test('버전 확인 훅은 로비 컨테이너가 표시될 때만 마운트된다', () => {
  assert.match(lobbySource, /import \{ useLobbyAppVersionReload \} from '\.\.\/hooks\/useLobbyAppVersionReload';/);
  assert.match(lobbySource, /export function LobbyContainer[\s\S]*useLobbyAppVersionReload\(\);/);
});

test('로비 버전 확인은 즉시·주기·화면 복귀·온라인 복구에 실행되고 unmount 시 취소된다', () => {
  assert.match(hookSource, /LOBBY_APP_VERSION_CHECK_INTERVAL_MS = 30_000/);
  assert.match(hookSource, /void checkForUpdate\(\);[\s\S]*window\.setInterval/);
  assert.match(hookSource, /document\.addEventListener\('visibilitychange'/);
  assert.match(hookSource, /window\.addEventListener\('focus'/);
  assert.match(hookSource, /window\.addEventListener\('online'/);
  assert.match(hookSource, /disposed = true;[\s\S]*activeController\?\.abort\(\)/);
  assert.match(hookSource, /cache: 'no-store'/);
  assert.match(hookSource, /import\.meta\.env\.BASE_URL/);
});

test('새 버전 자동 갱신은 동일 버전 반복 실행을 막는다', () => {
  assert.match(hookSource, /yut:last-auto-reload-version/);
  assert.match(hookSource, /shouldReloadForAppVersion/);
  assert.match(hookSource, /shouldClearAppVersionReloadMarker/);
  assert.match(hookSource, /window\.location\.reload\(\)/);
});

test('빌드는 동일 버전을 번들과 version manifest에 기록하고 산출물을 검증한다', () => {
  assert.match(viteConfigSource, /fileName: 'version\.json'/);
  assert.match(viteConfigSource, /__APP_VERSION__: JSON\.stringify\(version\)/);
  assert.match(viteEnvSource, /declare const __APP_VERSION__: string/);
  assert.match(packageJson.scripts?.build ?? '', /verify-build-version\.mjs/);
  assert.match(packageJson.scripts?.['build:qa'] ?? '', /verify-build-version\.mjs/);
});
