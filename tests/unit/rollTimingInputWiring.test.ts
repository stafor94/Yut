import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const controlSource = readFileSync('src/app/components/RollTimingControl.tsx', 'utf8');

test('타이밍 판정은 합성 애니메이션의 pointerup 시점을 제출하고 후속 click 중복을 차단한다', () => {
  assert.match(controlSource, /getRollTimingPositionPercent/);
  assert.match(controlSource, /getAnimations\(\)\[0\]/);
  assert.match(controlSource, /animation\?\.currentTime/);
  assert.match(controlSource, /animation\?\.pause\(\)/);
  assert.match(controlSource, /onPointerDown=\{handlePointerDown\}/);
  assert.match(controlSource, /onPointerUp=\{handlePointerUp\}/);
  assert.match(controlSource, /onPointerCancel=\{handlePointerCancel\}/);
  assert.match(controlSource, /setPointerCapture/);
  assert.match(controlSource, /submitCurrentTiming\(\)/);
  assert.match(controlSource, /submittedPointerTimingRef/);
  assert.match(controlSource, /event\.detail > 0/);
  assert.match(controlSource, /event\.clientX/);
  assert.match(controlSource, /event\.clientY/);
  assert.doesNotMatch(controlSource, /positionPercent: number/);
  assert.doesNotMatch(controlSource, /meterRef|orbRef|getVisibleRollTimingPositionPercent/);
});
