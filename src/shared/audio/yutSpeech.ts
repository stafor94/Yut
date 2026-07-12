import { normalizeSpokenYutResult, type SpokenYutResult } from '../../app/flows/rollSpeech';

const KOREAN_LANGUAGE = 'ko-KR';
const PREFERRED_VOICE_NAME = '한국어 대한민국';
const SPEECH_RATE = 1;
const SPEECH_PITCH = 1;
const SPEECH_VOLUME = 0.9;

const spokenByElement = new WeakMap<Element, SpokenYutResult>();
let observer: MutationObserver | null = null;
let bindingScheduled = false;

const isKoreanVoice = (voice: SpeechSynthesisVoice) => voice.lang.toLowerCase().replace('_', '-').startsWith('ko');

const getKoreanVoice = () => {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return undefined;
  const voices = window.speechSynthesis.getVoices();
  return voices.find((voice) => voice.name === PREFERRED_VOICE_NAME && isKoreanVoice(voice))
    ?? voices.find((voice) => isKoreanVoice(voice) && voice.localService)
    ?? voices.find(isKoreanVoice);
};

const speakResult = (result: SpokenYutResult) => {
  if (typeof window === 'undefined' || !('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') return;
  const utterance = new SpeechSynthesisUtterance(result);
  utterance.lang = KOREAN_LANGUAGE;
  utterance.rate = SPEECH_RATE;
  utterance.pitch = SPEECH_PITCH;
  utterance.volume = SPEECH_VOLUME;
  const voice = getKoreanVoice();
  if (voice) utterance.voice = voice;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
};

const speakVisibleResultOnce = (isEnabled: () => boolean) => {
  if (!isEnabled()) return;
  const label = document.querySelector<HTMLElement>('.roll-label:not([hidden])');
  if (!label || label.getAttribute('aria-hidden') === 'true') return;
  const result = normalizeSpokenYutResult(label.textContent ?? '');
  if (!result || spokenByElement.get(label) === result) return;
  spokenByElement.set(label, result);
  speakResult(result);
};

const startObserving = (isEnabled: () => boolean) => {
  if (!document.body || observer) return;
  const check = () => speakVisibleResultOnce(isEnabled);
  observer = new MutationObserver(check);
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['class', 'hidden', 'aria-hidden'],
  });
  window.speechSynthesis?.addEventListener?.('voiceschanged', check);
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
