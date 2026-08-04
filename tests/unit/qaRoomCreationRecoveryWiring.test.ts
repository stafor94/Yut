import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const uiHelperSource = readFileSync('tests/helpers/ui.js', 'utf8');
const suiteManifestSource = readFileSync('tests/qa/suite-manifest.mjs', 'utf8');

test('QA 방 생성은 UI 지연 문구와 무관하게 서버에 생성된 동일 제목 방만 저장 세션으로 복구한다', () => {
  assert.match(uiHelperSource, /import \{ findRoomIdByTitle \} from '\.\/rooms\.js'/);
  const recoveryBlock = uiHelperSource.match(/async function recoverCreatedRoomSession\(page, roomTitle\) \{([\s\S]*?)\n\}/)?.[1] ?? '';
  assert.match(recoveryBlock, /const roomId = await findRoomIdByTitle\(roomTitle\)/);
  assert.doesNotMatch(recoveryBlock, /getByRole\('status'/, '제품 timeout 문구 전환이 지연돼도 exact room 조회를 막지 않아야 합니다.');
  assert.doesNotMatch(recoveryBlock, /delayedRecoveryStatus/);
  assert.match(uiHelperSource, /localStorage\.setItem\('yut-online:activeRoomId', nextRoomId\)/);
  assert.match(uiHelperSource, /localStorage\.setItem\('yut-online:isRoomHost', 'true'\)/);
  assert.match(uiHelperSource, /await page\.reload\(\{ waitUntil: 'domcontentloaded' \}\)/);
  assert.match(uiHelperSource, /if \(await recoverCreatedRoomSession\(page, roomTitle\)\.catch\(\(\) => false\)\) return true/);
  assert.doesNotMatch(uiHelperSource, /storedRoomRecoveryAttempted/);
  assert.match(uiHelperSource, /submitAttempts < maxSubmitAttempts[\s\S]*retryAlert\.isVisible/);
  assert.match(uiHelperSource, /waitForRoomCreationResult\(page, roomTitle\)/);
});

test('online-core 동시성은 2 workers로 유지하고 장시간 AI presence spec만 desktop regression으로 분산한다', () => {
  const onlineCoreBlock = suiteManifestSource.match(/'online-core': Object\.freeze\(\{([\s\S]*?)\n  \}\),\n  'desktop-sequence'/)?.[1] ?? '';
  const desktopRegressionBlock = suiteManifestSource.match(/'desktop-regression': Object\.freeze\(\{([\s\S]*?)\n  \}\),\n  'mobile-galaxy'/)?.[1] ?? '';

  assert.match(onlineCoreBlock, /workers:\s*2/);
  assert.doesNotMatch(onlineCoreBlock, /ai-presence-recovery\.spec\.js/);
  assert.match(desktopRegressionBlock, /workers:\s*2/);
  assert.match(desktopRegressionBlock, /tests\/game-flow\/ai-presence-recovery\.spec\.js/);
});
