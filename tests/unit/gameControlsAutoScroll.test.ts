import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldAutoScrollGameControls } from '../../src/app/flows/rollControlPresentation.js';

const baseInput = {
  hasRoll: false,
  canRollNow: false,
  canRollForTurnOrderNow: false,
  hasActiveTurnOrderIntro: false,
  showBottomBranchControls: false,
  canRequestMove: false,
};

test('윷 던지기 컨트롤이 준비되면 기존처럼 자동 스크롤한다', () => {
  assert.equal(shouldAutoScrollGameControls({
    ...baseInput,
    canRollNow: true,
  }), true);
});

test('지름길 분기와 이동 버튼이 표시되면 roll이 있어도 자동 스크롤한다', () => {
  assert.equal(shouldAutoScrollGameControls({
    ...baseInput,
    hasRoll: true,
    showBottomBranchControls: true,
    canRequestMove: true,
  }), true);
});

test('분기 UI가 없거나 아직 이동할 수 없으면 이동 버튼 스크롤을 시작하지 않는다', () => {
  assert.equal(shouldAutoScrollGameControls({
    ...baseInput,
    hasRoll: true,
    canRequestMove: true,
  }), false);
  assert.equal(shouldAutoScrollGameControls({
    ...baseInput,
    hasRoll: true,
    showBottomBranchControls: true,
  }), false);
});
