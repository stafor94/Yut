import { normalizeSpokenYutResult, type SpokenYutResult } from '../../app/flows/rollSpeech';

const KOREAN_LANGUAGE = 'ko-KR';
const PREFERRED_VOICE_NAME = '한국어 대한민국';
const SPEECH_RATE = 1;
const SPEECH_PITCH = 1;
const SPEECH_VOLUME = 0.9;
const VOICE_LOAD_GRACE_MS = 1000;
const VOICE_RETRY_DELAY_MS = 160;
const SPEAK_AFTER_CANCEL_DELAY_MS = 30;

const spokenByElement = new WeakMap<Element, SpokenYutResult>();
const queuedByElement = new WeakMap<Element, SpokenYutResult>();
const rejectedVoiceUris = new Set<string>();
let observer: MutationObserver | null = null;
let bindingScheduled = false;
let currentVisibleLabel: HTMLElement | null = null;
let voiceLoadStartedAt = 0;
let voiceRetryTimer: number | null = null;
let activeCheck: (() => void) | null = null;

const normalizeVoiceLanguage = (language: string) => language.toLowerCase().replace(/_/g, '-');
const isKoreanVoice = (voice: SpeechSynthesisVoice) => normalizeVoiceLanguage(voice.lang).startsWith('ko');

const getKoreanVoice = (voices: SpeechSynthesisVoice[]) => {
  const availableVoices = voices.filter((voice) => isKoreanVoice(voice) && !rejectedVoiceUris.has(voice.voiceURI));
  return availableVoices.find((voice) => voice.name === PREFERRED_VOICE_NAME && voice.localService)
    ?? availableVoices.find((voice) => voice.name === PREFERRED_VOICE_NAME)
    ?? availableVoices.find((voice) => voice.localService)
    ?? availableVoices[0];
};

const scheduleVoiceRetry = () => {
  if (typeof window === 'undefined' || !activeCheck || voiceRetryTimer !== null) return;
  voiceRetryTimer = window.setTimeout(() => {
    voiceRetryTimer = null;
    activeCheck?.();
  }, VOICE_RETRY_DELAY_MS);
};

const clearQueuedResult = (label: Element, result: SpokenYutResult) => {
  if (queuedByElement.get(label) === result) queuedByElement.delete(label);
};

const speakResult = (label: HTMLElement, result: SpokenYutResult, isEnabled: () => boolean) => {
  if (typeof window === 'undefined' || !('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') return false;
  if (spokenByElement.get(label) === result || queuedByElement.get(label) === result) return true;

  const synthesis = window.speechSynthesis;
  const voices = synthesis.getVoices();
  if (voices.length === 0) {
    if (!voiceLoadStartedAt) voiceLoadStartedAt = Date.now();
    if (Date.now() - voiceLoadStartedAt < VOICE_LOAD_GRACE_MS) {
      scheduleVoiceRetry();
      return false;
    }
  } else {
    voiceLoadStartedAt = 0;
  }

  const voice = getKoreanVoice(voices);
  const utterance = new SpeechSynthesisUtterance(result);
  utterance.lang = voice?.lang || KOREAN_LANGUAGE;
  utterance.rate = SPEECH_RATE;
  utterance.pitch = SPEECH_PITCH;
  utterance.volume = SPEECH_VOLUME;
  if (voice) utterance.voice = voice;

  queuedByElement.set(label, result);
  let started = false;
  utterance.onstart = () => {
    started = true;
    spokenByElement.set(label, result);
  };
  utterance.onend = () => {
    if (!started) spokenByElement.set(label, result);
    clearQueuedResult(label, result);
  };
  utterance.onerror = (event) => {
    clearQueuedResult(label, result);
    if (event.error !== 'canceled' && event.error !== 'interrupted') {
      if (voice?.voiceURI) rejectedVoiceUris.add(voice.voiceURI);
      scheduleVoiceRetry();
    }
  };

  synthesis.cancel();
  window.setTimeout(() => {
    if (!isEnabled() || spokenByElement.get(label) === result) {
      clearQueuedResult(label, result);
      return;
    }
    synthesis.resume();
    synthesis.speak(utterance);
  }, SPEAK_AFTER_CANCEL_DELAY_MS);
  return true;
};

const clearHiddenResult = () => {
  if (!currentVisibleLabel) return;
  spokenByElement.delete(currentVisibleLabel);
  queuedByElement.delete(currentVisibleLabel);
  currentVisibleLabel = null;
};

const speakVisibleResultOnce = (isEnabled: () => boolean) => {
  const label = document.querySelector<HTMLElement>('.roll-label:not([hidden])');
  if (!label || label.getAttribute('aria-hidden') === 'true') {
    clearHiddenResult();
    return;
  }
  if (!isEnabled()) return;
  if (currentVisibleLabel && currentVisibleLabel !== label) {
    spokenByElement.delete(currentVisibleLabel);
    queuedByElement.delete(currentVisibleLabel);
  }
  currentVisibleLabel = label;
  const result = normalizeSpokenYutResult(label.textContent ?? '');
  if (!result || spokenByElement.get(label) === result || queuedByElement.get(label) === result) return;
  speakResult(label, result, isEnabled);
};

const startObserving = (isEnabled: () => boolean) => {
  if (!document.body || observer) return;
  const check = () => speakVisibleResultOnce(isEnabled);
  activeCheck = check;
  observer = new MutationObserver(check);
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['class', 'hidden', 'aria-hidden'],
  });
  window.speechSynthesis?.addEventListener?.('voiceschanged', check);
  const resumeAndCheck = () => {
    window.speechSynthesis?.resume();
    check();
  };
  window.addEventListener('pointerdown', resumeAndCheck, { passive: true });
  window.addEventListener('touchstart', resumeAndCheck, { passive: true });
  window.addEventListener('keydown', resumeAndCheck);
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
