export type AudioPlayFailureKind = 'autoplay-blocked' | 'media-load' | 'interrupted' | 'unknown';

const readErrorText = (error: unknown, key: 'name' | 'message') => {
  if (!error || typeof error !== 'object' || !(key in error)) return '';
  const value = (error as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : '';
};

export const classifyAudioPlayFailure = (error: unknown): AudioPlayFailureKind => {
  const name = readErrorText(error, 'name');
  const message = readErrorText(error, 'message').toLowerCase();

  if (name === 'NotAllowedError') return 'autoplay-blocked';
  if (name === 'NotSupportedError' || name === 'EncodingError' || name === 'NetworkError') return 'media-load';
  if (name === 'AbortError') return 'interrupted';
  if (message.includes('interrupted') || message.includes('call to pause') || message.includes('new load request')) return 'interrupted';
  return 'unknown';
};
