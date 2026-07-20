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
    const shouldLock = screen === 'lobby';
    const lockTargets = [html, body, root].filter((target): target is HTMLElement => target instanceof HTMLElement);

    lockTargets.forEach((target) => target.classList.toggle(LOBBY_VIEWPORT_LOCK_CLASS, shouldLock));
    if (!shouldLock) return;

    resetDocumentScroll();
    let secondFrameId = 0;
    const firstFrameId = window.requestAnimationFrame(() => {
      secondFrameId = window.requestAnimationFrame(resetDocumentScroll);
    });
    const delayedResetId = window.setTimeout(resetDocumentScroll, 150);
    const visualViewport = window.visualViewport;
    visualViewport?.addEventListener('resize', resetDocumentScroll);
    window.addEventListener('pageshow', resetDocumentScroll);

    return () => {
      window.cancelAnimationFrame(firstFrameId);
      if (secondFrameId) window.cancelAnimationFrame(secondFrameId);
      window.clearTimeout(delayedResetId);
      visualViewport?.removeEventListener('resize', resetDocumentScroll);
      window.removeEventListener('pageshow', resetDocumentScroll);
      lockTargets.forEach((target) => target.classList.remove(LOBBY_VIEWPORT_LOCK_CLASS));
    };
  }, [screen]);
}
