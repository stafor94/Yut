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

type FallPresentationActiveListener = (active: boolean) => void;
const fallPresentationActiveListeners = new Set<FallPresentationActiveListener>();
let currentFallPresentationActive = false;

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
