import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const viewSource = readFileSync('src/app/components/GameScreenView.tsx', 'utf8');
const controlsSource = readFileSync('src/app/containers/GameBoardControls.tsx', 'utf8');
const recoveryHookSource = readFileSync('src/app/hooks/useStackedRollTimeoutRecovery.ts', 'utf8');
const resolverSource = readFileSync('src/features/room/services/timeoutResolvers.ts', 'utf8');
const qaHelperSource = readFileSync('tests/helpers/stacked-roll-timeout.js', 'utf8');

test('게임 화면은 기존 좌석 제어 규칙으로 빽도 이동 가능한 판 위 말을 계산한다', () => {
  assert.match(viewSource, /getRollStackSelectionAvailability/);
  assert.match(viewSource, /pieces\.some\(\(piece\) => canSeatControlPiece\(activeSeat, piece\) && piece\.started && !piece\.finished\)/);
  assert.match(viewSource, /rollStackSelectionAvailability=\{rollStackSelectionAvailability\}/);
  assert.match(viewSource, /hasBackDoMovablePiece,/);
});

test('직접 선택과 이동 요청은 공통 availability 경계에서 다시 검사한다', () => {
  assert.match(viewSource, /if \(!isRollStackIndexSelectable\(rollStackSelectionAvailability, index\)\) return;/);
  assert.match(viewSource, /onSelectRollStackIndex=\{handleSelectRollStackIndex\}/);
  assert.match(viewSource, /onMoveRollStackIndex=\{handleMoveRollStackIndex\}/);
  assert.match(controlsSource, /disabled=\{!actionReady \|\| turnActionTimedOut \|\| !isRollStackIndexSelectable\(rollStackSelectionAvailability, index\)\}/);
});

test('deadline 자동 선택과 coordinator recovery는 첫 번째 선택 가능한 결과를 사용한다', () => {
  assert.match(controlsSource, /findFirstSelectableRollStackIndex\(rollStackSelectionAvailability\)/);
  assert.match(recoveryHookSource, /hasBackDoMovablePiece,/);
  assert.match(recoveryHookSource, /resolveMoveTimeoutContext\(\{[\s\S]*hasBackDoMovablePiece,/);
  assert.match(resolverSource, /rollStack\.every\(isValidTimeoutMoveRoll\)/);
  assert.match(resolverSource, /getRollStackSelectionAvailability/);
  assert.match(resolverSource, /firstSelectableIndex === 0 \? 'default-first' : 'first-selectable'/);
});

test('Desktop과 Galaxy 공통 timeout QA는 빽도 비활성화와 1번 일반 결과 복구를 검증한다', () => {
  assert.match(qaHelperSource, /\{ name: '빽도', steps: -1 \}/);
  assert.match(qaHelperSource, /await expect\(buttons\.first\(\)\)\.toBeDisabled\(\)/);
  assert.match(qaHelperSource, /await expect\(buttons\.nth\(1\)\)\.toBeEnabled\(\)/);
  assert.match(qaHelperSource, /rollStackIndex: 1/);
  assert.match(qaHelperSource, /expect\(recoverySnapshot\.remainingStack\)\.toEqual\(\[\{ name: '빽도', steps: -1 \}\]\)/);
});
