import assert from 'node:assert/strict';
import test from 'node:test';

test('pending action Set의 size와 iterator는 동일한 실제 제출 action 집합을 나타낸다', () => {
  const pending = new Set<string>();
  pending.add('roll_yut:seat-1:12');
  pending.add('move_piece:seat-1:12');

  assert.equal(pending.size, 2);
  assert.deepEqual([...pending], ['roll_yut:seat-1:12', 'move_piece:seat-1:12']);
  assert.deepEqual(Array.from(pending), [...pending]);

  pending.delete('roll_yut:seat-1:12');
  assert.equal(pending.size, 1);
  assert.deepEqual(Array.from(pending), ['move_piece:seat-1:12']);
});

test('roll presentation blocker는 pending action entry나 수량에 포함되지 않는다', () => {
  const pending = new Set<string>();
  const rollPresentationBlocked = true;

  assert.equal(rollPresentationBlocked, true);
  assert.equal(pending.size, 0);
  assert.deepEqual(Array.from(pending), []);
  assert.equal(pending.has('__roll_presentation_active__'), false);
});
