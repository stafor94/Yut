import { bindYutResultSpeech } from './yutSpeech';
import arriveAudioSource from './assets/effects/arrive-original.wav';
import captureAudioSource from './assets/effects/capture-original.wav';
import countdownAudioSource from './assets/effects/countdown-original.wav';
import countdownStartAudioSource from './assets/effects/countdown-start-original.wav';
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

export type SoundEffect = 'countdown' | 'countdownStart' | 'turn' | 'roll' | 'bonus' | 'perfect' | 'fall' | 'move' | 'arrive' | 'stack' | 'capture' | 'itemPickup' | 'itemUse' | 'trap' | 'shield' | 'win' | 'toast';

const SOUND_ENABLED_STORAGE_KEY = 'yut-online:soundEnabled';
const SOUND_EFFECT_VOLUME = 0.38;

const WAV_EFFECT_SOURCES = {
  arrive: arriveAudioSource,
  capture: captureAudioSource,
  countdown: countdownAudioSource,
  countdownStart: countdownStartAudioSource,
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

const effectAudioByEffect = new Map<keyof typeof WAV_EFFECT_SOURCES, HTMLAudioElement>();

let audioContext: AudioContext | null = null;
let soundUnlockBound = false;
const lastPlayedEffectAt = new Map<SoundEffect, number>();

const getEffectAudio = (effect: keyof typeof WAV_EFFECT_SOURCES) => {
  const cachedAudio = effectAudioByEffect.get(effect);
  if (cachedAudio) return cachedAudio;
  if (typeof Audio === 'undefined') return null;
  const audio = new Audio(WAV_EFFECT_SOURCES[effect]);
  audio.preload = 'auto';
  audio.volume = SOUND_EFFECT_VOLUME;
  effectAudioByEffect.set(effect, audio);
  return audio;
};

const playWavEffect = (effect: keyof typeof WAV_EFFECT_SOURCES) => {
  const audio = getEffectAudio(effect);
  if (!audio) return;
  audio.pause();
  audio.currentTime = 0;
  audio.muted = false;
  audio.volume = SOUND_EFFECT_VOLUME;
  void audio.play().catch(() => undefined);
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
  window.removeEventListener('pointerdown', unlock);
  window.removeEventListener('touchstart', unlock);
  window.removeEventListener('keydown', unlock);
};

const bindSoundUnlock = () => {
  if (typeof window === 'undefined' || soundUnlockBound) return;
  soundUnlockBound = true;
  const unlock = () => {
    const context = getAudioContext();
    if (!context) return;
    if (context.state === 'running') {
      unbindSoundUnlock(unlock);
      return;
    }
    void context.resume().then(() => {
      if (context.state === 'running') unbindSoundUnlock(unlock);
    }).catch(() => undefined);
  };
  window.addEventListener('pointerdown', unlock, { passive: true });
  window.addEventListener('touchstart', unlock, { passive: true });
  window.addEventListener('keydown', unlock);
};

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

export const isStoredSoundEnabled = () => {
  if (typeof window === 'undefined') return false;
  return window.localStorage.getItem(SOUND_ENABLED_STORAGE_KEY) !== 'false';
};

bindYutResultSpeech(isStoredSoundEnabled);

export const playSoundEffect = (effect: SoundEffect, enabled: boolean) => {
  if (!enabled) return;

  const now = typeof performance === 'undefined' ? Date.now() / 1000 : performance.now() / 1000;
  const lastPlayedAt = lastPlayedEffectAt.get(effect) ?? -Infinity;
  if (now - lastPlayedAt < getEffectDedupeWindow(effect)) return;
  lastPlayedEffectAt.set(effect, now);

  if (effect in WAV_EFFECT_SOURCES) {
    playWavEffect(effect as keyof typeof WAV_EFFECT_SOURCES);
    return;
  }

  const context = getAudioContext();
  if (!context) return;

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
  };

  if (context.state === 'suspended') {
    void context.resume().then(() => window.setTimeout(play, 0)).catch(() => undefined);
    return;
  }
  play();
};

export const playStoredSoundEffect = (effect: SoundEffect | null) => {
  if (!effect) return;
  playSoundEffect(effect, isStoredSoundEnabled());
};
