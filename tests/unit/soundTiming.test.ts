import assert from 'node:assert/strict';
import test from 'node:test';
import { ROLL_TO_FALL_SOUND_DELAY_MS, getChainedSoundDelayMs } from '../../src/shared/audio/soundTiming.js';

test('낙 후속 효과음은 roll 재생 시작 500ms 뒤에 예약한다', () => {
  assert.equal(ROLL_TO_FALL_SOUND_DELAY_MS, 500);
  assert.equal(getChainedSoundDelayMs('roll', true), 500);
});

test('후속 효과음이 없거나 roll 이외 효과음이면 별도 지연을 적용하지 않는다', () => {
  assert.equal(getChainedSoundDelayMs('roll', false), null);
  assert.equal(getChainedSoundDelayMs('fall', true), null);
  assert.equal(getChainedSoundDelayMs('turn', true), null);
});
