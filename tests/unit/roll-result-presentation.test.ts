import test from 'node:test';
import assert from 'node:assert/strict';
import { getRollResultPresentation } from '../../src/app/flows/rollResultPresentation';
import type { YutResult } from '../../src/game-core/roll';

const present = (result: YutResult, fallCount = 0, turnOrder = false) => getRollResultPresentation({ result, fallCount, turnOrder });

test('도·개·걸 결과는 이동 칸 수를 함께 표시한다', () => {
  assert.deepEqual(present({ name: '도', steps: 1 }), {
    label: '도',
    description: '1칸 이동',
    tone: 'standard',
    leadingSymbol: '',
    trailingSymbol: '',
  });
  assert.equal(present({ name: '개', steps: 2 }).description, '2칸 이동');
  assert.equal(present({ name: '걸', steps: 3 }).description, '3칸 이동');
});

test('윷·모와 빽도는 보너스·후진 의미를 구분한다', () => {
  assert.deepEqual(present({ name: '윷', steps: 4, bonus: true }), {
    label: '윷',
    description: '4칸 이동 · 한 번 더',
    tone: 'bonus',
    leadingSymbol: '',
    trailingSymbol: '✦',
  });
  assert.equal(present({ name: '모', steps: 5, bonus: true }).description, '5칸 이동 · 한 번 더');
  assert.deepEqual(present({ name: '빽도', steps: -1 }), {
    label: '빽도',
    description: '1칸 뒤로',
    tone: 'backdo',
    leadingSymbol: '↶',
    trailingSymbol: '',
  });
});

test('낙과 순서 결정은 이동 설명보다 우선한다', () => {
  assert.deepEqual(present({ name: '걸', steps: 3 }, 1), {
    label: '낙',
    description: '던지기 실패',
    tone: 'fall',
    leadingSymbol: '',
    trailingSymbol: '',
  });
  assert.equal(present({ name: '모', steps: 5, bonus: true }, 0, true).description, '순서 결정');
});
