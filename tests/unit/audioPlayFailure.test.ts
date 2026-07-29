import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyAudioPlayFailure } from '../../src/shared/audio/audioPlayFailure.js';

test('자동재생 정책 거절과 미디어 로드 실패를 구분한다', () => {
  assert.equal(classifyAudioPlayFailure({ name: 'NotAllowedError' }), 'autoplay-blocked');
  assert.equal(classifyAudioPlayFailure({ name: 'NotSupportedError' }), 'media-load');
  assert.equal(classifyAudioPlayFailure({ name: 'EncodingError' }), 'media-load');
  assert.equal(classifyAudioPlayFailure({ name: 'NetworkError' }), 'media-load');
});

test('빠른 연속 재생에서 발생하는 정상 중단은 경고 대상과 구분한다', () => {
  assert.equal(classifyAudioPlayFailure({ name: 'AbortError' }), 'interrupted');
  assert.equal(classifyAudioPlayFailure({ message: 'The play() request was interrupted by a call to pause().' }), 'interrupted');
  assert.equal(classifyAudioPlayFailure(new Error('unexpected failure')), 'unknown');
});
