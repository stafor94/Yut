type PlayTimePresentation = {
  playTimeText: string;
  stopped: boolean;
  visible: boolean;
};

type PlayTimeListener = () => void;

let currentPresentation: PlayTimePresentation = {
  playTimeText: '',
  stopped: false,
  visible: false,
};

const listeners = new Set<PlayTimeListener>();

export function getPlayTimePresentation() {
  return currentPresentation;
}

export function subscribePlayTimePresentation(listener: PlayTimeListener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function publishPlayTimePresentation(nextPresentation: PlayTimePresentation) {
  if (
    currentPresentation.playTimeText === nextPresentation.playTimeText
    && currentPresentation.stopped === nextPresentation.stopped
    && currentPresentation.visible === nextPresentation.visible
  ) return;

  currentPresentation = nextPresentation;
  listeners.forEach((listener) => listener());
}
