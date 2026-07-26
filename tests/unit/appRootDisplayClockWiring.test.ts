import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const readSource = (path: string) => readFileSync(path, 'utf8');

test('App 루트에 고주기 표시 clock 상태와 interval 갱신을 두지 않는다', () => {
  const appSource = readSource('src/app/App.tsx');
  const removedStateNames = [
    'playTimeNow',
    'turnOrderClock',
    'rollLockClock',
    'trapPlacementClock',
    'itemPickupClock',
  ];
  const removedSetterNames = [
    'setPlayTimeNow',
    'setTurnOrderClock',
    'setRollLockClock',
    'setTrapPlacementClock',
    'setItemPickupClock',
  ];

  for (const stateName of removedStateNames) {
    assert.equal(appSource.includes(`const [${stateName},`), false, `${stateName} 상태가 App 루트에 남아 있습니다.`);
  }
  for (const setterName of removedSetterNames) {
    assert.equal(appSource.includes(setterName), false, `${setterName} 갱신 경로가 App 루트에 남아 있습니다.`);
  }

  assert.match(appSource, /setRollResultReadyAt\(0\)/, 'roll result hold의 deadline 직접 해제가 유지되어야 합니다.');
  assert.match(appSource, /useDeadlineReached\(rollLockUntil\)/, 'roll lock은 deadline당 한 번만 App을 갱신해야 합니다.');
});

test('표시 clock은 실제 표시 하위 컴포넌트에서만 구독한다', () => {
  const headerSource = readSource('src/app/components/AppShellHeader.tsx');
  const modalSource = readSource('src/app/components/AppModals.tsx');
  const gameScreenSource = readSource('src/app/components/GameScreenView.tsx');
  const controllerSource = readSource('src/app/controllers/useGameStartController.ts');

  assert.match(headerSource, /useDisplayClock\(/);
  assert.match(modalSource, /useDisplayClock\(/);
  assert.match(gameScreenSource, /useDisplayClock\(/);
  assert.equal(controllerSource.includes('useTurnOrderClock'), false);
  assert.equal(controllerSource.includes('setTurnOrderClock'), false);
});
