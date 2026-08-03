export const installWebAudioMock = async (target) => {
  await target.addInitScript(() => {
    window.__YUT_QA_WEB_AUDIO_EVENTS__ = [];
    window.__YUT_QA_WEB_AUDIO_SOURCES__ = [];
    window.__YUT_QA_HTML_AUDIO_EVENTS__ = [];

    const originalFetch = window.fetch.bind(window);
    const sourceUrlByEncodedBuffer = new WeakMap();

    window.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : String(input?.url ?? input);
      if (!/\.wav(?:$|[?#])/i.test(url)) return originalFetch(input, init);
      window.__YUT_QA_WEB_AUDIO_EVENTS__.push({ type: 'fetch', src: url, at: performance.now() });
      const encodedBuffer = new ArrayBuffer(8);
      sourceUrlByEncodedBuffer.set(encodedBuffer, url);
      return {
        ok: true,
        status: 200,
        arrayBuffer: async () => encodedBuffer,
      };
    };

    class ForbiddenHtmlAudio extends EventTarget {
      constructor(source = '') {
        super();
        this.src = String(source);
        this.currentTime = 0;
        this.volume = 1;
        this.muted = false;
        this.preload = '';
        this.paused = true;
        window.__YUT_QA_HTML_AUDIO_EVENTS__.push({ type: 'construct', src: this.src });
      }

      load() {
        window.__YUT_QA_HTML_AUDIO_EVENTS__.push({ type: 'load', src: this.src });
      }

      pause() {
        this.paused = true;
        window.__YUT_QA_HTML_AUDIO_EVENTS__.push({ type: 'pause', src: this.src });
      }

      play() {
        this.paused = false;
        window.__YUT_QA_HTML_AUDIO_EVENTS__.push({ type: 'play', src: this.src });
        return Promise.resolve();
      }
    }

    class MockGainNode {
      constructor() {
        this.gain = { value: 1 };
        this.connectedTo = null;
      }

      connect(destination) {
        this.connectedTo = destination;
        return destination;
      }

      disconnect() {
        this.connectedTo = null;
      }
    }

    class MockBufferSourceNode {
      constructor() {
        this.buffer = null;
        this.onended = null;
        this.connectedTo = null;
        this.started = false;
        this.stopped = false;
        window.__YUT_QA_WEB_AUDIO_SOURCES__.push(this);
      }

      connect(destination) {
        this.connectedTo = destination;
        return destination;
      }

      disconnect() {
        this.connectedTo = null;
      }

      start() {
        this.started = true;
        window.__YUT_QA_WEB_AUDIO_EVENTS__.push({
          type: 'start',
          src: this.buffer?.__sourceUrl ?? '',
          gain: this.connectedTo?.gain?.value ?? null,
          at: performance.now(),
          source: this,
        });
      }

      stop() {
        if (this.stopped) return;
        this.stopped = true;
        window.__YUT_QA_WEB_AUDIO_EVENTS__.push({
          type: 'stop',
          src: this.buffer?.__sourceUrl ?? '',
          at: performance.now(),
          source: this,
        });
      }

      __dispatchEnded() {
        this.onended?.();
      }
    }

    class MockAudioContext {
      constructor() {
        this.state = 'suspended';
        this.destination = { kind: 'destination' };
        window.__YUT_QA_WEB_AUDIO_EVENTS__.push({ type: 'context-create', at: performance.now() });
      }

      resume() {
        this.state = 'running';
        window.__YUT_QA_WEB_AUDIO_EVENTS__.push({ type: 'resume', at: performance.now() });
        return Promise.resolve();
      }

      decodeAudioData(encodedBuffer) {
        const sourceUrl = sourceUrlByEncodedBuffer.get(encodedBuffer) ?? '';
        window.__YUT_QA_WEB_AUDIO_EVENTS__.push({ type: 'decode', src: sourceUrl, at: performance.now() });
        return Promise.resolve({ __sourceUrl: sourceUrl });
      }

      createBufferSource() {
        return new MockBufferSourceNode();
      }

      createGain() {
        return new MockGainNode();
      }
    }

    Object.defineProperty(window, 'Audio', {
      configurable: true,
      writable: true,
      value: ForbiddenHtmlAudio,
    });
    Object.defineProperty(window, 'AudioContext', {
      configurable: true,
      writable: true,
      value: MockAudioContext,
    });
    Object.defineProperty(window, 'webkitAudioContext', {
      configurable: true,
      writable: true,
      value: MockAudioContext,
    });
  });
};

export const countWebAudioEvents = (page, type, assetName = null) => page.evaluate(({ eventType, expectedAssetName }) => {
  const pattern = expectedAssetName ? new RegExp(`^${expectedAssetName}(?:-[^.]+)?\\.wav$`) : null;
  return window.__YUT_QA_WEB_AUDIO_EVENTS__.filter((event) => {
    if (event.type !== eventType) return false;
    if (!pattern) return true;
    const filename = decodeURIComponent(String(event.src).split('/').pop()?.split('?')[0] ?? '');
    return pattern.test(filename);
  }).length;
}, { eventType: type, expectedAssetName: assetName });

export const readWebAudioEvents = (page, type, assetName = null) => page.evaluate(({ eventType, expectedAssetName }) => {
  const pattern = expectedAssetName ? new RegExp(`^${expectedAssetName}(?:-[^.]+)?\\.wav$`) : null;
  return window.__YUT_QA_WEB_AUDIO_EVENTS__.filter((event) => {
    if (event.type !== eventType) return false;
    if (!pattern) return true;
    const filename = decodeURIComponent(String(event.src).split('/').pop()?.split('?')[0] ?? '');
    return pattern.test(filename);
  }).map(({ type: currentType, src, gain, at }) => ({ type: currentType, src, gain, at }));
}, { eventType: type, expectedAssetName: assetName });

export const countHtmlAudioEvents = (page, type = null) => page.evaluate((eventType) => (
  window.__YUT_QA_HTML_AUDIO_EVENTS__.filter((event) => !eventType || event.type === eventType).length
), type);

export const dispatchWebAudioEnded = (page, assetName, occurrence = 0) => page.evaluate(({ expectedAssetName, expectedOccurrence }) => {
  const pattern = new RegExp(`^${expectedAssetName}(?:-[^.]+)?\\.wav$`);
  const sources = window.__YUT_QA_WEB_AUDIO_SOURCES__.filter((source) => {
    const filename = decodeURIComponent(String(source.buffer?.__sourceUrl ?? '').split('/').pop()?.split('?')[0] ?? '');
    return source.started && pattern.test(filename);
  });
  const source = sources[expectedOccurrence];
  if (!source) throw new Error(`${expectedAssetName} Web Audio source를 찾지 못했습니다.`);
  source.__dispatchEnded();
}, { expectedAssetName: assetName, expectedOccurrence: occurrence });

export const dispatchLatestWebAudioEnded = (page, assetName) => page.evaluate((expectedAssetName) => {
  const pattern = new RegExp(`^${expectedAssetName}(?:-[^.]+)?\\.wav$`);
  const source = [...window.__YUT_QA_WEB_AUDIO_SOURCES__].reverse().find((candidate) => {
    const filename = decodeURIComponent(String(candidate.buffer?.__sourceUrl ?? '').split('/').pop()?.split('?')[0] ?? '');
    return candidate.started && pattern.test(filename);
  });
  if (!source) throw new Error(`${expectedAssetName} Web Audio source를 찾지 못했습니다.`);
  source.__dispatchEnded();
}, assetName);
