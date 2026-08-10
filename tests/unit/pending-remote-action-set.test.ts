import assert from 'node:assert/strict';
import test from 'node:test';
import { PresentationAwarePendingActionSet } from '../../src/app/hooks/pendingRemoteActionSet';

test('renderer roll presentation은 pending size를 차단하되 실제 action entry로 열거되지 않는다', () => {
  let presentationActive = false;
  const pending = new PresentationAwarePendingActionSet(() => presentationActive);

  assert.equal(pending.size, 0);
  assert.deepEqual([...pending], []);

  presentationActive = true;
  assert.equal(pending.size, 1);
  assert.deepEqual([...pending], []);
  assert.equal(pending.has('__roll_presentation_active__'), false);

  pending.add('roll_yut:seat-1:12');
  assert.equal(pending.size, 2);
  assert.deepEqual([...pending], ['roll_yut:seat-1:12']);

  presentationActive = false;
  assert.equal(pending.size, 1);
  assert.deepEqual([...pending], ['roll_yut:seat-1:12']);
});

test('presentation 종료 뒤 기존 Set semantics로 즉시 복귀한다', () => {
  let presentationActive = true;
  const pending = new PresentationAwarePendingActionSet(() => presentationActive);
  pending.add('move_piece:seat-1:12');

  assert.equal(pending.size, 2);
  assert.equal(pending.delete('move_piece:seat-1:12'), true);
  assert.equal(pending.size, 1);

  presentationActive = false;
  assert.equal(pending.size, 0);
});
