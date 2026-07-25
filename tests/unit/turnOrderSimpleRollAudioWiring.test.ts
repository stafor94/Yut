import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const overlaySource = readFileSync('src/app/components/TurnOrderIntroOverlay.tsx', 'utf8');
const soundSource = readFileSync('src/shared/audio/sound.ts', 'utf8');
const speechSource = readFileSync('src/shared/audio/yutSpeech.ts', 'utf8');

test('순서 정하기는 타이밍 판정과 낙 확률 없이 기본 윷 확률을 사용한다', () => {
  assert.match(overlaySource, /rollYutResult\(\)/);
  assert.match(overlaySource, /fallCount:\s*0/);
  assert.match(overlaySource, /TURN_ORDER_TIMING_ZONE:\s*RollTimingZone\s*=\s*'normal'/);
  assert.doesNotMatch(overlaySource, /rollYutResultWithTiming|shouldFallForTimingZone|chooseAiRollTimingZone|getRollTimingZone/);
  assert.doesNotMatch(overlaySource, /RollTimingControl/);
  assert.match(overlaySource, /data-testid="turn-order-roll-button"/);
  assert.doesNotMatch(overlaySource, /setLocalRollAnimation\([\s\S]*?timingZone:\s*submission\.timingZone/);
});

test('순서 정하기 윷·모 결과는 bonus 음성을 재생하지 않는다', () => {
  assert.match(speechSource, /turn-order-roll-stage-anchor/);
  assert.match(speechSource, /!isTurnOrderResult\s*&&\s*sequence === playSequence/);
});

test('최종 순서 확정은 door-bang 공통 효과음을 사용한다', () => {
  assert.match(soundSource, /doorBangAudioSource.*door-bang\.wav/);
  assert.match(soundSource, /doorBang:\s*doorBangAudioSource/);
  assert.match(overlaySource, /playStoredSoundEffect\('doorBang'\)/);
  assert.doesNotMatch(overlaySource, /playStoredSoundEffect\('countdownStart'\)/);
});
