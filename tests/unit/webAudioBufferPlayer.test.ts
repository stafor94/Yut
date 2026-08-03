import assert from 'node:assert/strict';
import test from 'node:test';
import {
  __resetWebAudioBufferPlayerForTests,
  __setWebAudioBufferPlayerTestDependencies,
  getSharedAudioContext,
  playWebAudioBuffer,
  preloadWebAudioBuffers,
  resumeSharedAudioContext,
  type WebAudioContextLike,
} from '../../src/shared/audio/webAudioBufferPlayer.js';

const flushAsync = () => new Promise<void>((resolve) => setImmediate(resolve));

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

class FakeGain {
  gain = { value: 1 };
  connectedTo: unknown = null;
  disconnectCount = 0;

  connect(destination: unknown) {
    this.connectedTo = destination;
    return destination;
  }

  disconnect() {
    this.disconnectCount += 1;
  }
}

class FakeSource {
  buffer: object | null = null;
  onended: (() => void) | null = null;
  connectedTo: unknown = null;
  startCount = 0;
  stopCount = 0;
  disconnectCount = 0;
  startError: unknown = null;

  connect(destination: unknown) {
    this.connectedTo = destination;
    return destination;
  }

  start() {
    this.startCount += 1;
    if (this.startError) throw this.startError;
  }

  stop() {
    this.stopCount += 1;
  }

  disconnect() {
    this.disconnectCount += 1;
  }

  end() {
    this.onended?.();
  }
}

class FakeAudioContext implements WebAudioContextLike {
  destination = { kind: 'destination' };
  state = 'suspended';
  resumeCount = 0;
  decodeCount = 0;
  resumeError: unknown = null;
  decodeError: unknown = null;
  nextStartError: unknown = null;
  readonly sources: FakeSource[] = [];
  readonly gains: FakeGain[] = [];

  async resume() {
    this.resumeCount += 1;
    if (this.resumeError) throw this.resumeError;
    this.state = 'running';
  }

  async decodeAudioData(_data: ArrayBuffer): Promise<object> {
    this.decodeCount += 1;
    if (this.decodeError) throw this.decodeError;
    return { decoded: this.decodeCount };
  }

  createBufferSource() {
    const source = new FakeSource();
    source.startError = this.nextStartError;
    this.nextStartError = null;
    this.sources.push(source);
    return source;
  }

  createGain() {
    const gain = new FakeGain();
    this.gains.push(gain);
    return gain;
  }
}

test.afterEach(() => {
  __resetWebAudioBufferPlayerForTests();
});

test('공유 Context와 URL 캐시는 한 번만 생성되고 preload는 source를 시작하지 않는다', async () => {
  const context = new FakeAudioContext();
  let contextCreateCount = 0;
  let fetchCount = 0;
  __setWebAudioBufferPlayerTestDependencies({
    createAudioContext: () => {
      contextCreateCount += 1;
      return context;
    },
    fetch: async () => {
      fetchCount += 1;
      return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(8) };
    },
    warn: () => undefined,
  });

  assert.equal(getSharedAudioContext(), context);
  assert.equal(getSharedAudioContext(), context);
  assert.equal(await resumeSharedAudioContext(), true);
  assert.equal(await preloadWebAudioBuffers(['/same.wav', '/same.wav']), true);
  assert.equal(await preloadWebAudioBuffers(['/same.wav']), true);

  assert.equal(contextCreateCount, 1);
  assert.equal(context.resumeCount, 1);
  assert.equal(fetchCount, 1);
  assert.equal(context.decodeCount, 1);
  assert.equal(context.sources.length, 0);
  assert.equal(context.gains.length, 0);
});

test('source와 gain을 연결하고 음량을 적용하며 같은 키만 교체한다', async () => {
  const context = new FakeAudioContext();
  __setWebAudioBufferPlayerTestDependencies({
    createAudioContext: () => context,
    fetch: async () => ({ ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(8) }),
    warn: () => undefined,
  });

  playWebAudioBuffer({ channel: 'effects', key: 'roll', url: '/roll.wav', volume: 0.38 });
  await flushAsync();
  const firstRoll = context.sources[0];
  const firstGain = context.gains[0];
  assert.equal(firstRoll.startCount, 1);
  assert.equal(firstRoll.connectedTo, firstGain);
  assert.equal(firstGain.connectedTo, context.destination);
  assert.equal(firstGain.gain.value, 0.38);

  playWebAudioBuffer({ channel: 'effects', key: 'move', url: '/move.wav', volume: 0.38 });
  await flushAsync();
  const move = context.sources[1];
  assert.equal(firstRoll.stopCount, 0);
  assert.equal(move.startCount, 1);

  playWebAudioBuffer({ channel: 'effects', key: 'roll', url: '/roll.wav', volume: 0.38 });
  await flushAsync();
  const secondRoll = context.sources[2];
  assert.equal(firstRoll.stopCount, 1);
  assert.equal(move.stopCount, 0);
  assert.equal(secondRoll.startCount, 1);
});

test('decode 대기 중 취소된 요청은 완료 후 시작하지 않는다', async () => {
  const context = new FakeAudioContext();
  const pendingDecode = deferred<object>();
  context.decodeAudioData = async () => {
    context.decodeCount += 1;
    return pendingDecode.promise;
  };
  __setWebAudioBufferPlayerTestDependencies({
    createAudioContext: () => context,
    fetch: async () => ({ ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(8) }),
    warn: () => undefined,
  });

  const stop = playWebAudioBuffer({ channel: 'speech', key: 'result', url: '/yut.wav', volume: 0.9 });
  await flushAsync();
  stop();
  pendingDecode.resolve({ decoded: true });
  await flushAsync();

  assert.equal(context.sources.length, 0);
  assert.equal(context.gains.length, 0);
});

test('교체된 source의 stale onended를 무시하고 현재 source의 정상 종료 콜백은 한 번만 실행한다', async () => {
  const context = new FakeAudioContext();
  __setWebAudioBufferPlayerTestDependencies({
    createAudioContext: () => context,
    fetch: async () => ({ ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(8) }),
    warn: () => undefined,
  });

  let staleEndedCount = 0;
  let activeEndedCount = 0;
  playWebAudioBuffer({
    channel: 'speech',
    key: 'result',
    url: '/yut.wav',
    volume: 0.9,
    onEnded: () => { staleEndedCount += 1; },
  });
  await flushAsync();
  const staleSource = context.sources[0];
  const staleOnEnded = staleSource.onended;

  playWebAudioBuffer({
    channel: 'speech',
    key: 'result',
    url: '/mo.wav',
    volume: 0.9,
    onEnded: () => { activeEndedCount += 1; },
  });
  await flushAsync();
  const activeSource = context.sources[1];

  staleOnEnded?.();
  assert.equal(staleEndedCount, 0);
  assert.equal(activeEndedCount, 0);

  activeSource.end();
  activeSource.end();
  assert.equal(activeEndedCount, 1);
});

test('resume, fetch, decode, start 실패를 처리하고 fetch/decode 실패 캐시는 재시도한다', async () => {
  const warnings: Record<string, unknown>[] = [];

  const resumeContext = new FakeAudioContext();
  resumeContext.resumeError = { name: 'NotAllowedError' };
  __setWebAudioBufferPlayerTestDependencies({
    createAudioContext: () => resumeContext,
    fetch: async () => ({ ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(8) }),
    warn: (_message, details) => warnings.push(details),
  });
  let resumeErrors = 0;
  playWebAudioBuffer({
    channel: 'effects', key: 'roll', url: '/resume.wav', volume: 0.38,
    onError: () => { resumeErrors += 1; },
  });
  await flushAsync();
  assert.equal(resumeErrors, 1);

  const fetchContext = new FakeAudioContext();
  let fetchAttempts = 0;
  __setWebAudioBufferPlayerTestDependencies({
    createAudioContext: () => fetchContext,
    fetch: async () => {
      fetchAttempts += 1;
      if (fetchAttempts === 1) throw new Error('network');
      return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(8) };
    },
    warn: (_message, details) => warnings.push(details),
  });
  assert.equal(await preloadWebAudioBuffers(['/retry-fetch.wav']), false);
  assert.equal(await preloadWebAudioBuffers(['/retry-fetch.wav']), true);
  assert.equal(fetchAttempts, 2);

  const decodeContext = new FakeAudioContext();
  decodeContext.decodeError = new Error('decode');
  __setWebAudioBufferPlayerTestDependencies({
    createAudioContext: () => decodeContext,
    fetch: async () => ({ ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(8) }),
    warn: (_message, details) => warnings.push(details),
  });
  assert.equal(await preloadWebAudioBuffers(['/retry-decode.wav']), false);
  decodeContext.decodeError = null;
  assert.equal(await preloadWebAudioBuffers(['/retry-decode.wav']), true);
  assert.equal(decodeContext.decodeCount, 2);

  const startContext = new FakeAudioContext();
  startContext.nextStartError = new Error('start');
  __setWebAudioBufferPlayerTestDependencies({
    createAudioContext: () => startContext,
    fetch: async () => ({ ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(8) }),
    warn: (_message, details) => warnings.push(details),
  });
  let startErrors = 0;
  playWebAudioBuffer({
    channel: 'effects', key: 'fall', url: '/start.wav', volume: 0.38,
    onError: () => { startErrors += 1; },
  });
  await flushAsync();
  assert.equal(startErrors, 1);
  assert.ok(warnings.length >= 4);
});
