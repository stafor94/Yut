export const DEVELOPMENT_APP_VERSION = 'development';

const APP_VERSION_PATTERN = /^[A-Za-z0-9._-]{1,128}$/u;

export function normalizeAppVersion(value: unknown) {
  if (typeof value !== 'string') return '';
  const normalized = value.trim();
  return APP_VERSION_PATTERN.test(normalized) ? normalized : '';
}

export function buildAppVersionManifestUrl(baseUrl: string, cacheBust: number | string) {
  const normalizedBaseUrl = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  return `${normalizedBaseUrl}version.json?version-check=${encodeURIComponent(String(cacheBust))}`;
}

export function shouldReloadForAppVersion(params: {
  currentVersion: unknown;
  remoteVersion: unknown;
  lastReloadedVersion: unknown;
}) {
  const currentVersion = normalizeAppVersion(params.currentVersion);
  const remoteVersion = normalizeAppVersion(params.remoteVersion);
  const lastReloadedVersion = normalizeAppVersion(params.lastReloadedVersion);

  return Boolean(
    currentVersion
    && currentVersion !== DEVELOPMENT_APP_VERSION
    && remoteVersion
    && remoteVersion !== currentVersion
    && remoteVersion !== lastReloadedVersion,
  );
}

export function shouldClearAppVersionReloadMarker(params: {
  currentVersion: unknown;
  remoteVersion: unknown;
  lastReloadedVersion: unknown;
}) {
  const currentVersion = normalizeAppVersion(params.currentVersion);
  const remoteVersion = normalizeAppVersion(params.remoteVersion);
  const lastReloadedVersion = normalizeAppVersion(params.lastReloadedVersion);
  return Boolean(currentVersion && currentVersion === remoteVersion && remoteVersion === lastReloadedVersion);
}
