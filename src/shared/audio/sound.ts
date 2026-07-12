import { bindYutResultSpeech } from './yutSpeech';

export type SoundEffect = 'countdown' | 'countdownStart' | 'roll' | 'bonus' | 'perfect' | 'fall' | 'move' | 'arrive' | 'stack' | 'capture' | 'itemPickup' | 'itemUse' | 'trap' | 'shield' | 'win' | 'toast';

const SOUND_ENABLED_STORAGE_KEY = 'yut-online:soundEnabled';
const SOUND_EFFECT_VOLUME = 0.38;

let audioContext: AudioContext | null = null;
let soundUnlockBound = false;
const lastPlayedEffectAt = new Map<SoundEffect, number>();

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

const nowWithOffset = (context: AudioContext, offset = 0) => context.currentTime + offset;

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
  const context = getAudioContext();
  if (!context) return;

  const play = () => {
    if (context.state === 'suspended') return;
    const safeVolume = SOUND_EFFECT_VOLUME;
    const now = context.currentTime;
    const lastPlayedAt = lastPlayedEffectAt.get(effect) ?? -Infinity;
    if (now - lastPlayedAt < getEffectDedupeWindow(effect)) return;
    lastPlayedEffectAt.set(effect, now);

    switch (effect) {
      case 'countdown':
        playTone(context, 660, now, 0.12, safeVolume * 0.72, 'triangle');
        playTone(context, 880, now + 0.035, 0.08, safeVolume * 0.38, 'sine');
        break;
      case 'countdownStart':
        [523, 659, 784].forEach((frequency, index) => playTone(context, frequency, now + index * 0.055, 0.2, safeVolume * 0.72, 'triangle'));
        break;
      case 'roll':
        playNoise(context, nowWithOffset(context), 0.16, safeVolume, 650);
        playTone(context, 170, nowWithOffset(context, 0.08), 0.14, safeVolume, 'triangle');
        playTone(context, 115, nowWithOffset(context, 0.2), 0.18, safeVolume, 'triangle');
        break;
      case 'bonus':
      case 'fall':
        // 윷·모·낙 결과는 화면에 결과가 표시되는 순간 한국어 음성 합성으로 재생한다.
        break;
      case 'perfect':
        [659, 880, 1047, 1319].forEach((frequency, index) => playTone(context, frequency, now + index * 0.045, 0.24, safeVolume * 0.82, index % 2 === 0 ? 'triangle' : 'sine'));
        playTone(context, 1568, now + 0.16, 0.32, safeVolume * 0.58, 'sine');
        playNoise(context, now + 0.02, 0.24, safeVolume * 0.2, 2400);
        break;
      case 'move':
        playTone(context, 260, now, 0.055, safeVolume * 0.32, 'triangle');
        playNoise(context, now, 0.045, safeVolume * 0.12, 520);
        break;
      case 'arrive':
        playTone(context, 420, now, 0.08, safeVolume * 0.7, 'triangle');
        playTone(context, 560, now + 0.06, 0.11, safeVolume * 0.55, 'triangle');
        break;
      case 'stack':
        playTone(context, 294, now, 0.1, safeVolume * 0.62, 'triangle');
        playTone(context, 440, now + 0.045, 0.14, safeVolume * 0.68, 'triangle');
        playNoise(context, now + 0.015, 0.08, safeVolume * 0.16, 780);
        break;
      case 'capture':
        playNoise(context, now, 0.12, safeVolume, 1200);
        playTone(context, 98, now, 0.22, safeVolume, 'sawtooth');
        playTone(context, 392, now + 0.06, 0.12, safeVolume * 0.7, 'triangle');
        break;
      case 'itemPickup':
        [740, 988].forEach((frequency, index) => playTone(context, frequency, now + index * 0.06, 0.12, safeVolume * 0.75, 'sine'));
        break;
      case 'itemUse':
        [440, 660, 880].forEach((frequency, index) => playTone(context, frequency, now + index * 0.045, 0.12, safeVolume * 0.65, 'triangle'));
        break;
      case 'trap':
        playTone(context, 180, now, 0.18, safeVolume, 'sawtooth');
        playNoise(context, now + 0.02, 0.16, safeVolume * 0.8, 420);
        break;
      case 'shield':
        playTone(context, 620, now, 0.18, safeVolume * 0.7, 'sine');
        playTone(context, 930, now + 0.04, 0.22, safeVolume * 0.55, 'sine');
        break;
      case 'win':
        [523, 659, 784, 1047, 1319].forEach((frequency, index) => playTone(context, frequency, now + index * 0.09, 0.28, safeVolume * 0.75, 'triangle'));
        break;
      case 'toast':
        playTone(context, 880, now, 0.08, safeVolume * 0.45, 'sine');
        break;
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

export const playStoredSoundEffect = (effect: SoundEffect) => {
  playSoundEffect(effect, isStoredSoundEnabled());
};
