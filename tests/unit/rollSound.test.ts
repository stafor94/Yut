import assert from 'node:assert/strict';
import test from 'node:test';
import { getRollOutcomeSoundEffect, isRollResultVisibleForSound, shouldPlayPerfectRollSound } from '../../src/app/flows/rollSound.js';

test('윷과 모는 결과가 노출된 뒤 긍정 효과음을 선택한다', () => {
  assert.equal(getRollOutcomeSoundEffect({ phase: 'result-hold', resultName: '윷' }), 'bonus');
  assert.equal(getRollOutcomeSoundEffect({ phase: 'resolved', resultName: '모' }), 'bonus');
});

test('낙은 윷이나 모 결과보다 부정 효과음을 우선한다', () => {
  assert.equal(getRollOutcomeSoundEffect({ phase: 'result-hold', resultName: '윷', fallCount: 2 }), 'fall');
  assert.equal(getRollOutcomeSoundEffect({ resultName: '도', fallCount: 1 }), 'fall');
});

test('회전과 낙하 중에는 결과 효과음을 재생하지 않는다', () => {
  assert.equal(isRollResultVisibleForSound({ phase: 'primary', resultName: '윷' }), false);
  assert.equal(isRollResultVisibleForSound({ phase: 'extra-spin', resultName: '모' }), false);
  assert.equal(isRollResultVisibleForSound({ phase: 'landing', resultName: '도', fallCount: 1 }), false);
  assert.equal(getRollOutcomeSoundEffect({ phase: 'landing', resultName: '모' }), null);
});

test('순서 정하기 굴림에는 게임 결과 전용음을 적용하지 않는다', () => {
  assert.equal(getRollOutcomeSoundEffect({ phase: 'resolved', resultName: '윷', turnOrder: true }), null);
  assert.equal(shouldPlayPerfectRollSound({ timingZone: 'perfect', turnOrder: true }), false);
});

test('Perfect는 일반 굴림에서만 최상위 효과음을 사용한다', () => {
  assert.equal(shouldPlayPerfectRollSound({ timingZone: 'perfect' }), true);
  assert.equal(shouldPlayPerfectRollSound({ timingZone: 'good' }), false);
  assert.equal(shouldPlayPerfectRollSound({ timingZone: 'normal' }), false);
});
