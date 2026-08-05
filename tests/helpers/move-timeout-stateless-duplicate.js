import { expect } from '@playwright/test';
import { makeTimeoutActionKey } from '../../src/features/room/services/timeoutResolvers.ts';
import { commitAuthoritativeStatePatchForQa } from './authoritative-state-fixture.js';
import { expectMoveTimeoutRecoveryUiProgress, prepareMoveTimeoutRecoveryFixture as prepareBaseFixture, waitForMoveTimeoutRecovery as waitForBaseRecovery } from './move-timeout-recovery.js';

export { expectMoveTimeoutRecoveryUiProgress };
const LISTEN_CHANNEL = /\/google\.firestore\.v1\.Firestore\/Listen\/channel(?:\?|$)/;
const DONOR_DEADLINE_OFFSET_MS = 15_000;
const DUPLICATE_ACK_SETTLE_MS = 1_000;

async function installListenGate(page) {
  let paused = false;
  const waiters = [];
  const release = () => { paused = false; waiters.splice(0).forEach((resolve) => resolve()); };
  const handler = async (route) => {
    try {
      const response = await route.fetch({ timeout: 60_000 });
      if (paused) await new Promise((resolve) => waiters.push(resolve));
      await route.fulfill({ response });
    } catch { if (!page.isClosed()) await route.continue().catch(() => undefined); }
  };
  await page.route(LISTEN_CHANNEL, handler);
  return { pause: () => { paused = true; }, release, dispose: async () => { release(); await page.unroute(LISTEN_CHANNEL, handler).catch(() => undefined); } };
}

export async function prepareMoveTimeoutRecoveryFixture(args) {
  const gate = await installListenGate(args.page);
  let donorContext;
  try {
    const fixture = await prepareBaseFixture(args);
    const timeoutDeadlineAt = Date.now() + DONOR_DEADLINE_OFFSET_MS;
    const extension = await commitAuthoritativeStatePatchForQa(
      args.page, fixture.roomId, { turnDeadlineKind: 'move', turnDeadlineAt: timeoutDeadlineAt }, fixture.actorId,
      { fixtureName: 'move-timeout-stateless-duplicate', errorLabel: 'stateless duplicate donor deadline' },
    );
    const actionKey = makeTimeoutActionKey({ roomId: fixture.roomId, stage: 'move', actorId: fixture.actorId, timeoutDeadlineAt });
    await expect.poll(() => args.page.evaluate(() => {
      const debug = window.__YUT_DEBUG_STATE__ ?? {};
      return [Number(debug.turnDeadlineAt ?? 0), String(debug.movingPieceId ?? ''), Number(debug.lastAppliedSequence ?? 0)];
    }), { timeout: 8_000, message: 'primary가 연장된 timeout state를 listener 차단 전에 적용해야 합니다.' }).toEqual([timeoutDeadlineAt, '', extension.lastSequence]);

    const browser = args.context.browser();
    if (!browser) throw new Error('deadline-leading donor context를 만들 browser가 없습니다.');
    donorContext = await browser.newContext({ storageState: await args.context.storageState({ indexedDB: true }), viewport: args.page.viewportSize() ?? undefined });
    const donorPage = await donorContext.newPage();
    await donorPage.goto(args.page.url(), { waitUntil: 'domcontentloaded' });
    await expect.poll(() => donorPage.evaluate(() => {
      const trigger = window.__YUT_QA_MOVE_TIMEOUT_RECOVERY__;
      return trigger ? [trigger.roomId, trigger.actorId, trigger.actionKey, trigger.timeoutDeadlineAt] : null;
    }), { timeout: 10_000, message: 'donor가 실제 deadline-leading timeout action을 준비해야 합니다.' }).toEqual([fixture.roomId, fixture.actorId, actionKey, timeoutDeadlineAt]);

    await args.page.evaluate(() => {
      window.__YUT_CAPTURE_STATELESS_DUPLICATE_ACK__ = true;
      delete window.__YUT_STATELESS_DUPLICATE_ACK__;
    });
    gate.pause();
    const donorCommit = await donorPage.evaluate(async () => {
      const trigger = window.__YUT_QA_MOVE_TIMEOUT_RECOVERY__;
      if (!trigger) return null;
      const result = await trigger.invoke();
      return [
        trigger.actionKey,
        result.status,
        Number(result.sequence ?? 0),
        Boolean(result.patch),
        Boolean(result.stateAfter),
        String(result.reason ?? ''),
      ];
    });
    expect(donorCommit).toEqual([actionKey, 'committed', extension.lastSequence + 1, true, true, '']);
    await donorContext.close(); donorContext = undefined;
    return { ...fixture, actionKey, baselineSequence: extension.lastSequence, donorSequence: extension.lastSequence + 1, listenGate: gate, timeoutDeadlineAt };
  } catch (error) { await donorContext?.close().catch(() => undefined); await gate.dispose(); throw error; }
}

export async function waitForMoveTimeoutRecovery(fixture) {
  try {
    let ackBoundary = null;
    await expect.poll(async () => {
      if (Date.now() < fixture.timeoutDeadlineAt + DUPLICATE_ACK_SETTLE_MS) return null;
      ackBoundary = await fixture.page.evaluate(() => {
        const debug = window.__YUT_DEBUG_STATE__ ?? {};
        return {
          lastAppliedSequence: Number(debug.lastAppliedSequence ?? 0),
          movingStarts: Number(window.__YUT_TIMEOUT_MOVE_TRACE__?.movingStarts ?? 0),
          duplicateAck: window.__YUT_STATELESS_DUPLICATE_ACK__ ?? null,
        };
      });
      return ackBoundary;
    }, {
      timeout: 20_000,
      intervals: [100, 200, 400],
      message: 'metadata-only duplicate ACK가 cursor를 선점하지 않고 stateless receipt로 분류되어야 합니다.',
    }).toMatchObject({
      lastAppliedSequence: fixture.baselineSequence,
      movingStarts: 1,
      duplicateAck: { actionKey: fixture.actionKey, sequence: fixture.donorSequence },
    });
    expect(ackBoundary).not.toBeNull();

    fixture.listenGate.release();
    const recovery = await waitForBaseRecovery(fixture);
    expect(Number(recovery.sequence.sequence)).toBe(fixture.donorSequence);
    return { ...recovery, statelessDuplicateAckBoundary: ackBoundary };
  } finally {
    await fixture.page.evaluate(() => { delete window.__YUT_CAPTURE_STATELESS_DUPLICATE_ACK__; }).catch(() => undefined);
    fixture.listenGate.release();
    await fixture.listenGate.dispose();
  }
}
