import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildAppVersionManifestUrl,
  normalizeAppVersion,
  shouldClearAppVersionReloadMarker,
  shouldReloadForAppVersion,
} from '../../src/app/flows/appVersionFlow';

test('버전 값과 Pages base 경로를 정규화한다', () => {
  assert.equal(normalizeAppVersion(' abc-123 '), 'abc-123');
  assert.equal(normalizeAppVersion('abc 123'), '');
  assert.equal(normalizeAppVersion(null), '');
  assert.equal(buildAppVersionManifestUrl('/Yut/', 1234), '/Yut/version.json?version-check=1234');
  assert.equal(buildAppVersionManifestUrl('/Yut', 'next build'), '/Yut/version.json?version-check=next%20build');
});

test('운영 번들에서 다른 원격 버전만 한 번 갱신 대상으로 판정한다', () => {
  assert.equal(shouldReloadForAppVersion({
    currentVersion: 'current-sha',
    remoteVersion: 'next-sha',
    lastReloadedVersion: '',
  }), true);
  assert.equal(shouldReloadForAppVersion({
    currentVersion: 'current-sha',
    remoteVersion: 'current-sha',
    lastReloadedVersion: '',
  }), false);
  assert.equal(shouldReloadForAppVersion({
    currentVersion: 'current-sha',
    remoteVersion: 'next-sha',
    lastReloadedVersion: 'next-sha',
  }), false);
  assert.equal(shouldReloadForAppVersion({
    currentVersion: 'development',
    remoteVersion: 'next-sha',
    lastReloadedVersion: '',
  }), false);
});

test('새 번들이 로드되면 동일 버전의 반복 갱신 marker를 제거한다', () => {
  assert.equal(shouldClearAppVersionReloadMarker({
    currentVersion: 'next-sha',
    remoteVersion: 'next-sha',
    lastReloadedVersion: 'next-sha',
  }), true);
  assert.equal(shouldClearAppVersionReloadMarker({
    currentVersion: 'current-sha',
    remoteVersion: 'next-sha',
    lastReloadedVersion: 'next-sha',
  }), false);
});
