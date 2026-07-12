import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeSpokenYutResult } from '../../src/app/flows/rollSpeech.js';

test('게임 결과 음성 대상 문구를 정규화한다', () => {
  for (const result of ['도', '개', '걸', '윷', '모', '빽도', '낙'] as const) {
    assert.equal(normalizeSpokenYutResult(result), result);
  }
});

test('낙 표시의 느낌표와 공백을 제거한다', () => {
  assert.equal(normalizeSpokenYutResult('  낙!  '), '낙');
  assert.equal(normalizeSpokenYutResult('낙！！'), '낙');
});

test('지원하지 않는 결과 문구는 읽지 않는다', () => {
  assert.equal(normalizeSpokenYutResult('황금 윷'), null);
  assert.equal(normalizeSpokenYutResult('Perfect!'), null);
  assert.equal(normalizeSpokenYutResult(''), null);
});
