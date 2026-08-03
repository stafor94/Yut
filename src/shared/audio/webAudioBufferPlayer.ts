import { classifyAudioPlayFailure } from './audioPlayFailure.js';

type WebAudioBuffer = object;

type WebAudioBufferSource = {
  buffer: WebAudioBuffer | null;
  onended: (() => void) | null;
  connect(destination: unknown): unknown;
  disconnect?: () => void;
  start(when?: number): void;
  stop(when?: number): void;
};

type WebAudioGain = {
  gain: { value: number };
  connect(destination: unknown): unknown;
  disconnect?: () => void;
};

export type WebAudioContextLike = {
  readonly destination: unknown;
  readonly state: string;
  createBufferSource(): WebAudioBufferSource;
  createGain(): WebAudioGain;
  decodeAudioData(data: ArrayBuffer): Promise<WebAudioBuffer>;
  resume(): Promise<void>;
};

type FetchAudioResponse = {
  readonly ok: boolean;
  readonly status: number;
  arrayBuffer(): Promise<ArrayBuffer>;
};

type FetchAudioSource = (url: string) => Promise<FetchAudioResponse>;

type AudioContextConstructor = new () => WebAudioContextLike;

type AudioRuntime = {
  AudioContext?: AudioContextConstructor;
  webkitAudioContext?: AudioContextConstructor;
  fetch?: FetchAudioSource;
};

export type WebAudioBufferPlayerTestDependencies = {
  createAudioContext?: () => WebAudioContextLike | null;
  fetch?: FetchAudioSource;
  warn?: (message: string, details: Record<string, unknown>) => void;
};

export type PlayWebAudioBufferOptions = {
  channel: string;
  key: string;
  url: string;
  volume: number;
  onStarted?: () => void;
  onEnded?: () => void;
  onError?: (error: unknown) => void;
};

type ActivePlayback = {
  readonly channel: string;
  readonly mapKey: string;
  readonly url: string;
  readonly volume: number;
  readonly onStarted?: () => void;
  readonly onEnded?: () => void;
  readonly onError?: (error: unknown) => void;
  cancelled: boolean;
  completed: boolean;
  source: WebAudioBufferSource | null;
  gain: WebAudioGain | null;
};

const bufferPromiseByUrl = new Map<string, Promise<WebAudioBuffer>>();
const activePlaybackByKey = new Map<string, ActivePlayback>();
const warnedFailures = new Set<string>();

let sharedAudioContext: WebAudioContextLike | null = null;
let testDependencies: WebAudioBufferPlayerTestDependencies | null = null;

const getRuntime = () => globalThis as unknown as AudioRuntime;
const makeMapKey = (channel: string, key: string) => `${channel}\u0000${key}`;

const reportFailure = (stage: 'context' | 'resume' | 'fetch' | 'decode' | 'start', url: string | null, error: unknown) => {
  const kind = classifyAudioPlayFailure(error);
  if (kind === 'interrupted') return;
  const warningKey = `${stage}:${url ?? 'shared'}:${kind}`;
  if (warnedFailures.has(warningKey)) return;
  warnedFailures.add(warningKey);
  const warn = testDependencies?.warn ?? ((message: string, details: Record<string, unknown>) => console.warn(message, details));
  warn('[audio] Web Audio buffer playback failed', { stage, url, kind, error });
};

export const getSharedAudioContext = () => {
  if (sharedAudioContext) return sharedAudioContext;

  try {
    if (testDependencies?.createAudioContext) {
      sharedAudioContext = testDependencies.createAudioContext();
      return sharedAudioContext;
    }
    const runtime = getRuntime();
    const ContextConstructor = runtime.AudioContext ?? runtime.webkitAudioContext;
    sharedAudioContext = ContextConstructor ? new ContextConstructor() : null;
    return sharedAudioContext;
  } catch (error) {
    reportFailure('context', null, error);
    return null;
  }
};

export const resumeSharedAudioContext = async () => {
  const context = getSharedAudioContext();
  if (!context) return false;
  if (context.state === 'running') return true;

  try {
    await context.resume();
    return context.state === 'running';
  } catch (error) {
    reportFailure('resume', null, error);
    return false;
  }
};

const fetchAndDecodeAudioBuffer = (url: string) => {
  const cached = bufferPromiseByUrl.get(url);
  if (cached) return cached;

  const promise = (async () => {
    const context = getSharedAudioContext();
    if (!context) throw new Error('Web Audio API is unavailable.');

    const fetchAudio = testDependencies?.fetch ?? getRuntime().fetch;
    if (!fetchAudio) throw new Error('Fetch API is unavailable.');

    let response: FetchAudioResponse;
    try {
      response = await fetchAudio(url);
    } catch (error) {
      reportFailure('fetch', url, error);
      throw error;
    }
    if (!response.ok) {
      const error = new Error(`Audio request failed with HTTP ${response.status}.`);
      reportFailure('fetch', url, error);
      throw error;
    }

    let encodedAudio: ArrayBuffer;
    try {
      encodedAudio = await response.arrayBuffer();
    } catch (error) {
      reportFailure('fetch', url, error);
      throw error;
    }

    try {
      return await context.decodeAudioData(encodedAudio);
    } catch (error) {
      reportFailure('decode', url, error);
      throw error;
    }
  })();

  bufferPromiseByUrl.set(url, promise);
  void promise.catch(() => {
    if (bufferPromiseByUrl.get(url) === promise) bufferPromiseByUrl.delete(url);
  });
  return promise;
};

export const preloadWebAudioBuffers = async (urls: readonly string[]) => {
  const uniqueUrls = [...new Set(urls)];
  const results = await Promise.all(uniqueUrls.map((url) => fetchAndDecodeAudioBuffer(url)
    .then(() => true)
    .catch(() => false)));
  return results.every(Boolean);
};

const disconnectPlayback = (playback: ActivePlayback) => {
  try {
    playback.source?.disconnect?.();
  } catch {
    // A source may already be disconnected by the browser after ending.
  }
  try {
    playback.gain?.disconnect?.();
  } catch {
    // A gain node may already be disconnected by the browser after ending.
  }
  playback.source = null;
  playback.gain = null;
};

const stopPlayback = (playback: ActivePlayback) => {
  if (playback.cancelled || playback.completed) return;
  playback.cancelled = true;
  if (activePlaybackByKey.get(playback.mapKey) === playback) activePlaybackByKey.delete(playback.mapKey);
  const source = playback.source;
  const gain = playback.gain;
  playback.source = null;
  playback.gain = null;
  if (source) {
    try {
      source.stop();
    } catch {
      // Stopping an already-ended source is harmless and must not affect game flow.
    }
    try {
      source.disconnect?.();
    } catch {
      // Ignore disconnect races with the native ended event.
    }
  }
  try {
    gain?.disconnect?.();
  } catch {
    // Ignore disconnect races with the native ended event.
  }
};

export const stopWebAudioPlayback = (channel: string, key: string) => {
  const playback = activePlaybackByKey.get(makeMapKey(channel, key));
  if (playback) stopPlayback(playback);
};

export const stopWebAudioChannel = (channel: string) => {
  for (const playback of [...activePlaybackByKey.values()]) {
    if (playback.channel === channel) stopPlayback(playback);
  }
};

const failPlayback = (playback: ActivePlayback, stage: 'resume' | 'start' | null, error: unknown) => {
  if (playback.cancelled || playback.completed || activePlaybackByKey.get(playback.mapKey) !== playback) return;
  playback.completed = true;
  activePlaybackByKey.delete(playback.mapKey);
  disconnectPlayback(playback);
  if (stage) reportFailure(stage, playback.url, error);
  playback.onError?.(error);
};

const startPlayback = async (playback: ActivePlayback) => {
  const context = getSharedAudioContext();
  if (!context) {
    failPlayback(playback, 'start', new Error('Web Audio API is unavailable.'));
    return;
  }

  const contextReady = await resumeSharedAudioContext();
  if (!contextReady) {
    failPlayback(playback, null, new Error('AudioContext did not enter the running state.'));
    return;
  }

  let buffer: WebAudioBuffer;
  try {
    buffer = await fetchAndDecodeAudioBuffer(playback.url);
  } catch (error) {
    failPlayback(playback, null, error);
    return;
  }

  if (playback.cancelled || playback.completed || activePlaybackByKey.get(playback.mapKey) !== playback) return;

  try {
    const source = context.createBufferSource();
    const gain = context.createGain();
    source.buffer = buffer;
    gain.gain.value = playback.volume;
    source.connect(gain);
    gain.connect(context.destination);
    playback.source = source;
    playback.gain = gain;
    source.onended = () => {
      if (
        playback.cancelled
        || playback.completed
        || activePlaybackByKey.get(playback.mapKey) !== playback
        || playback.source !== source
      ) return;
      playback.completed = true;
      activePlaybackByKey.delete(playback.mapKey);
      disconnectPlayback(playback);
      playback.onEnded?.();
    };
    source.start();
    playback.onStarted?.();
  } catch (error) {
    failPlayback(playback, 'start', error);
  }
};

export const playWebAudioBuffer = (options: PlayWebAudioBufferOptions) => {
  const mapKey = makeMapKey(options.channel, options.key);
  const previousPlayback = activePlaybackByKey.get(mapKey);
  if (previousPlayback) stopPlayback(previousPlayback);

  const playback: ActivePlayback = {
    channel: options.channel,
    mapKey,
    url: options.url,
    volume: options.volume,
    onStarted: options.onStarted,
    onEnded: options.onEnded,
    onError: options.onError,
    cancelled: false,
    completed: false,
    source: null,
    gain: null,
  };
  activePlaybackByKey.set(mapKey, playback);
  void startPlayback(playback).catch((error) => failPlayback(playback, 'start', error));

  return () => stopPlayback(playback);
};

export const __setWebAudioBufferPlayerTestDependencies = (dependencies: WebAudioBufferPlayerTestDependencies) => {
  __resetWebAudioBufferPlayerForTests();
  testDependencies = dependencies;
};

export const __resetWebAudioBufferPlayerForTests = () => {
  for (const playback of [...activePlaybackByKey.values()]) stopPlayback(playback);
  activePlaybackByKey.clear();
  bufferPromiseByUrl.clear();
  warnedFailures.clear();
  sharedAudioContext = null;
  testDependencies = null;
};
