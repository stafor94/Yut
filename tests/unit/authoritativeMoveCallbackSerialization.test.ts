import assert from 'node:assert/strict';
import test from 'node:test';
import { createAuthoritativeGameActionQueues } from '../../src/app/flows/authoritativeGameSyncFlow';
import { LocalMovePresentationLifecycle } from '../../src/app/flows/localMovePresentationLifecycle';

const waitImmediate = () => new Promise<void>((resolve) => setImmediate(resolve));

const makeMoveAction = (pieceId: string, clientActionId: string) => ({
  type: 'move_piece',
  payload: { pieceId, clientActionId },
});

test('move result callback은 active local presentation과 독립적으로 즉시 실행된다', async () => {
  const lifecycle = new LocalMovePresentationLifecycle();
  const actionKey = 'move_piece:P1:10:0:piece-1';
  lifecycle.begin(actionKey);
  lifecycle.observe('piece-1');
  const events: string[] = [];
  const action = makeMoveAction('piece-1', actionKey);
  const queues = createAuthoritativeGameActionQueues<typeof action, string>({
    activeRoomIdRef: { current: 'room-a' },
    commit: async () => 'committed',
  });

  queues.enqueueAuthoritativeGameAction('room-a', action, {
    handleResult: () => { events.push('result'); },
    handleError: () => { events.push('error'); },
    handleFinally: () => { events.push('finally'); },
  });
  await waitImmediate();
  await waitImmediate();

  assert.deepEqual(events, ['result', 'finally']);
  assert.equal(lifecycle.isActive(), true);
  lifecycle.cancel();
});

test('move error callback도 presentation settlement로 직렬화하지 않는다', async () => {
  const lifecycle = new LocalMovePresentationLifecycle();
  const actionKey = 'move_piece:P1:10:0:piece-1';
  lifecycle.begin(actionKey);
  lifecycle.observe('piece-1');
  const events: string[] = [];
  const action = makeMoveAction('piece-1', actionKey);
  const queues = createAuthoritativeGameActionQueues<typeof action, string>({
    activeRoomIdRef: { current: 'room-a' },
    commit: async () => { throw new Error('network'); },
  });

  queues.enqueueAuthoritativeGameAction('room-a', action, {
    handleResult: () => { events.push('result'); },
    handleError: () => { events.push('error'); },
    handleFinally: () => { events.push('finally'); },
  });
  await waitImmediate();
  await waitImmediate();

  assert.deepEqual(events, ['error', 'finally']);
  assert.equal(lifecycle.isActive(), true);
  lifecycle.cancel();
});
