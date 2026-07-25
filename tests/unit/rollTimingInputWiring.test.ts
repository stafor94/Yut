import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const controlSource = readFileSync('src/app/components/RollTimingControl.tsx', 'utf8');

test('타이밍 판정은 pointerup 순간 화면 좌표를 먼저 확정하고 후속 click 중복을 차단한다', () => {
  assert.match(controlSource, /getVisibleRollTimingPositionPercent/);
  assert.match(controlSource, /getVisibleRollTimingTrackOffsetPx/);
  assert.match(controlSource, /meterRef/);
  assert.match(controlSource, /trackRef/);
  assert.match(controlSource, /orbRef/);
  assert.match(controlSource, /getBoundingClientRect\(\)/);
  assert.match(controlSource, /const visibleSnapshot = getVisibleTimingSnapshot\(\);[\s\S]*visibleSnapshot\?\.positionPercent \?\? getAnimationPositionPercent\(animation\)/);
  assert.match(controlSource, /freezeTimingTrack\(animation, visibleSnapshot\?\.trackOffsetPx\);[\s\S]*onRoll\(positionPercent\)/);
  assert.match(controlSource, /track\.style\.transform = `translate3d\(\$\{trackOffsetPx\}px, 0, 0\)`;[\s\S]*animation\?\.cancel\(\)/);
  assert.match(controlSource, /onPointerDown=\{handlePointerDown\}/);
  assert.match(controlSource, /onPointerUp=\{handlePointerUp\}/);
  assert.match(controlSource, /onPointerCancel=\{handlePointerCancel\}/);
  assert.match(controlSource, /setPointerCapture/);
  assert.match(controlSource, /releasedPointerTimingRef/);
  assert.match(controlSource, /event\.detail > 0/);
  assert.match(controlSource, /event\.clientX/);
  assert.match(controlSource, /event\.clientY/);
  assert.doesNotMatch(controlSource, /const positionPercent = getAnimationPositionPercent\(animation\);[\s\S]*animation\?\.pause\(\);[\s\S]*onRoll\(positionPercent\)/);
});
