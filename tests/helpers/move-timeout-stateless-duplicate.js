import { expect } from '@playwright/test';
import { makeTimeoutActionKey } from '../../src/features/room/services/timeoutResolvers.ts';
import { commitAuthoritativeStatePatchForQa } from './authoritative-state-fixture.js';
import { expectMoveTimeoutRecoveryUiProgress, prepareMoveTimeoutRecoveryFixture as prepareBaseFixture, waitForMoveTimeoutRecovery as waitForBaseRecovery } from './move-timeout-recovery.js';

export { expectMoveTimeoutRecoveryUiProgress };

const LISTEN_CHANNEL = /\/google\.firestore\.v1\.Firestore\/Listen\/channel(?:\?|$)/;
const DONOR_DEADLINE_OFFSET_MS = 15_000;

async function installListenGate(page) {
  let paused = false;
  const waiters = [];
  const release = () => { paused = false; waiters.splice(0).forEach((resolve) => resolve()); };
  const handler = async (route) => {
    try {
      const response = await route.fetch({ timeout: 60_000 });
      if (paused) await new Promise((resolve) => waiters.push(resolve));
      await route.fulfill({ response });
    } catch {
      if (!page.isClosed()) await route.continue().catch(() => undefined);
    }
  };
  await page.route(LISTEN_CHANNEL, handler);
  return {
    pause: () => { paused = true; },
    release,
    dispose: async () => { release(); await page.unroute(LISTEN_CHANNEL, handler).catch(() => undefined); },
  };
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
    const actionKey = makeTimeoutActionKey({
      roomId: fixture.roomId, stage: 'move', actorId: fixture.actorId, timeoutDeadlineAt,
    });
    await expect.poll(() => args.page.evaluate(() => {
      const debug = window.__YUT_DEBUG_STATE__ ?? {};
      return [Number(debug.turnDeadlineAt ?? 0), String(debug.movingPieceId ?? ''), Number(debug.lastAppliedSequence ?? 0)];
    }), { timeout: 8_000, message: 'primary가 연장된 timeout state를 listener 차단 전에 적용해야 합니다.' })
      .toEqual([timeoutDeadlineAt, '', extension.lastSequence]);

    const browser = args.context.browser();
    if (!browser) throw new Error('coordinator donor context를 만들 browser가 없습니다.');
    donorContext = await browser.newContext({
      storageState: await args.context.storageState({ indexedDB: true }),
      viewport: args.page.viewportSize() ?? undefined,
    });
    const donorPage = await donorContext.newPage();
    await donorPage.goto(args.page.url(), { waitUntil: 'domcontentloaded' });
    await expect.poll(() => donorPage.evaluate(() => {
      const trigger = window.__YUT_QA_MOVE_TIMEOUT_RECOVERY__;
      return trigger ? [trigger.roomId, trigger.actorId, trigger.actionKey, trigger.timeoutDeadlineAt] : null;
    }), { timeout: 10_000, message: 'donor가 실제 coordinator timeout callback을 준비해야 합니다.' })
      .toEqual([fixture.roomId, fixture.actorId, actionKey, timeoutDeadlineAt]);

    await args.page.evaluate(() => { window.__YUT_STATELESS_DUPLICATE_ACK_TRACE__ = []; });
    gate.pause();
    const donorCommit = await donorPage.evaluate(async () => {
      const trigger = window.__YUT_QA_MOVE_TIMEOUT_RECOVERY__;
      if (!trigger) return null;
      const result = await trigger.invoke();
      return [trigger.actionKey, result.status, Number(result.sequence ?? 0), Boolean(result.patch), Boolean(result.stateAfter)];
    });
    expect(donorCommit).toEqual([actionKey, 'committed', extension.lastSequence + 1, true, true]);
    await donorContext.close();
    donorContext = undefined;
    return {
      ...fixture, actionKey, baselineSequence: extension.lastSequence,
      donorSequence: extension.lastSequence + 1, listenGate: gate, timeoutDeadlineAt,
    };
  } catch (error) {
    await donorContext?.close().catch(() => undefined);
    await gate.dispose();
    throw error;
  }
}

export async function waitForMoveTimeoutRecovery(fixture) {
  try {
    let ack;
    await expect.poll(async () => {
      ack = await fixture.page.evaluate((roomId) => (
        (window.__YUT_STATELESS_DUPLICATE_ACK_TRACE__ ?? [])
          .find((entry) => entry?.roomId === roomId && entry?.moveIdentityMatched === true) ?? null
      ), fixture.roomId);
      return ack;
    }, { timeout: 20_000, message: 'UI가 실제 metadata-only duplicate ACK를 sequence identity로 복구해야 합니다.' })
      .toMatchObject({
        actionKey: fixture.actionKey, roomId: fixture.roomId, hasStateAfter: false, hasPatch: false,
        cursorBefore: fixture.baselineSequence, cursorAfterAck: fixture.baselineSequence, moveIdentityMatched: true,
      });
    expect(ack.stateVersionAfterAck).toBe(ack.stateVersionBefore);
    expect(Number(ack.sequence)).toBe(fixture.donorSequence);
    fixture.listenGate.release();
    const recovery = await waitForBaseRecovery(fixture);
    expect(Number(recovery.sequence.sequence)).toBe(fixture.donorSequence);
    expect(await fixture.page.evaluate(() => window.__YUT_STATELESS_DUPLICATE_ACK_TRACE__?.length ?? 0)).toBe(1);
    return { ...recovery, statelessDuplicateAck: ack };
  } finally {
    fixture.listenGate.release();
    await fixture.listenGate.dispose();
  }
}
