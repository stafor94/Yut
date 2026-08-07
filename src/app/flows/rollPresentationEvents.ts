type RollPresentationCompletedListener = () => void;
const rollPresentationCompletedListeners = new Set<RollPresentationCompletedListener>();

export const subscribeRollPresentationCompleted = (listener: RollPresentationCompletedListener) => {
  rollPresentationCompletedListeners.add(listener);
  return () => {
    rollPresentationCompletedListeners.delete(listener);
  };
};

export const notifyRollPresentationCompleted = () => {
  rollPresentationCompletedListeners.forEach((listener) => listener());
};

type RollPresentationActiveListener = (active: boolean) => void;
const rollPresentationActiveListeners = new Set<RollPresentationActiveListener>();
let currentRollPresentationActive = false;

export const getRollPresentationActive = () => currentRollPresentationActive;

export const subscribeRollPresentationActive = (listener: RollPresentationActiveListener) => {
  rollPresentationActiveListeners.add(listener);
  listener(currentRollPresentationActive);
  return () => {
    rollPresentationActiveListeners.delete(listener);
  };
};

export const notifyRollPresentationActive = (active: boolean) => {
  if (currentRollPresentationActive === active) return;
  currentRollPresentationActive = active;
  rollPresentationActiveListeners.forEach((listener) => listener(active));
};

type FallPresentationActiveListener = (active: boolean) => void;
const fallPresentationActiveListeners = new Set<FallPresentationActiveListener>();
let currentFallPresentationActive = false;

export const getFallPresentationActive = () => currentFallPresentationActive;

export const subscribeFallPresentationActive = (listener: FallPresentationActiveListener) => {
  fallPresentationActiveListeners.add(listener);
  listener(currentFallPresentationActive);
  return () => {
    fallPresentationActiveListeners.delete(listener);
  };
};

export const notifyFallPresentationActive = (active: boolean) => {
  if (currentFallPresentationActive === active) return;
  currentFallPresentationActive = active;
  fallPresentationActiveListeners.forEach((listener) => listener(active));
};
