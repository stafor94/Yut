import { expect } from '@playwright/test';
import { getRoomSequencesForQa } from './rooms.js';
import { expectMoveTimeoutRecoveryUiProgress, prepareMoveTimeoutRecoveryFixture as prepareBaseFixture, waitForMoveTimeoutRecovery as waitForBaseRecovery } from './move-timeout-recovery.js';

export { expectMoveTimeoutRecoveryUiProgress };

const FIRESTORE_LISTEN_CHANNEL = /\/google\.firestore\.v1\.Firestore\/Listen\/channel(?:\?|$)/;
const DONOR_CLOCK_OFFSET_MS = 5_000;

async function installListenDeliveryGate(page) {
  let paused = false;
  const releaseWaiters = new Set();

  const release = () => {
    paused = false;
    for (const resolve of releaseWaiters) resolve();
    releaseWaiters.clear();
  };

  const handler = async (route) => {
    if (route.request().method() !== 'GET') {
      await route.continue();
      return;
    }

    try {
      const response = await route.fetch({ timeout: 60_000 });
      if (paused) {
        await new Promise((resolve) => releaseWaiters.add(resolve));
      }
      await route.fulfill({ response });
    } catch {
      if (page.isClosed()) return;
      try {
        await route.continue();
      } catch {
        // Navigation or teardown can invalidate an in-flight long-poll route.
      }
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

async function prepareDonorPage({ page, context }) {
  await expect(page.getByTestId('game-screen')).toBeVisible({ timeout: 35_000 });
  const donorPage = await context.newPage();
  await donorPage.goto(page.url(), { waitUntil: 'domcontentloaded' });
  await expect(donorPage.getByTestId('game-screen')).toBeVisible({ timeout: 25_000 });
  return donorPage;
}

async function advanceDonorClockAndReload(donorPage) {
  await donorPage.addInitScript((offsetMs) => {
    const realNow = Date.now.bind(Date);
    Object.defineProperty(Date, 'now', {
      configurable: true,
      value: () => realNow() + offsetMs,
    });
  }, DONOR_CLOCK_OFFSET_MS);
  await donorPage.reload({ waitUntil: 'domcontentloaded' });
  await expect(donorPage.getByTestId('game-screen')).toBeVisible({ timeout: 15_000 });
}

export async function prepareMoveTimeoutRecoveryFixture(args) {
  const listenGate = await installListenDeliveryGate(args.page);
  const donorReady = prepareDonorPage(args);
  let donorPage;

  try {
    const fixture = await prepareBaseFixture(args);
    donorPage = await donorReady;

    await fixture.page.evaluate(() => { window.__YUT_STATELESS_DUPLICATE_ACK_TRACE__ = []; });
    listenGate.pause();
    await advanceDonorClockAndReload(donorPage);

    let capturedSequence;
    await expect.poll(async () => {
      capturedSequence = (await getRoomSequencesForQa(fixture.roomId)).find((sequence) => (
        Number(sequence.sequence ?? 0) > fixture.baselineSequence
        && sequence.type === 'move_piece_resolved'
        && sequence.clientMutationId === fixture.actionKey
      ));
      return capturedSequence ?? null;
    }, {
      timeout: 12_000,
      intervals: [20, 50, 100, 200],
      message: '기존 timeout coordinator가 canonical sequence를 실제 생성해야 합니다.',
    }).not.toBeNull();

    await donorPage.close();
    return { ...fixture, capturedSequence, listenGate };
  } catch (error) {
    await donorPage?.close().catch(() => undefined);
    listenGate.release();
    await listenGate.dispose();
    throw error;
  }
}

export async function waitForMoveTimeoutRecovery(fixture) {
  try {
    let ack;
    await expect.poll(async () => {
      ack = await fixture.page.evaluate(({ roomId, sequence }) => (
        (window.__YUT_STATELESS_DUPLICATE_ACK_TRACE__ ?? []).find((entry) => (
          entry?.roomId === roomId && Number(entry?.sequence ?? 0) === sequence
        )) ?? null
      ), {
        roomId: fixture.roomId,
        sequence: Number(fixture.capturedSequence.sequence),
      });
      return ack;
    }, {
      timeout: 8_000,
      intervals: [20, 50, 100, 200],
      message: 'UI가 stateAfter/patch 없는 canonical duplicate ACK를 받아야 합니다.',
    }).toMatchObject({
      roomId: fixture.roomId,
      sequence: Number(fixture.capturedSequence.sequence),
      hasStateAfter: false,
      hasPatch: false,
      cursorBefore: fixture.baselineSequence,
      cursorAfterAck: fixture.baselineSequence,
    });
    expect(ack.stateVersionAfterAck).toBe(ack.stateVersionBefore);

    fixture.listenGate.release();
    const recovery = await waitForBaseRecovery(fixture);
    expect(recovery.sequence.sequence).toBe(Number(fixture.capturedSequence.sequence));
    expect(await fixture.page.evaluate(() => window.__YUT_STATELESS_DUPLICATE_ACK_TRACE__?.length ?? 0)).toBe(1);
    return { ...recovery, statelessDuplicateAck: ack };
  } finally {
    fixture.listenGate.release();
    await fixture.listenGate.dispose();
  }
}
