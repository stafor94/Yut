export type SoundEffect = 'roll' | 'bonus' | 'move' | 'arrive' | 'capture' | 'itemPickup' | 'itemUse' | 'trap' | 'shield' | 'win' | 'toast';

let audioContext: AudioContext | null = null;
let lastPlayedAt = 0;

const getAudioContext = () => {
  if (typeof window === 'undefined') return null;
  const AudioContextConstructor = window.AudioContext ?? (window as Window & typeof globalThis & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextConstructor) return null;
  if (!audioContext) audioContext = new AudioContextConstructor();
  if (audioContext.state === 'suspended') void audioContext.resume();
  return audioContext;
};

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
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, start);
  oscillator.connect(makeGain(context, volume, start, duration));
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

const SOUND_EFFECT_VOLUME = 0.5;

export const playSoundEffect = (effect: SoundEffect, enabled: boolean) => {
  if (!enabled) return;
  const context = getAudioContext();
  if (!context) return;
  const safeVolume = SOUND_EFFECT_VOLUME;
  const now = context.currentTime;
  if (now - lastPlayedAt < 0.035 && effect === 'move') return;
  lastPlayedAt = now;

  switch (effect) {
    case 'roll':
      playNoise(context, nowWithOffset(context), 0.16, safeVolume, 650);
      playTone(context, 170, nowWithOffset(context, 0.08), 0.14, safeVolume, 'triangle');
      playTone(context, 115, nowWithOffset(context, 0.2), 0.18, safeVolume, 'triangle');
      break;
    case 'bonus':
      [523, 659, 784, 1047].forEach((frequency, index) => playTone(context, frequency, now + index * 0.055, 0.16, safeVolume, 'sine'));
      break;
    case 'move':
      playTone(context, 290, now, 0.07, safeVolume * 0.5, 'square');
      break;
    case 'arrive':
      playTone(context, 420, now, 0.08, safeVolume * 0.7, 'triangle');
      playTone(context, 560, now + 0.06, 0.11, safeVolume * 0.55, 'triangle');
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
