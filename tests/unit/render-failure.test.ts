import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeRenderFailure } from '../../src/app/flows/renderFailure';

test('normalizes Error instances for render recovery diagnostics', () => {
  const error = new TypeError('render failed');
  const failure = normalizeRenderFailure(error, 1234);

  assert.equal(failure.name, 'TypeError');
  assert.equal(failure.message, 'render failed');
  assert.equal(failure.capturedAt, 1234);
  assert.match(failure.stack, /render failed/);
});

test('normalizes non-Error render failures without throwing', () => {
  const cyclic: Record<string, unknown> = { reason: 'invalid state' };
  cyclic.self = cyclic;

  assert.deepEqual(normalizeRenderFailure('plain failure', 10), {
    name: 'RenderError',
    message: 'plain failure',
    stack: '',
    capturedAt: 10,
  });
  assert.deepEqual(normalizeRenderFailure(cyclic, 20), {
    name: 'RenderError',
    message: '알 수 없는 화면 오류가 발생했습니다.',
    stack: '',
    capturedAt: 20,
  });
});
