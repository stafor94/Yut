import { useEffect } from 'react';
import {
  DEVELOPMENT_APP_VERSION,
  buildAppVersionManifestUrl,
  normalizeAppVersion,
  shouldClearAppVersionReloadMarker,
  shouldReloadForAppVersion,
} from '../flows/appVersionFlow';

export const LOBBY_APP_VERSION_CHECK_INTERVAL_MS = 30_000;
export const APP_VERSION_RELOAD_MARKER_KEY = 'yut:last-auto-reload-version';

function readReloadMarker() {
  try {
    return window.sessionStorage.getItem(APP_VERSION_RELOAD_MARKER_KEY) ?? '';
  } catch {
    return '';
  }
}

function writeReloadMarker(version: string) {
  try {
    window.sessionStorage.setItem(APP_VERSION_RELOAD_MARKER_KEY, version);
  } catch {
    // Storage can be unavailable in restricted browser modes. Reload safety still relies on the new bundle version.
  }
}

function clearReloadMarker() {
  try {
    window.sessionStorage.removeItem(APP_VERSION_RELOAD_MARKER_KEY);
  } catch {
    // Ignore unavailable storage and continue normal lobby use.
  }
}

export function useLobbyAppVersionReload() {
  useEffect(() => {
    const currentVersion = normalizeAppVersion(__APP_VERSION__);
    if (!currentVersion || currentVersion === DEVELOPMENT_APP_VERSION) return undefined;

    let disposed = false;
    let checking = false;
    let activeController: AbortController | null = null;

    const checkForUpdate = async () => {
      if (disposed || checking) return;
      checking = true;
      const controller = new AbortController();
      activeController = controller;

      try {
        const response = await window.fetch(
          buildAppVersionManifestUrl(import.meta.env.BASE_URL, Date.now()),
          {
            cache: 'no-store',
            headers: { Accept: 'application/json' },
            signal: controller.signal,
          },
        );
        if (!response.ok || disposed) return;

        const manifest: unknown = await response.json();
        if (disposed || !manifest || typeof manifest !== 'object') return;
        const remoteVersion = normalizeAppVersion((manifest as { version?: unknown }).version);
        if (!remoteVersion) return;

        const lastReloadedVersion = readReloadMarker();
        if (shouldClearAppVersionReloadMarker({ currentVersion, remoteVersion, lastReloadedVersion })) {
          clearReloadMarker();
          return;
        }
        if (!shouldReloadForAppVersion({ currentVersion, remoteVersion, lastReloadedVersion }) || disposed) return;

        writeReloadMarker(remoteVersion);
        if (!disposed) window.location.reload();
      } catch (error) {
        if (!(error instanceof DOMException && error.name === 'AbortError')) {
          // A transient version-check failure must not interrupt lobby use. The next trigger retries it.
        }
      } finally {
        if (activeController === controller) activeController = null;
        checking = false;
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') void checkForUpdate();
    };
    const handleWindowFocus = () => { void checkForUpdate(); };
    const handleOnline = () => { void checkForUpdate(); };

    void checkForUpdate();
    const intervalId = window.setInterval(() => { void checkForUpdate(); }, LOBBY_APP_VERSION_CHECK_INTERVAL_MS);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleWindowFocus);
    window.addEventListener('online', handleOnline);

    return () => {
      disposed = true;
      activeController?.abort();
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleWindowFocus);
      window.removeEventListener('online', handleOnline);
    };
  }, []);
}
