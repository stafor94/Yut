import { normalizeSpokenYutResult, type SpokenYutResult } from '../../app/flows/rollSpeech';
import {
  playWebAudioBuffer,
  preloadWebAudioBuffers,
  stopWebAudioChannel,
} from './webAudioBufferPlayer';
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
const RESULT_AUDIO_CHANNEL = 'yut-result-speech';
const RESULT_AUDIO_KEY = 'current-result';

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
let observer: MutationObserver | null = null;
let bindingScheduled = false;
let currentVisibleLabel: HTMLElement | null = null;
let stopActiveAudio: (() => void) | null = null;
let playSequence = 0;

const preloadResultAudio = () => {
  void preloadWebAudioBuffers([...Object.values(RESULT_AUDIO_SOURCE), bonusAudioSource]);
};

const clearQueuedResult = (label: Element, result: SpokenYutResult) => {
  if (queuedByElement.get(label) === result) queuedByElement.delete(label);
};

const stopCurrentAudio = () => {
  stopActiveAudio?.();
  stopActiveAudio = null;
  stopWebAudioChannel(RESULT_AUDIO_CHANNEL);
};

const playBonus = (isEnabled: () => boolean, sequence: number) => {
  if (sequence !== playSequence || !isEnabled()) return;
  stopActiveAudio = playWebAudioBuffer({
    channel: RESULT_AUDIO_CHANNEL,
    key: RESULT_AUDIO_KEY,
    url: bonusAudioSource,
    volume: BONUS_AUDIO_VOLUME,
  });
};

export const playBonusSpeech = (isEnabled: () => boolean) => {
  if (typeof window === 'undefined' || !isEnabled()) return false;
  playSequence += 1;
  playBonus(isEnabled, playSequence);
  return true;
};

const playResult = (label: HTMLElement, result: SpokenYutResult, isEnabled: () => boolean) => {
  if (typeof window === 'undefined') return false;
  if (playedByElement.get(label) === result || queuedByElement.get(label) === result) return true;
  if (!isEnabled()) return false;

  playSequence += 1;
  const sequence = playSequence;
  const isTurnOrderResult = Boolean(label.closest('[data-testid="turn-order-roll-stage-anchor"]'));
  queuedByElement.set(label, result);

  stopCurrentAudio();
  stopActiveAudio = playWebAudioBuffer({
    channel: RESULT_AUDIO_CHANNEL,
    key: RESULT_AUDIO_KEY,
    url: RESULT_AUDIO_SOURCE[result],
    volume: RESULT_AUDIO_VOLUME,
    onStarted: () => {
      if (sequence !== playSequence) return;
      playedByElement.set(label, result);
    },
    onEnded: () => {
      clearQueuedResult(label, result);
      if (!isTurnOrderResult && sequence === playSequence && (result === '윷' || result === '모')) {
        playBonus(isEnabled, sequence);
      }
    },
    onError: () => {
      clearQueuedResult(label, result);
      if (sequence === playSequence) stopActiveAudio = null;
    },
  });
  return true;
};

const clearHiddenResult = () => {
  if (!currentVisibleLabel) return;
  playedByElement.delete(currentVisibleLabel);
  queuedByElement.delete(currentVisibleLabel);
  currentVisibleLabel = null;
};

const findVisibleResultLabel = () => Array.from(document.querySelectorAll<HTMLElement>('.roll-label'))
  .find((label) => !label.closest('[hidden], [aria-hidden="true"]')) ?? null;

const getResultLabelText = (label: HTMLElement) => label
  .querySelector<HTMLElement>('.roll-result-name > span:not(.roll-result-symbol)')
  ?.textContent ?? label.textContent ?? '';

const playVisibleResultOnce = (isEnabled: () => boolean) => {
  const label = findVisibleResultLabel();
  if (!label) {
    clearHiddenResult();
    return;
  }
  if (!isEnabled()) return;
  if (currentVisibleLabel && currentVisibleLabel !== label) {
    playSequence += 1;
    stopCurrentAudio();
    playedByElement.delete(currentVisibleLabel);
    queuedByElement.delete(currentVisibleLabel);
  }
  currentVisibleLabel = label;
  const result = normalizeSpokenYutResult(getResultLabelText(label));
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
  window.addEventListener('pointerdown', check, { passive: true });
  window.addEventListener('touchstart', check, { passive: true });
  window.addEventListener('keydown', check);
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
