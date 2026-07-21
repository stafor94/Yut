import assert from 'node:assert/strict';
import test from 'node:test';
import { ROLL_LANDING_SOUND_DELAY_MS, getRollLandingSoundDelayMs, getRollLandingSoundEffect, getRollOutcomeSoundEffect, isRollResultVisibleForSound, shouldPlayPerfectRollSound } from '../../src/app/flows/rollSound.js';

test('윷과 모는 결과가 노출된 뒤 긍정 효과음을 선택한다', () => {
  assert.equal(getRollOutcomeSoundEffect({ phase: 'result-hold', resultName: '윷' }), 'bonus');
  assert.equal(getRollOutcomeSoundEffect({ phase: 'resolved', resultName: '모' }), 'bonus');
});

test('착지 시점에는 낙이 있어도 roll 효과음이 먼저 재생된다', () => {
  assert.equal(getRollLandingSoundEffect({ phase: 'landing', resultName: '윷', fallCount: 2 }), 'roll');
  assert.equal(getRollLandingSoundEffect({ resultName: '도', fallCount: 1 }), 'roll');
  assert.equal(getRollLandingSoundEffect({ phase: 'landing', resultName: '도', fallCount: 0 }), 'roll');
  assert.equal(getRollOutcomeSoundEffect({ phase: 'result-hold', resultName: '윷', fallCount: 2 }), null);
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

test('착지 효과음은 착지 phase의 충돌 진행률 기준 지연을 사용한다', () => {
  const animationId = 1000;
  assert.equal(getRollLandingSoundDelayMs({ phase: 'primary' }, animationId, animationId), null);
  assert.equal(getRollLandingSoundDelayMs({ phase: 'landing' }, animationId, animationId), ROLL_LANDING_SOUND_DELAY_MS);
  assert.equal(getRollLandingSoundDelayMs({ phase: 'landing' }, animationId, animationId + ROLL_LANDING_SOUND_DELAY_MS + 2200), 0);
});
