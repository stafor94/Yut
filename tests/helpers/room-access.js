import { findRoomIdByTitle, rememberRoomIdFromPage } from './rooms.js';

export const DEFAULT_ROOM_ACCESS_TIMEOUT_MS = 15_000;
export const DEFAULT_ROOM_ACCESS_ATTEMPT_TIMEOUT_MS = 1_500;
export const DEFAULT_ROOM_ACCESS_INTERVALS_MS = Object.freeze([100, 200, 400, 800, 1200]);

const wait = (durationMs) => new Promise((resolve) => setTimeout(resolve, durationMs));

function normalizeIntervals(intervals) {
  const normalized = intervals
    .map(Number)
    .filter((intervalMs) => Number.isFinite(intervalMs) && intervalMs > 0);
  return normalized.length > 0 ? normalized : [...DEFAULT_ROOM_ACCESS_INTERVALS_MS];
}

async function rememberRoomIdWithAttemptTimeout(page, timeoutMs) {
  let timeoutId;
  try {
    return await Promise.race([
      rememberRoomIdFromPage(page),
      new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(`브라우저 Firebase Auth 토큰 조회가 ${timeoutMs}ms 안에 완료되지 않았습니다.`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

async function installSafariTimingStartRetry(page) {
  if (process.env.QA_ROLE !== 'safari-timing') return;
  await page.evaluate(() => {
    if (window.__YUT_QA_SAFARI_START_RETRY__?.installed) return;

    const state = {
      installed: true,
      armed: false,
      attempts: 0,
      sawDisabled: false,
      status: 'idle',
    };
    window.__YUT_QA_SAFARI_START_RETRY__ = state;
    let observer;
    let scheduled = false;

    const stop = () => {
      observer?.disconnect();
      document.removeEventListener('click', onStartClick, true);
    };
    const check = () => {
      scheduled = false;
      if (!state.armed) return;
      if (document.querySelector('[data-testid="game-screen"]')) {
        state.status = 'entered';
        stop();
        return;
      }
      const startButton = document.querySelector('[data-testid="start-game-button"]');
      if (!(startButton instanceof HTMLButtonElement)) return;
      if (startButton.disabled) {
        state.sawDisabled = true;
        return;
      }
      if (!state.sawDisabled) return;
      if (state.attempts >= 3) {
        state.status = 'exhausted';
        stop();
        return;
      }
      state.attempts += 1;
      state.sawDisabled = false;
      state.status = 'retrying';
      startButton.click();
    };
    const scheduleCheck = () => {
      if (scheduled) return;
      scheduled = true;
      window.setTimeout(check, 0);
    };
    function onStartClick(event) {
      const target = event.target instanceof Element
        ? event.target.closest('[data-testid="start-game-button"]')
        : null;
      if (!(target instanceof HTMLButtonElement) || state.armed) return;
      state.armed = true;
      state.attempts = 1;
      state.sawDisabled = target.disabled;
      state.status = 'armed';
      scheduleCheck();
    }

    document.addEventListener('click', onStartClick, true);
    observer = new MutationObserver(scheduleCheck);
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ['class', 'disabled'],
      childList: true,
      subtree: true,
    });
  });
}

export async function waitForRoomQaAccess(page, {
  roomTitle = '',
  timeoutMs = DEFAULT_ROOM_ACCESS_TIMEOUT_MS,
  intervals = DEFAULT_ROOM_ACCESS_INTERVALS_MS,
} = {}) {
  if (!page) throw new Error('QA room access 대기에는 Playwright page가 필요합니다.');
  const normalizedTimeoutMs = Number(timeoutMs);
  if (!Number.isFinite(normalizedTimeoutMs) || normalizedTimeoutMs <= 0) {
    throw new Error(`QA room access timeout이 올바르지 않습니다: ${String(timeoutMs)}`);
  }

  const pollIntervals = normalizeIntervals(intervals);
  const startedAt = Date.now();
  let attempt = 0;
  let lastError = null;
  let firestoreRoomId = null;

  while (Date.now() - startedAt < normalizedTimeoutMs) {
    const remainingBeforeAttemptMs = normalizedTimeoutMs - (Date.now() - startedAt);
    if (remainingBeforeAttemptMs <= 0) break;
    attempt += 1;
    try {
      const roomId = await rememberRoomIdWithAttemptTimeout(page, Math.min(DEFAULT_ROOM_ACCESS_ATTEMPT_TIMEOUT_MS, remainingBeforeAttemptMs));
      if (roomId) {
        await installSafariTimingStartRetry(page);
        return roomId;
      }
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }

    if (!firestoreRoomId && roomTitle) {
      try {
        firestoreRoomId = await findRoomIdByTitle(roomTitle);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
      }
    }

    const remainingMs = normalizedTimeoutMs - (Date.now() - startedAt);
    if (remainingMs <= 0) break;
    const intervalMs = pollIntervals[Math.min(attempt - 1, pollIntervals.length - 1)];
    await wait(Math.min(intervalMs, remainingMs));
  }

  const activeRoomId = await page.evaluate(() => String(window.__YUT_DEBUG_STATE__?.activeRoomId ?? '')).catch(() => '');
  throw new Error(`생성된 방의 Firebase Auth 토큰과 QA cleanup 권한이 준비되지 않았습니다: ${JSON.stringify({
    timeoutMs: normalizedTimeoutMs,
    attempts: attempt,
    activeRoomId,
    firestoreRoomId,
    lastError: lastError?.message ?? '',
  })}`);
}
