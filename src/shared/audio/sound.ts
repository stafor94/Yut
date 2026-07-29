import { bindYutResultSpeech } from './yutSpeech';
import { classifyAudioPlayFailure, type AudioPlayFailureKind } from './audioPlayFailure';
import { getChainedSoundDelayMs } from './soundTiming';
import arriveAudioSource from './assets/effects/arrive-original.wav';
import captureAudioSource from './assets/effects/capture-original.wav';
import countdownAudioSource from './assets/effects/countdown-original.wav';
import countdownStartAudioSource from './assets/effects/countdown-start-original.wav';
import doorBangAudioSource from './assets/effects/door-bang.wav';
import fallAudioSource from './assets/effects/fall-original.wav';
import itemPickupAudioSource from './assets/effects/item-pickup-original.wav';
import itemUseAudioSource from './assets/effects/item-use-original.wav';
import moveAudioSource from './assets/effects/move-original.wav';
import perfectAudioSource from './assets/effects/perfect-original.wav';
import rollAudioSource from './assets/effects/roll_original.wav';
import shieldAudioSource from './assets/effects/shield-original.wav';
import stackAudioSource from './assets/effects/stack-original.wav';
import toastAudioSource from './assets/effects/toast-original.wav';
import trapAudioSource from './assets/effects/trap-original.wav';
import turnAudioSource from './assets/effects/turn-original.wav';
import winAudioSource from './assets/effects/win-original.wav';

export type SoundEffect = 'countdown' | 'countdownStart' | 'doorBang' | 'turn' | 'roll' | 'bonus' | 'perfect' | 'fall' | 'move' | 'arrive' | 'stack' | 'capture' | 'itemPickup' | 'itemUse' | 'trap' | 'shield' | 'win' | 'toast';

const SOUND_ENABLED_STORAGE_KEY = 'yut-online:soundEnabled';
const SOUND_EFFECT_VOLUME = 0.38;

const WAV_EFFECT_SOURCES = {
  arrive: arriveAudioSource,
  capture: captureAudioSource,
  countdown: countdownAudioSource,
  countdownStart: countdownStartAudioSource,
  doorBang: doorBangAudioSource,
  fall: fallAudioSource,
  itemPickup: itemPickupAudioSource,
  itemUse: itemUseAudioSource,
  move: moveAudioSource,
  perfect: perfectAudioSource,
  roll: rollAudioSource,
  shield: shieldAudioSource,
  stack: stackAudioSource,
  toast: toastAudioSource,
  trap: trapAudioSource,
  turn: turnAudioSource,
  win: winAudioSource,
} satisfies Partial<Record<SoundEffect, string>>;

type WavSoundEffect = keyof typeof WAV_EFFECT_SOURCES;
type EffectAudioUnlockState = 'locked' | 'unlocking' | 'unlocked';

const effectAudioByEffect = new Map<WavSoundEffect, HTMLAudioElement>();
const effectAudioUnlockState = new WeakMap<HTMLAudioElement, EffectAudioUnlockState>();
const warnedAudioFailures = new Set<string>();

let audioContext: AudioContext | null = null;
let soundUnlockBound = false;
let soundUnlockComplete = false;
let wavEffectAudioUnlocked = false;
let wavEffectUnlockPromise: Promise<boolean> | null = null;
const lastPlayedEffectAt = new Map<SoundEffect, number>();

const getEffectAudio = (effect: WavSoundEffect) => {
  const cachedAudio = effectAudioByEffect.get(effect);
  if (cachedAudio) return cachedAudio;
  if (typeof Audio === 'undefined') return null;
  const audio = new Audio(WAV_EFFECT_SOURCES[effect]);
  audio.preload = 'auto';
  audio.volume = SOUND_EFFECT_VOLUME;
  effectAudioByEffect.set(effect, audio);
  effectAudioUnlockState.set(audio, 'locked');
  return audio;
};

const reportAudioPlayFailure = (effect: WavSoundEffect, stage: 'unlock' | 'playback', error: unknown) => {
  const kind = classifyAudioPlayFailure(error);
  if (kind === 'interrupted') return kind;

  const warningKey = stage === 'unlock' ? `${stage}:${kind}` : `${stage}:${effect}:${kind}`;
  if (!warnedAudioFailures.has(warningKey)) {
    warnedAudioFailures.add(warningKey);
    console.warn('[audio] WAV effect playback failed', {
      effect,
      kind,
      stage,
      unlockState: effectAudioUnlockState.get(effectAudioByEffect.get(effect) as HTMLAudioElement) ?? 'unknown',
      error,
    });
  }
  return kind;
};

const resetPreparedEffectAudio = (audio: HTMLAudioElement, muted: boolean, volume: number) => {
  audio.pause();
  audio.currentTime = 0;
  audio.muted = muted;
  audio.volume = volume;
};

const unlockWavEffectAudio = () => {
  if (wavEffectAudioUnlocked || typeof Audio === 'undefined') return Promise.resolve(true);
  if (wavEffectUnlockPromise) return wavEffectUnlockPromise;

  wavEffectUnlockPromise = Promise.all((Object.keys(WAV_EFFECT_SOURCES) as WavSoundEffect[]).map(async (effect) => {
    const audio = getEffectAudio(effect);
    if (!audio) return true;
    if (effectAudioUnlockState.get(audio) === 'unlocked') return true;

    const previousMuted = audio.muted;
    const previousVolume = audio.volume;
    effectAudioUnlockState.set(audio, 'unlocking');
    audio.pause();
    audio.currentTime = 0;
    audio.muted = true;
    audio.volume = 0;

    try {
      await audio.play();
      resetPreparedEffectAudio(audio, previousMuted, previousVolume);
      effectAudioUnlockState.set(audio, 'unlocked');
      return true;
    } catch (error) {
      resetPreparedEffectAudio(audio, previousMuted, previousVolume);
      effectAudioUnlockState.set(audio, 'locked');
      reportAudioPlayFailure(effect, 'unlock', error);
      return false;
    }
  })).then((results) => {
    wavEffectAudioUnlocked = results.every(Boolean);
    return wavEffectAudioUnlocked;
  }).finally(() => {
    wavEffectUnlockPromise = null;
  });

  return wavEffectUnlockPromise;
};

const playWavEffect = (effect: WavSoundEffect, onEnded?: () => void) => {
  const audio = getEffectAudio(effect);
  if (!audio) {
    onEnded?.();
    return undefined;
  }

  let completed = false;
  let fallbackTimer: number | null = null;
  const cleanup = () => {
    audio.removeEventListener('ended', handleEnded);
    if (fallbackTimer !== null) {
      window.clearTimeout(fallbackTimer);
      fallbackTimer = null;
    }
  };
  const complete = () => {
    if (completed) return;
    completed = true;
    cleanup();
    onEnded?.();
  };
  function handleEnded() {
    complete();
  }

  audio.pause();
  audio.currentTime = 0;
  audio.muted = false;
  audio.volume = SOUND_EFFECT_VOLUME;
  if (onEnded) {
    audio.addEventListener('ended', handleEnded, { once: true });
    const fallbackDelayMs = Number.isFinite(audio.duration) && audio.duration > 0
      ? Math.ceil(audio.duration * 1000) + 250
      : 1600;
    fallbackTimer = window.setTimeout(complete, fallbackDelayMs);
  }

  void audio.play().then(() => {
    effectAudioUnlockState.set(audio, 'unlocked');
  }).catch((error) => {
    const failureKind: AudioPlayFailureKind = reportAudioPlayFailure(effect, 'playback', error);
    if (failureKind === 'autoplay-blocked') {
      effectAudioUnlockState.set(audio, 'locked');
      wavEffectAudioUnlocked = false;
      soundUnlockComplete = false;
      bindSoundUnlock();
    }
    complete();
  });
  return cleanup;
};

const getAudioContext = () => {
  if (typeof window === 'undefined') return null;
  const AudioContextConstructor = window.AudioContext ?? (window as Window & typeof globalThis & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextConstructor) return null;
  if (!audioContext) audioContext = new AudioContextConstructor();
  return audioContext;
};

const unbindSoundUnlock = (unlock: () => void) => {
  if (typeof window === 'undefined') return;
  window.removeEventListener('pointerdown', unlock, true);
  window.removeEventListener('touchstart', unlock, true);
  window.removeEventListener('keydown', unlock, true);
  soundUnlockBound = false;
};

function bindSoundUnlock() {
  if (typeof window === 'undefined' || soundUnlockBound || soundUnlockComplete) return;
  soundUnlockBound = true;
  const unlock = () => {
    const context = getAudioContext();
    const contextReady = !context || context.state === 'running'
      ? Promise.resolve(true)
      : context.resume().then(() => context.state === 'running').catch(() => false);

    void Promise.all([contextReady, unlockWavEffectAudio()]).then(([isContextReady, areWavEffectsReady]) => {
      if (!isContextReady || !areWavEffectsReady) return;
      soundUnlockComplete = true;
      unbindSoundUnlock(unlock);
    });
  };
  window.addEventListener('pointerdown', unlock, { passive: true, capture: true });
  window.addEventListener('touchstart', unlock, { passive: true, capture: true });
  window.addEventListener('keydown', unlock, true);
}

bindSoundUnlock();

const makeGain = (context: AudioContext, volume: number, start: number, duration: number, peak = 1) => {
  const gain = context.createGain();
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, volume * peak), start + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  gain.connect(context.destination);
  return gain;
};

const playTone = (context: AudioContext, frequency: number, start: number, duration: number, volume: number, type: OscillatorType = 'sine') => {
  const oscillator = context.createOscillator();
  const filter = context.createBiquadFilter();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, start);
  oscillator.detune.setValueAtTime(-7, start);
  oscillator.detune.linearRampToValueAtTime(5, start + duration * 0.55);
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(Math.max(420, frequency * 2.8), start);
  filter.Q.setValueAtTime(0.7, start);
  oscillator.connect(filter);
  filter.connect(makeGain(context, volume, start, duration));
  oscillator.start(start);
  oscillator.stop(start + duration + 0.03);
};

const playNoise = (context: AudioContext, start: number, duration: number, volume: number, filterFrequency = 900) => {
  const sampleRate = context.sampleRate;
  const buffer = context.createBuffer(1, Math.max(1, Math.floor(sampleRate * duration)), sampleRate);
  const channel = buffer.getChannelData(0);
  for (let index = 0; index < channel.length; index += 1) {
    channel[index] = (Math.random() * 2 - 1) * (1 - index / channel.length);
  }
  const source = context.createBufferSource();
  const filter = context.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.setValueAtTime(filterFrequency, start);
  filter.Q.setValueAtTime(1.8, start);
  source.buffer = buffer;
  source.connect(filter);
  filter.connect(makeGain(context, volume, start, duration, 0.85));
  source.start(start);
  source.stop(start + duration + 0.03);
};

const getEffectDedupeWindow = (effect: SoundEffect) => {
  if (effect === 'move') return 0.08;
  if (effect === 'countdown' || effect === 'countdownStart') return 0.15;
  return 0.18;
};

const scheduleSoundFollowUp = (delayMs: number, onEnded: () => void, cancelPlayback?: () => void) => {
  if (typeof window === 'undefined') {
    onEnded();
    cancelPlayback?.();
    return undefined;
  }
  let completed = false;
  const timer = window.setTimeout(() => {
    if (completed) return;
    completed = true;
    onEnded();
  }, delayMs);
  return () => {
    if (completed) return;
    completed = true;
    window.clearTimeout(timer);
    cancelPlayback?.();
  };
};

export const isStoredSoundEnabled = () => {
  if (typeof window === 'undefined') return false;
  return window.localStorage.getItem(SOUND_ENABLED_STORAGE_KEY) !== 'false';
};

bindYutResultSpeech(isStoredSoundEnabled);

export const playSoundEffect = (effect: SoundEffect, enabled: boolean, onEnded?: () => void) => {
  if (!enabled) {
    onEnded?.();
    return undefined;
  }

  const chainedDelayMs = getChainedSoundDelayMs(effect, Boolean(onEnded));
  const now = typeof performance === 'undefined' ? Date.now() / 1000 : performance.now() / 1000;
  const lastPlayedAt = lastPlayedEffectAt.get(effect) ?? -Infinity;
  if (now - lastPlayedAt < getEffectDedupeWindow(effect)) {
    if (chainedDelayMs !== null && onEnded) return scheduleSoundFollowUp(chainedDelayMs, onEnded);
    onEnded?.();
    return undefined;
  }
  lastPlayedEffectAt.set(effect, now);

  if (effect in WAV_EFFECT_SOURCES) {
    if (chainedDelayMs !== null && onEnded) {
      const cancelPlayback = playWavEffect(effect as WavSoundEffect);
      return scheduleSoundFollowUp(chainedDelayMs, onEnded, cancelPlayback);
    }
    return playWavEffect(effect as WavSoundEffect, onEnded);
  }

  const context = getAudioContext();
  if (!context) {
    onEnded?.();
    return undefined;
  }

  const play = () => {
    if (context.state === 'suspended') return;
    const safeVolume = SOUND_EFFECT_VOLUME;
    const contextNow = context.currentTime;

    switch (effect) {
      case 'trap':
        playTone(context, 180, contextNow, 0.18, safeVolume, 'sawtooth');
        playNoise(context, contextNow + 0.02, 0.16, safeVolume * 0.8, 420);
        break;
      case 'bonus':
      default:
        break;
    }
    onEnded?.();
  };

  if (context.state === 'suspended') {
    void context.resume().then(() => window.setTimeout(play, 0)).catch(() => onEnded?.());
    return undefined;
  }
  play();
  return undefined;
};

export const playConfirmedStackSoundEffect = () => playSoundEffect('stack', isStoredSoundEnabled());

export const playStoredSoundEffect = (effect: SoundEffect | null, onEnded?: () => void) => {
  if (!effect) {
    onEnded?.();
    return undefined;
  }
  // Stack audio is only valid after a move session confirms a final same-side join.
  // Legacy piece-count observers call this generic path during intermediate movement frames.
  if (effect === 'stack') {
    onEnded?.();
    return undefined;
  }
  return playSoundEffect(effect, isStoredSoundEnabled(), onEnded);
};
