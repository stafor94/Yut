import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const controlSource = readFileSync('src/app/components/RollTimingControl.tsx', 'utf8');

test('타이밍 판정은 합성 애니메이션 시간과 pointerdown 캡처를 사용한다', () => {
  assert.match(controlSource, /getRollTimingPositionPercent/);
  assert.match(controlSource, /getAnimations\(\)\[0\]/);
  assert.match(controlSource, /animation\?\.currentTime/);
  assert.match(controlSource, /onPointerDown=\{handlePointerDown\}/);
  assert.match(controlSource, /onPointerUp=\{handlePointerUp\}/);
  assert.match(controlSource, /onPointerCancel=\{handlePointerCancel\}/);
  assert.match(controlSource, /capturedPointerTimingRef/);
  assert.doesNotMatch(controlSource, /getBoundingClientRect/);
});
