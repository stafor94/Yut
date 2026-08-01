import assert from 'node:assert/strict';
import test from 'node:test';
import { createAuthoritativeGameActionQueues } from '../../src/app/flows/authoritativeGameSyncFlow';
import {
  LocalMovePresentationLifecycle,
  waitForLocalMoveActionPresentation,
} from '../../src/app/flows/localMovePresentationLifecycle';

const waitImmediate = () => new Promise<void>((resolve) => setImmediate(resolve));

const makeMoveAction = (pieceId: string, clientActionId: string) => ({
  type: 'move_piece',
  payload: { pieceId, clientActionId },
});

test('queued move result callback은 matching presentation settlement 뒤에만 실행된다', async () => {
  const lifecycle = new LocalMovePresentationLifecycle();
  const actionKey = 'move_piece:P1:10:0:piece-1';
  const action = makeMoveAction('piece-1', actionKey);
  lifecycle.begin(actionKey);
  lifecycle.observe('piece-1');
  const events: string[] = [];
  const queues = createAuthoritativeGameActionQueues<typeof action, string>({
    activeRoomIdRef: { current: 'room-a' },
    commit: async () => 'committed',
    waitForActionPresentation: (candidate) => waitForLocalMoveActionPresentation(candidate, lifecycle),
  });

  queues.enqueueAuthoritativeGameAction('room-a', action, {
    handleResult: () => { events.push('result'); },
    handleError: () => { events.push('error'); },
    handleFinally: () => { events.push('finally'); },
  });
  await waitImmediate();
  await waitImmediate();
  assert.deepEqual(events, []);

  lifecycle.settle('piece-1');
  await waitImmediate();
  await waitImmediate();
  assert.deepEqual(events, ['result', 'finally']);
});

test('queued move error callback도 stale local frame 종료 뒤에만 실행된다', async () => {
  const lifecycle = new LocalMovePresentationLifecycle();
  const actionKey = 'move_piece:P1:10:0:piece-1';
  const action = makeMoveAction('piece-1', actionKey);
  lifecycle.begin(actionKey);
  lifecycle.observe('piece-1');
  const events: string[] = [];
  const queues = createAuthoritativeGameActionQueues<typeof action, string>({
    activeRoomIdRef: { current: 'room-a' },
    commit: async () => { throw new Error('network'); },
    waitForActionPresentation: (candidate) => waitForLocalMoveActionPresentation(candidate, lifecycle),
  });

  queues.enqueueAuthoritativeGameAction('room-a', action, {
    handleResult: () => { events.push('result'); },
    handleError: () => { events.push('error'); },
    handleFinally: () => { events.push('finally'); },
  });
  await waitImmediate();
  await waitImmediate();
  assert.deepEqual(events, []);

  lifecycle.settle('piece-1');
  await waitImmediate();
  await waitImmediate();
  assert.deepEqual(events, ['error', 'finally']);
});

test('다른 action과 빈 빽도 이동은 active move presentation을 기다리지 않는다', async () => {
  const lifecycle = new LocalMovePresentationLifecycle();
  lifecycle.begin('move_piece:P1:10:0:piece-1');
  lifecycle.observe('piece-1');

  assert.equal(await waitForLocalMoveActionPresentation(makeMoveAction('piece-2', 'move_piece:P1:10:0:piece-2'), lifecycle), false);
  assert.equal(await waitForLocalMoveActionPresentation(makeMoveAction('', 'move_piece:P1:10:0:backdo-pass'), lifecycle), false);
  assert.equal(await waitForLocalMoveActionPresentation({ type: 'roll_yut', payload: { clientActionId: 'roll_yut:P1:10' } }, lifecycle), false);
  lifecycle.cancel();
});
