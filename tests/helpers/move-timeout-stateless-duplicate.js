import { expect } from '@playwright/test';
import { expectMoveTimeoutRecoveryUiProgress, prepareMoveTimeoutRecoveryFixture as prepareBaseFixture, waitForMoveTimeoutRecovery as waitForBaseRecovery } from './move-timeout-recovery.js';

export { expectMoveTimeoutRecoveryUiProgress };

const FIRESTORE_LISTEN_CHANNEL = /\/google\.firestore\.v1\.Firestore\/Listen\/channel(?:\?|$)/;

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
  try {
    const fixture = await prepareBaseFixture(args);
    await fixture.page.evaluate(() => {
      window.__YUT_QA_STATELESS_DUPLICATE_MOVE_ACK_COUNT__ = 1;
      window.__YUT_QA_STATELESS_DUPLICATE_MOVE_ACK_USED__ = 0;
      window.__YUT_STATELESS_DUPLICATE_ACK_TRACE__ = [];
    });
    listenGate.pause();
    return { ...fixture, listenGate };
  } catch (error) {
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
      timeout: 12_000,
      intervals: [20, 50, 100, 200],
      message: 'UI가 metadata-only duplicate ACK를 실제 sequence identity로 복구해야 합니다.',
    }).toMatchObject({
      roomId: fixture.roomId,
      hasStateAfter: false,
      hasPatch: false,
      cursorBefore: fixture.baselineSequence,
      cursorAfterAck: fixture.baselineSequence,
      moveIdentityMatched: true,
    });
    expect(ack.stateVersionAfterAck).toBe(ack.stateVersionBefore);
    expect(await fixture.page.evaluate(() => window.__YUT_QA_STATELESS_DUPLICATE_MOVE_ACK_USED__ ?? 0)).toBe(1);
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