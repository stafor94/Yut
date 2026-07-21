import { useLayoutEffect } from 'react';
import type { Screen } from '../appState';

const LOBBY_VIEWPORT_LOCK_CLASS = 'lobby-viewport-lock';

function resetDocumentScroll() {
  document.scrollingElement?.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  document.documentElement.scrollTop = 0;
  document.body.scrollTop = 0;
  window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
}

export function useLobbyViewportLock(screen: Screen) {
  useLayoutEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const root = document.getElementById('root');
    const lockTargets = [html, body, root].filter((target): target is HTMLElement => target instanceof HTMLElement);

    lockTargets.forEach((target) => target.classList.remove(LOBBY_VIEWPORT_LOCK_CLASS));
    if (screen !== 'lobby') return;

    resetDocumentScroll();
  }, [screen]);
}
