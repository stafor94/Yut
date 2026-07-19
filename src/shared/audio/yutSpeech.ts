import { normalizeSpokenYutResult, type SpokenYutResult } from '../../app/flows/rollSpeech';
import backdoAudioSource from './assets/results/backdo.wav';
import bonusAudioSource from './assets/results/bonus.wav';
import doAudioSource from './assets/results/do.wav';
import gaeAudioSource from './assets/results/gae.wav';
import geolAudioSource from './assets/results/geol.wav';
import moAudioSource from './assets/results/mo.wav';
import nakAudioSource from './assets/results/nak.wav';
import yutAudioSource from './assets/results/yut.wav';

const RESULT_AUDIO_VOLUME = 0.9;
const BONUS_AUDIO_VOLUME = 0.9;

const RESULT_AUDIO_SOURCE: Record<SpokenYutResult, string> = {
  도: doAudioSource,
  개: gaeAudioSource,
  걸: geolAudioSource,
  윷: yutAudioSource,
  모: moAudioSource,
  빽도: backdoAudioSource,
  낙: nakAudioSource,
};

const playedByElement = new WeakMap<Element, SpokenYutResult>();
const queuedByElement = new WeakMap<Element, SpokenYutResult>();
const audioByResult = new Map<SpokenYutResult, HTMLAudioElement>();
let observer: MutationObserver | null = null;
let bindingScheduled = false;
let currentVisibleLabel: HTMLElement | null = null;
let activeAudio: HTMLAudioElement | null = null;
let bonusAudio: HTMLAudioElement | null = null;
let audioUnlocked = false;
let playSequence = 0;

const getResultAudio = (result: SpokenYutResult) => {
  const cachedAudio = audioByResult.get(result);
  if (cachedAudio) return cachedAudio;

  const audio = new Audio(RESULT_AUDIO_SOURCE[result]);
  audio.preload = 'auto';
  audio.volume = RESULT_AUDIO_VOLUME;
  audioByResult.set(result, audio);
  return audio;
};

const getBonusAudio = () => {
  if (bonusAudio) return bonusAudio;
  bonusAudio = new Audio(bonusAudioSource);
  bonusAudio.preload = 'auto';
  bonusAudio.volume = BONUS_AUDIO_VOLUME;
  return bonusAudio;
};

const preloadResultAudio = () => {
  (Object.keys(RESULT_AUDIO_SOURCE) as SpokenYutResult[]).forEach((result) => {
    getResultAudio(result).load();
  });
  getBonusAudio().load();
};

const unlockResultAudio = () => {
  if (audioUnlocked) return;
  const audio = getResultAudio('도');
  audio.muted = true;
  void audio.play().then(() => {
    audio.pause();
    audio.currentTime = 0;
    audio.muted = false;
    audioUnlocked = true;
  }).catch(() => {
    audio.muted = false;
  });
};

const clearQueuedResult = (label: Element, result: SpokenYutResult) => {
  if (queuedByElement.get(label) === result) queuedByElement.delete(label);
};

const stopActiveAudio = () => {
  if (!activeAudio) return;
  activeAudio.pause();
  activeAudio.currentTime = 0;
  activeAudio = null;
};

const playBonus = (isEnabled: () => boolean, sequence: number) => {
  if (sequence !== playSequence || !isEnabled()) return;
  const audio = getBonusAudio();
  if (activeAudio && activeAudio !== audio) stopActiveAudio();
  activeAudio = audio;
  audio.pause();
  audio.currentTime = 0;
  audio.muted = false;
  audio.volume = BONUS_AUDIO_VOLUME;
  void audio.play().catch(() => undefined);
};

const playResult = (label: HTMLElement, result: SpokenYutResult, isEnabled: () => boolean) => {
  if (typeof window === 'undefined' || typeof Audio === 'undefined') return false;
  if (playedByElement.get(label) === result || queuedByElement.get(label) === result) return true;
  if (!isEnabled()) return false;

  playSequence += 1;
  const sequence = playSequence;
  const audio = getResultAudio(result);
  queuedByElement.set(label, result);

  if (activeAudio && activeAudio !== audio) stopActiveAudio();
  activeAudio = audio;
  audio.pause();
  audio.currentTime = 0;
  audio.muted = false;
  audio.volume = RESULT_AUDIO_VOLUME;

  const handleEnded = () => {
    clearQueuedResult(label, result);
    if (sequence === playSequence && (result === '윷' || result === '모')) playBonus(isEnabled, sequence);
  };
  const handleError = () => clearQueuedResult(label, result);
  audio.addEventListener('ended', handleEnded, { once: true });
  audio.addEventListener('error', handleError, { once: true });

  void audio.play().then(() => {
    playedByElement.set(label, result);
  }).catch(() => {
    audio.removeEventListener('ended', handleEnded);
    audio.removeEventListener('error', handleError);
    clearQueuedResult(label, result);
  });
  return true;
};

const clearHiddenResult = () => {
  if (!currentVisibleLabel) return;
  playedByElement.delete(currentVisibleLabel);
  queuedByElement.delete(currentVisibleLabel);
  currentVisibleLabel = null;
};

const playVisibleResultOnce = (isEnabled: () => boolean) => {
  const label = document.querySelector<HTMLElement>('.roll-label:not([hidden])');
  if (!label || label.getAttribute('aria-hidden') === 'true') {
    playSequence += 1;
    stopActiveAudio();
    clearHiddenResult();
    return;
  }
  if (!isEnabled()) return;
  if (currentVisibleLabel && currentVisibleLabel !== label) {
    playSequence += 1;
    stopActiveAudio();
    playedByElement.delete(currentVisibleLabel);
    queuedByElement.delete(currentVisibleLabel);
  }
  currentVisibleLabel = label;
  const result = normalizeSpokenYutResult(label.textContent ?? '');
  if (!result || playedByElement.get(label) === result || queuedByElement.get(label) === result) return;
  playResult(label, result, isEnabled);
};

const startObserving = (isEnabled: () => boolean) => {
  if (!document.body || observer) return;
  preloadResultAudio();
  const check = () => playVisibleResultOnce(isEnabled);
  observer = new MutationObserver(check);
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['class', 'hidden', 'aria-hidden'],
  });
  const unlockAndCheck = () => {
    unlockResultAudio();
    check();
  };
  window.addEventListener('pointerdown', unlockAndCheck, { passive: true });
  window.addEventListener('touchstart', unlockAndCheck, { passive: true });
  window.addEventListener('keydown', unlockAndCheck);
  check();
};

export const bindYutResultSpeech = (isEnabled: () => boolean) => {
  if (typeof window === 'undefined' || typeof document === 'undefined' || typeof MutationObserver === 'undefined' || observer) return;
  if (document.body) {
    startObserving(isEnabled);
    return;
  }
  if (bindingScheduled) return;
  bindingScheduled = true;
  document.addEventListener('DOMContentLoaded', () => {
    bindingScheduled = false;
    startObserving(isEnabled);
  }, { once: true });
};
