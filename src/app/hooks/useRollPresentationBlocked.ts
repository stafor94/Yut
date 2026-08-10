import { useSyncExternalStore } from 'react';
import {
  getRollPresentationActive,
  subscribeRollPresentationActive,
} from '../flows/rollPresentationEvents';

const subscribe = (onStoreChange: () => void) => subscribeRollPresentationActive(() => onStoreChange());

export function useRollPresentationBlocked() {
  return useSyncExternalStore(subscribe, getRollPresentationActive, getRollPresentationActive);
}
