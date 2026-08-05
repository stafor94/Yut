import { expect } from '@playwright/test';
import { readFirebaseAccessTokenFromIndexedDb } from './browser-auth-token.js';
import { loadFirebaseConfig } from './env.js';
import { getRoomSequencesForQa, getRoomStateForQa } from './rooms.js';
import { expectMoveTimeoutRecoveryUiProgress, prepareMoveTimeoutRecoveryFixture as prepareBaseFixture, waitForMoveTimeoutRecovery as waitForBaseRecovery } from './move-timeout-recovery.js';
export { expectMoveTimeoutRecoveryUiProgress };
const hashFirestoreId = (value) => {
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < value.length; index += 1) hash = ((hash ^ BigInt(value.charCodeAt(index))) * 0x100000001b3n) & 0xffffffffffffffffn;
  return hash.toString(16).padStart(16, '0');
};
const makeFirestoreSafeId = (value) => {
  const trimmed = value.trim();
  return trimmed ? `${trimmed.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 80) || 'action'}_${hashFirestoreId(trimmed)}` : `action_${Date.now()}`;
};
const documentName = (projectId, segments) => `projects/${projectId}/databases/(default)/documents/${segments.join('/')}`;
const documentsBaseUrl = (projectId) => {
  const emulator = String(process.env.FIRESTORE_EMULATOR_HOST ?? '').trim();
  return emulator ? `http://${emulator}/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents` : `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents`;
};
const encodeValue = (value) => {
  if (value === null || value === undefined) return { nullValue: null };
  if (value instanceof Date) return { timestampValue: value.toISOString() };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'number') return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encodeValue) } };
  return { mapValue: { fields: encodeFields(value) } };
};
const encodeFields = (value) => Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, encodeValue(nested)]));
const setNetworkOffline = (session, offline) => session.send('Network.emulateNetworkConditions', { offline, latency: 0, downloadThroughput: offline ? 0 : -1, uploadThroughput: offline ? 0 : -1 });
async function commitWrites(projectId, accessToken, writes, label) {
  const response = await fetch(`${documentsBaseUrl(projectId)}:commit`, {
    method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ writes }),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${label} ${response.status}: ${text}`);
}
async function stageProcessedAction(fixture) {
  const createdAt = Date.now();
  await commitWrites(fixture.projectId, fixture.accessToken, [{
    update: {
      name: documentName(fixture.projectId, ['rooms', fixture.roomId, 'processedActions', makeFirestoreSafeId(fixture.actionKey)]),
      fields: {
        ...encodeFields({
          clientMutationId: fixture.actionKey, sequence: fixture.coordinatorCommit.sequence, turnVersion: fixture.coordinatorCommit.turnVersion,
          type: 'move_piece', actorId: fixture.actorId, coordinatorSeatId: fixture.coordinatorSeatId, coordinatorEpoch: fixture.coordinatorEpoch,
        }),
        createdAt: { timestampValue: new Date(createdAt).toISOString() },
      },
    }, currentDocument: { exists: false },
  }], 'processed action fixture commit');
}
async function restoreBaseline(fixture, sequences) {
  const baselineFields = encodeFields(Object.fromEntries(Object.entries(fixture.baselineState).filter(([key]) => !['id', 'updatedAt'].includes(key))));
  baselineFields.updatedAt = { timestampValue: new Date().toISOString() };
  const mutationIds = new Set([fixture.actionKey]);
  sequences.forEach((sequence) => {
    if (sequence.clientMutationId) mutationIds.add(sequence.clientMutationId);
    if (sequence.action?.payload?.clientActionId) mutationIds.add(sequence.action.payload.clientActionId);
  });
  await commitWrites(fixture.projectId, fixture.accessToken, [
    ...sequences.map((sequence) => ({ delete: documentName(fixture.projectId, ['rooms', fixture.roomId, 'sequences', sequence.id]) })),
    ...[...mutationIds].map((id) => ({ delete: documentName(fixture.projectId, ['rooms', fixture.roomId, 'processedActions', makeFirestoreSafeId(id)]) })),
    {
      update: { name: documentName(fixture.projectId, ['rooms', fixture.roomId, 'state', 'current']), fields: baselineFields },
      updateMask: { fieldPaths: Object.keys(baselineFields) },
    },
  ], 'canonical timeout capture reset');
}
async function publishCoordinatorSequence(fixture) {
  const { id: _id, name: _name, createdAt: _createdAt, ...event } = fixture.capturedSequence;
  const committedAt = Date.now();
  const stateFields = {
    ...encodeFields(event.patch ?? {}), turnVersion: encodeValue(fixture.coordinatorCommit.turnVersion),
    lastSequence: encodeValue(fixture.coordinatorCommit.sequence), lastClientMutationId: encodeValue(fixture.actionKey),
    updatedAt: { timestampValue: new Date(committedAt).toISOString() },
  };
  await commitWrites(fixture.projectId, fixture.accessToken, [
    {
      update: {
        name: documentName(fixture.projectId, ['rooms', fixture.roomId, 'sequences', String(fixture.coordinatorCommit.sequence).padStart(12, '0')]),
        fields: { ...encodeFields(event), createdAt: { timestampValue: new Date(committedAt).toISOString() } },
      }, currentDocument: { exists: false },
    },
    {
      update: { name: documentName(fixture.projectId, ['rooms', fixture.roomId, 'state', 'current']), fields: stateFields },
      updateMask: { fieldPaths: Object.keys(stateFields) },
    },
  ], 'captured authoritative sequence fixture commit');
}
export async function prepareMoveTimeoutRecoveryFixture(args) {
  const fixture = await prepareBaseFixture(args);
  const baselineState = await getRoomStateForQa(fixture.roomId);
  const config = await loadFirebaseConfig(); const accessToken = await fixture.page.evaluate(readFirebaseAccessTokenFromIndexedDb);
  if (!baselineState || !config?.projectId || !accessToken) throw new Error('stateless duplicate fixture baseline/access를 찾지 못했습니다.');
  const targetSession = await fixture.page.context().newCDPSession(fixture.page); await targetSession.send('Network.enable');
  await fixture.page.evaluate(() => { window.__YUT_STATELESS_DUPLICATE_ACK_TRACE__ = []; });
  await setNetworkOffline(targetSession, true);
  const donorPage = await fixture.page.context().newPage();
  const donorSession = await fixture.page.context().newCDPSession(donorPage);
  let capturedSequence;
  try {
    await donorSession.send('Network.enable');
    await donorPage.goto(fixture.page.url(), { waitUntil: 'domcontentloaded' });
    await expect(donorPage.getByTestId('game-screen')).toBeVisible({ timeout: 25_000 });
    await expect.poll(async () => {
      capturedSequence = (await getRoomSequencesForQa(fixture.roomId)).find((sequence) => (
        Number(sequence.sequence ?? 0) > fixture.baselineSequence && sequence.type === 'move_piece_resolved' && sequence.clientMutationId === fixture.actionKey
      ));
      return capturedSequence ?? null;
    }, { timeout: 20_000, intervals: [20, 50, 100, 200], message: '기존 timeout 경로가 canonical sequence를 실제 생성해야 합니다.' }).not.toBeNull();
    await setNetworkOffline(donorSession, true);
    const generatedSequences = (await getRoomSequencesForQa(fixture.roomId)).filter((sequence) => Number(sequence.sequence ?? 0) > fixture.baselineSequence);
    const prepared = {
      ...fixture, projectId: config.projectId, accessToken, baselineState, capturedSequence,
      coordinatorCommit: { sequence: Number(capturedSequence.sequence), turnVersion: Number(baselineState.turnVersion ?? 0) + 1 },
      donorPage,
    };
    await restoreBaseline(prepared, generatedSequences);
    await stageProcessedAction(prepared);
    await expect.poll(async () => Number((await getRoomStateForQa(fixture.roomId))?.lastSequence ?? -1), { timeout: 5_000, intervals: [20, 50, 100] }).toBe(fixture.baselineSequence);
    await setNetworkOffline(targetSession, false);
    await targetSession.detach();
    return prepared;
  } catch (error) {
    await setNetworkOffline(targetSession, false).catch(() => {});
    await targetSession.detach().catch(() => {});
    await donorPage.close().catch(() => {});
    throw error;
  }
}
export async function waitForMoveTimeoutRecovery(fixture) {
  let ack;
  await expect.poll(async () => {
    ack = await fixture.page.evaluate(({ roomId, sequence }) => (
      (window.__YUT_STATELESS_DUPLICATE_ACK_TRACE__ ?? []).find((entry) => entry?.roomId === roomId && Number(entry?.sequence ?? 0) === sequence) ?? null
    ), { roomId: fixture.roomId, sequence: fixture.coordinatorCommit.sequence });
    return ack;
  }, { timeout: 8_000, intervals: [20, 50, 100, 200], message: 'UI가 stateAfter/patch 없는 canonical duplicate ACK를 받아야 합니다.' }).toMatchObject({
    roomId: fixture.roomId, sequence: fixture.coordinatorCommit.sequence, hasStateAfter: false, hasPatch: false,
    cursorBefore: fixture.baselineSequence, cursorAfterAck: fixture.baselineSequence,
  });
  expect(ack.stateVersionAfterAck).toBe(ack.stateVersionBefore);
  await publishCoordinatorSequence(fixture);
  const recovery = await waitForBaseRecovery(fixture);
  expect(recovery.sequence.sequence).toBe(fixture.coordinatorCommit.sequence);
  expect(await fixture.page.evaluate(() => window.__YUT_STATELESS_DUPLICATE_ACK_TRACE__?.length ?? 0)).toBe(1);
  await fixture.donorPage.close().catch(() => {});
  return { ...recovery, statelessDuplicateAck: ack };
}
