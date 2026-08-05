import { expect } from '@playwright/test';
import {
  isAuthoritativeCommitReduction,
  reduceAuthoritativeGameAction,
} from '../../src/features/room/services/roomAuthoritativeReducer.ts';
import { makeFirestoreSafeId } from '../../src/features/room/services/roomFirestore.ts';
import { readFirebaseAccessTokenFromIndexedDb } from './browser-auth-token.js';
import { loadFirebaseConfig } from './env.js';
import { getRoomStateForQa } from './rooms.js';
import {
  expectMoveTimeoutRecoveryUiProgress,
  prepareMoveTimeoutRecoveryFixture as prepareBaseFixture,
  waitForMoveTimeoutRecovery as waitForBaseRecovery,
} from './move-timeout-recovery.js';

export { expectMoveTimeoutRecoveryUiProgress };

const PROCESSED_ACTION_LEAD_MS = 200;
const SEQUENCE_ID_PAD_LENGTH = 12;

const delayUntil = (timestamp) => new Promise((resolve) => setTimeout(resolve, Math.max(0, timestamp - Date.now())));
const sequenceDocId = (sequence) => String(sequence).padStart(SEQUENCE_ID_PAD_LENGTH, '0');
const documentName = (projectId, segments) => `projects/${projectId}/databases/(default)/documents/${segments.join('/')}`;
const documentsBaseUrl = (projectId) => {
  const emulator = String(process.env.FIRESTORE_EMULATOR_HOST ?? '').trim();
  if (emulator) return `http://${emulator}/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents`;
  return `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents`;
};
const encodeValue = (value) => {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'number') return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encodeValue) } };
  return { mapValue: { fields: Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, encodeValue(nested)])) } };
};
const encodeFields = (value) => Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, encodeValue(nested)]));

async function commitWrites(projectId, accessToken, writes, label) {
  const response = await fetch(`${documentsBaseUrl(projectId)}:commit`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ writes }),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${label} ${response.status}: ${text}`);
}

async function getFixtureAccess(page) {
  const config = await loadFirebaseConfig();
  const accessToken = await page.evaluate(readFirebaseAccessTokenFromIndexedDb);
  if (!config?.projectId || !accessToken) throw new Error('stateless duplicate fixture Firebase access를 찾지 못했습니다.');
  return { projectId: config.projectId, accessToken };
}

async function stageProcessedAction(fixture) {
  const createdAt = Date.now();
  const { projectId, accessToken } = fixture;
  await commitWrites(projectId, accessToken, [{
    update: {
      name: documentName(projectId, ['rooms', fixture.roomId, 'processedActions', makeFirestoreSafeId(fixture.actionKey)]),
      fields: {
        ...encodeFields({
          clientMutationId: fixture.actionKey,
          sequence: fixture.coordinatorCommit.sequence,
          turnVersion: fixture.coordinatorCommit.turnVersion,
          type: 'move_piece',
          actorId: fixture.actorId,
          coordinatorSeatId: fixture.coordinatorSeatId,
          coordinatorEpoch: fixture.coordinatorEpoch,
        }),
        createdAt: { timestampValue: new Date(createdAt).toISOString() },
      },
    },
    currentDocument: { exists: false },
  }], 'processed action fixture commit');
}

function reduceCoordinatorMove(fixture, state) {
  const action = {
    type: 'move_piece',
    actorId: fixture.actorId,
    payload: {
      pieceId: fixture.targetPieceId,
      branchChoice: 'outer',
      rollStackIndex: null,
      clientActionId: fixture.actionKey,
      coordinatorSeatId: fixture.coordinatorSeatId,
      coordinatorEpoch: fixture.coordinatorEpoch,
      recoveredByCoordinator: true,
      reason: 'stalled-roll-move-timeout',
      timeoutDeadlineAt: fixture.timeoutDeadlineAt,
    },
  };
  const reduction = reduceAuthoritativeGameAction(state, action, {
    playMode: state.playMode,
    pieceCount: state.pieceCount,
    stackedRollMode: state.stackedRollMode,
  }, (state.gameSeats ?? []).map((seat) => ({ id: seat.id, team: seat.team })));
  expect(isAuthoritativeCommitReduction(reduction)).toBe(true);
  if (!isAuthoritativeCommitReduction(reduction)) throw new Error('stateless duplicate coordinator reduction이 commit 결과가 아닙니다.');
  return { action, reduction };
}

async function publishCoordinatorSequence(fixture) {
  const state = await getRoomStateForQa(fixture.roomId);
  if (!state) throw new Error('stateless duplicate sequence fixture state가 없습니다.');
  expect(Number(state.lastSequence ?? 0) + 1).toBe(fixture.coordinatorCommit.sequence);
  expect(Number(state.turnVersion ?? 0) + 1).toBe(fixture.coordinatorCommit.turnVersion);
  const { action, reduction } = reduceCoordinatorMove(fixture, state);
  const committedAt = Date.now();
  const event = {
    sequence: fixture.coordinatorCommit.sequence,
    type: 'move_piece_resolved',
    actorId: fixture.actorId,
    coordinatorSeatId: fixture.coordinatorSeatId,
    coordinatorEpoch: fixture.coordinatorEpoch,
    payload: reduction.payload ?? {},
    schemaVersion: 2,
    eventSchemaVersion: 2,
    action,
    patch: reduction.patch,
    logEntries: [],
    expectedPreviousSequence: fixture.baselineSequence,
    clientMutationId: fixture.actionKey,
    clientCreatedAt: committedAt,
  };
  const stateFields = {
    ...encodeFields(reduction.patch),
    turnVersion: encodeValue(fixture.coordinatorCommit.turnVersion),
    lastSequence: encodeValue(fixture.coordinatorCommit.sequence),
    lastClientMutationId: encodeValue(fixture.actionKey),
    updatedAt: { timestampValue: new Date(committedAt).toISOString() },
  };
  await commitWrites(fixture.projectId, fixture.accessToken, [
    {
      update: {
        name: documentName(fixture.projectId, ['rooms', fixture.roomId, 'sequences', sequenceDocId(fixture.coordinatorCommit.sequence)]),
        fields: { ...encodeFields(event), createdAt: { timestampValue: new Date(committedAt).toISOString() } },
      },
      currentDocument: { exists: false },
    },
    {
      update: { name: documentName(fixture.projectId, ['rooms', fixture.roomId, 'state', 'current']), fields: stateFields },
      updateMask: { fieldPaths: Object.keys(stateFields) },
    },
  ], 'authoritative sequence fixture commit');
}

export async function prepareMoveTimeoutRecoveryFixture(args) {
  const fixture = await prepareBaseFixture(args);
  const state = await getRoomStateForQa(fixture.roomId);
  if (!state) throw new Error('stateless duplicate baseline state가 없습니다.');
  const access = await getFixtureAccess(fixture.page);
  const enriched = {
    ...fixture,
    ...access,
    baselineStateVersion: Number(state.turnVersion ?? 0),
    coordinatorCommit: {
      sequence: Number(state.lastSequence ?? 0) + 1,
      turnVersion: Number(state.turnVersion ?? 0) + 1,
    },
  };
  await fixture.page.evaluate(() => { window.__YUT_STATELESS_DUPLICATE_ACK_TRACE__ = []; });
  await delayUntil(fixture.timeoutDeadlineAt - PROCESSED_ACTION_LEAD_MS);
  await stageProcessedAction(enriched);
  return enriched;
}

export async function waitForMoveTimeoutRecovery(fixture) {
  let ack;
  await expect.poll(async () => {
    ack = await fixture.page.evaluate(({ roomId, sequence }) => (
      (window.__YUT_STATELESS_DUPLICATE_ACK_TRACE__ ?? []).find((entry) => (
        entry?.roomId === roomId && Number(entry?.sequence ?? 0) === sequence
      )) ?? null
    ), { roomId: fixture.roomId, sequence: fixture.coordinatorCommit.sequence });
    return ack;
  }, {
    timeout: 8_000,
    intervals: [20, 50, 100, 200],
    message: 'UI가 stateAfter/patch 없는 canonical duplicate ACK를 받아야 합니다.',
  }).toMatchObject({
    roomId: fixture.roomId,
    sequence: fixture.coordinatorCommit.sequence,
    hasStateAfter: false,
    hasPatch: false,
    cursorBefore: fixture.baselineSequence,
    cursorAfterAck: fixture.baselineSequence,
    stateVersionBefore: fixture.baselineStateVersion,
    stateVersionAfterAck: fixture.baselineStateVersion,
  });

  await publishCoordinatorSequence(fixture);
  const recovery = await waitForBaseRecovery(fixture);
  expect(recovery.sequence.sequence).toBe(fixture.coordinatorCommit.sequence);
  expect(await fixture.page.evaluate(() => window.__YUT_STATELESS_DUPLICATE_ACK_TRACE__?.length ?? 0)).toBe(1);
  return { ...recovery, statelessDuplicateAck: ack };
}
