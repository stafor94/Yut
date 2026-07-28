import assert from 'node:assert/strict';
import test from 'node:test';
import { getLobbyRoomActionText } from '../../src/app/flows/lobbyRoomAction.js';

test('대기 중 방은 참가로 표시한다', () => {
  assert.equal(getLobbyRoomActionText({ firebaseConfigured: true, currentUserId: 'user-1', roomInGame: false, playerIds: [] }), '참가');
});

test('진행 중 방의 playerIds에 현재 UID가 있으면 저장된 activeRoomId 없이도 참가로 표시한다', () => {
  assert.equal(getLobbyRoomActionText({ firebaseConfigured: true, currentUserId: 'user-1', roomInGame: true, playerIds: ['user-1'] }), '참가');
});

test('진행 중 방의 playerIds에 현재 UID가 없으면 관전으로 표시한다', () => {
  assert.equal(getLobbyRoomActionText({ firebaseConfigured: true, currentUserId: 'user-1', roomInGame: true, playerIds: ['other-user'] }), '관전');
});

test('Firebase 인증 준비 전이면 준비 중으로 표시한다', () => {
  assert.equal(getLobbyRoomActionText({ firebaseConfigured: true, currentUserId: '', roomInGame: true, playerIds: [] }), '준비 중');
});
