import { normalizeSpokenYutResult, type SpokenYutResult } from '../../app/flows/rollSpeech';

const KOREAN_LANGUAGE = 'ko-KR';
const SPEECH_RATE = 0.7;
const SPEECH_PITCH = 1;
const SPEECH_VOLUME = 1;

const spokenByElement = new WeakMap<Element, SpokenYutResult>();
let observer: MutationObserver | null = null;

const getKoreanVoice = () => {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return undefined;
  const voices = window.speechSynthesis.getVoices();
  return voices.find((voice) => voice.lang.toLowerCase().startsWith('ko') && voice.localService)
    ?? voices.find((voice) => voice.lang.toLowerCase().startsWith('ko'));
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

export const bindYutResultSpeech = (isEnabled: () => boolean) => {
  if (typeof document === 'undefined' || typeof MutationObserver === 'undefined' || observer) return;
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
