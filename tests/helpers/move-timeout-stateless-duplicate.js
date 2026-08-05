import { expect } from '@playwright/test';
import { makeTimeoutActionKey } from '../../src/features/room/services/timeoutResolvers.ts';
import { commitAuthoritativeStatePatchForQa } from './authoritative-state-fixture.js';
import { expectMoveTimeoutRecoveryUiProgress, prepareMoveTimeoutRecoveryFixture as prepareBaseFixture, waitForMoveTimeoutRecovery as waitForBaseRecovery } from './move-timeout-recovery.js';

export { expectMoveTimeoutRecoveryUiProgress };

const FIRESTORE_LISTEN_CHANNEL = /\/google\.firestore\.v1\.Firestore\/Listen\/channel(?:\?|$)/;
const DONOR_PREP_DEADLINE_OFFSET_MS = 15_000;

async function installListenDeliveryGate(page) {
  let paused = false;
  const waiters = [];
  const release = () => {
    paused = false;
    waiters.splice(0).forEach((resolve) => resolve());
  };
  const handler = async (route) => {
    try {
      const response = await route.fetch({ timeout: 60_000 });
      if (paused) await new Promise((resolve) => waiters.push(resolve));
      await route.fulfill({ response });
    } catch {
      if (!page.isClosed()) await route.continue().catch(() => undefined);
    }
  };
  await page.route(FIRESTORE_LISTEN_CHANNEL, handler);
  return {
    pause: () => { paused = true; },
    release,
    dispose: async () => {
      release();
      await page.unroute(FIRESTORE_LISTEN_CHANNEL, handler).catch(() => undefined);
    },
  };
}

export async function prepareMoveTimeoutRecoveryFixture(args) {
  const listenGate = await installListenDeliveryGate(args.page);
  let donorContext;
  try {
    const fixture = await prepareBaseFixture(args);
    const timeoutDeadlineAt = Date.now() + DONOR_PREP_DEADLINE_OFFSET_MS;
    const extension = await commitAuthoritativeStatePatchForQa(args.page, fixture.roomId, {
      turnDeadlineKind: 'move',
      turnDeadlineAt: timeoutDeadlineAt,
    }, fixture.actorId, {
      fixtureName: 'move-timeout-stateless-duplicate',
      errorLabel: 'stateless duplicate donor deadline',
    });
    const actionKey = makeTimeoutActionKey({
      roomId: fixture.roomId,
      stage: 'move',
      actorId: fixture.actorId,
      timeoutDeadlineAt,
    });

    await expect.poll(() => args.page.evaluate(({ deadline, sequence }) => {
      const debug = window.__YUT_DEBUG_STATE__ ?? {};
      return {
        deadline: Number(debug.turnDeadlineAt ?? 0),
        movingPieceId: String(debug.movingPieceId ?? ''),
        sequence: Number(debug.lastAppliedSequence ?? 0),
      };
    }, { deadline: timeoutDeadlineAt, sequence: extension.lastSequence }), {
      timeout: 8_000,
      intervals: [50, 100, 200],
      message: 'primary가 연장된 canonical timeout state를 listener 차단 전에 적용해야 합니다.',
    }).toEqual({ deadline: timeoutDeadlineAt, movingPieceId: '', sequence: extension.lastSequence });

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
      return trigger ? {
        actionKey: trigger.actionKey,
        actorId: trigger.actorId,
        roomId: trigger.roomId,
        timeoutDeadlineAt: trigger.timeoutDeadlineAt,
      } : null;
    }), {
      timeout: 10_000,
      intervals: [50, 100, 200],
      message: 'donor가 실제 coordinator timeout action callback을 준비해야 합니다.',
    }).toEqual({ actionKey, actorId: fixture.actorId, roomId: fixture.roomId, timeoutDeadlineAt });

    await args.page.evaluate(() => { window.__YUT_STATELESS_DUPLICATE_ACK_TRACE__ = []; });
    listenGate.pause();
    const donorCommit = await donorPage.evaluate(async () => {
      const trigger = window.__YUT_QA_MOVE_TIMEOUT_RECOVERY__;
      if (!trigger) return null;
      const result = await trigger.invoke();
      return {
        actionKey: trigger.actionKey,
        hasPatch: Boolean(result.patch),
        hasStateAfter: Boolean(result.stateAfter),
        sequence: Number(result.sequence ?? 0),
        status: result.status,
      };
    });
    expect(donorCommit).toMatchObject({
      actionKey,
      hasPatch: true,
      hasStateAfter: true,
      sequence: extension.lastSequence + 1,
      status: 'committed',
    });
    await donorContext.close();
    donorContext = undefined;

    return {
      ...fixture,
      actionKey,
      baselineSequence: extension.lastSequence,
      donorCommit,
      listenGate,
      timeoutDeadlineAt,
    };
  } catch (error) {
    await donorContext?.close().catch(() => undefined);
    await listenGate.dispose();
    throw error;
  }
}

export async function waitForMoveTimeoutRecovery(fixture) {
  try {
    let ack;
    await expect.poll(async () => {
      ack = await fixture.page.evaluate((roomId) => (
        (window.__YUT_STATELESS_DUPLICATE_ACK_TRACE__ ?? []).find((entry) => (
          entry?.roomId === roomId && entry?.moveIdentityMatched === true
        )) ?? null
      ), fixture.roomId);
      return ack;
    }, {
      timeout: 20_000,
      intervals: [20, 50, 100, 200],
      message: 'UI가 실제 metadata-only duplicate ACK를 sequence identity로 복구해야 합니다.',
    }).toMatchObject({
      actionKey: fixture.actionKey,
      roomId: fixture.roomId,
      hasStateAfter: false,
      hasPatch: false,
      cursorBefore: fixture.baselineSequence,
      cursorAfterAck: fixture.baselineSequence,
      moveIdentityMatched: true,
    });
    expect(ack.stateVersionAfterAck).toBe(ack.stateVersionBefore);
    expect(Number(ack.sequence)).toBe(Number(fixture.donorCommit.sequence));
    fixture.listenGate.release();

    const recovery = await waitForBaseRecovery(fixture);
    expect(Number(ack.sequence)).toBe(Number(recovery.sequence.sequence));
    expect(await fixture.page.evaluate(() => window.__YUT_STATELESS_DUPLICATE_ACK_TRACE__?.length ?? 0)).toBe(1);
    return { ...recovery, statelessDuplicateAck: ack };
  } finally {
    fixture.listenGate.release();
    await fixture.listenGate.dispose();
  }
}
