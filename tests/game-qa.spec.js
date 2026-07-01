import { test, expect, devices } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { initializeApp, getApps } from 'firebase/app';
import { collection, deleteDoc, doc, getDocs, getFirestore, query, where, writeBatch } from 'firebase/firestore';

const screenshotDir = path.join(process.cwd(), 'screenshots');
const consoleLogPath = path.join(process.cwd(), 'console-log.txt');
const roomSubcollections = ['actions', 'boardItems', 'players', 'seats', 'state', 'sequences', 'processedActions'];
const rememberedRoomIds = new Set();

async function loadFirebaseConfig() {
  const fileEnv = {};
  for (const fileName of ['.env.production', '.env.local', '.env']) {
    const filePath = path.join(process.cwd(), fileName);
    const content = await fs.readFile(filePath, 'utf8').catch(() => '');
    for (const line of content.split('\n')) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (match) fileEnv[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
    }
  }

  const readEnv = (key) => process.env[key] || fileEnv[key];
  const config = {
    apiKey: readEnv('VITE_FIREBASE_API_KEY'),
    authDomain: readEnv('VITE_FIREBASE_AUTH_DOMAIN'),
    projectId: readEnv('VITE_FIREBASE_PROJECT_ID'),
    storageBucket: readEnv('VITE_FIREBASE_STORAGE_BUCKET'),
    messagingSenderId: readEnv('VITE_FIREBASE_MESSAGING_SENDER_ID'),
    appId: readEnv('VITE_FIREBASE_APP_ID'),
  };
  return Object.values(config).every(Boolean) ? config : null;
}

let testDbPromise;
async function getTestDb() {
  if (!testDbPromise) {
    testDbPromise = (async () => {
      const config = await loadFirebaseConfig();
      if (!config) return null;
      const app = getApps().find((candidate) => candidate.name === 'qa-cleanup') ?? initializeApp(config, 'qa-cleanup');
      return getFirestore(app);
    })();
  }
  return testDbPromise;
}

async function rememberRoomIdByTitle(title) {
  const db = await getTestDb();
  if (!db) return null;
  const snapshot = await getDocs(query(collection(db, 'rooms'), where('title', '==', title)));
  const roomId = snapshot.docs[0]?.id ?? null;
  if (roomId) rememberedRoomIds.add(roomId);
  return roomId;
}

async function rememberRoomIdFromPage(page) {
  const roomId = await page.evaluate(() => String(window.__YUT_DEBUG_STATE__?.activeRoomId ?? ''));
  if (roomId) rememberedRoomIds.add(roomId);
  return roomId || null;
}

async function rememberRoomIdForQa(page, title) {
  const roomId = (await rememberRoomIdFromPage(page)) ?? (await rememberRoomIdByTitle(title));
  if (roomId) return roomId;
  return (await getTestDb()) ? null : 'local-room-without-firebase-cleanup';
}

async function deleteRoomForQa(roomId) {
  const db = await getTestDb();
  if (!db || !roomId) return;
  for (const subcollectionName of roomSubcollections) {
    const snapshot = await getDocs(collection(db, 'rooms', roomId, subcollectionName));
    for (let index = 0; index < snapshot.docs.length; index += 450) {
      const batch = writeBatch(db);
      snapshot.docs.slice(index, index + 450).forEach((documentSnapshot) => batch.delete(documentSnapshot.ref));
      await batch.commit();
    }
  }
  await deleteDoc(doc(db, 'rooms', roomId));
}

function isTransientFirestoreConsoleError(message) {
  return (
    /Failed to load resource: the server responded with a status of (400|409)/.test(message) ||
    (/firestore/i.test(message) && /(Commit|already-exists|400|409)/i.test(message))
  );
}

function getTransientFirestoreIncidentKey(message) {
  if (!isTransientFirestoreConsoleError(message)) return null;
  if (/already-exists/i.test(message) || /Failed to load resource: the server responded with a status of (400|409)/.test(message)) {
    return 'firestore-commit-retry';
  }
  return message.replace(/https?:\/\/\S+/g, '<url>').replace(/\s+/g, ' ').trim();
}

function assertConsoleErrorsWithinQaAllowance(consoleErrors) {
  const transientFirestoreErrors = consoleErrors.filter(isTransientFirestoreConsoleError);
  const transientFirestoreIncidents = new Set(transientFirestoreErrors.map(getTransientFirestoreIncidentKey).filter(Boolean));
  const blockingErrors = consoleErrors.filter((message) => !isTransientFirestoreConsoleError(message));
  expect(blockingErrors, `Console/page errors:\n${blockingErrors.join('\n')}`).toEqual([]);
  expect(transientFirestoreIncidents.size, `반복 Firestore 콘솔 에러:\n${transientFirestoreErrors.join('\n')}`).toBeLessThanOrEqual(1);
}

function attachConsoleErrorCapture(page, consoleErrors) {
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(error.message));
}


function formatQaError(error) {
  if (error instanceof Error) return error.stack || error.message;
  return String(error);
}

async function appendQaStepLog(testInfo, status, step, details = '') {
  const suffix = details ? ` - ${details}` : '';
  await fs.appendFile(consoleLogPath, `[${new Date().toISOString()}] [${testInfo.project.name}] [${status}] ${step}${suffix}\n`);
}

async function runQaStep(testInfo, step, action) {
  await appendQaStepLog(testInfo, 'START', step);
  return test.step(step, async () => {
    try {
      const result = await action();
      await appendQaStepLog(testInfo, 'PASS', step);
      return result;
    } catch (error) {
      await appendQaStepLog(testInfo, 'FAIL', step, formatQaError(error));
      throw error;
    }
  });
}

async function primeQaLobbyStorage(context, { nickname, maxPlayers = '2', playMode = 'individual', itemMode = 'false', pieceCount = '4' }) {
  await context.addInitScript(({ nickname: nextNickname, maxPlayers: nextMaxPlayers, playMode: nextPlayMode, itemMode: nextItemMode, pieceCount: nextPieceCount }) => {
    window.localStorage.setItem('yut-online:nickname', nextNickname);
    window.localStorage.setItem('yut-online:maxPlayers', nextMaxPlayers);
    window.localStorage.setItem('yut-online:playMode', nextPlayMode);
    window.localStorage.setItem('yut-online:itemMode', nextItemMode);
    window.localStorage.setItem('yut-online:pieceCount', nextPieceCount);
  }, { nickname, maxPlayers, playMode, itemMode, pieceCount });
}

async function collectGameScreenReadinessDebug(page, firstNickname, secondNickname) {
  try {
    return await page.evaluate(({ firstNickname: expectedFirstNickname, secondNickname: expectedSecondNickname }) => ({
      url: window.location.href,
      visibleScreens: {
        lobby: Boolean(document.querySelector('[data-testid="lobby-screen"]')),
        waitingRoom: Boolean(document.querySelector('[data-testid="waiting-room"]')),
        game: Boolean(document.querySelector('[data-testid="game-screen"]')),
      },
      waitingRoomText: document.querySelector('[data-testid="waiting-room"]')?.textContent?.trim() ?? '',
      gameText: document.querySelector('[data-testid="game-screen"]')?.textContent?.trim() ?? '',
      appMessage: document.querySelector('.app-message, .toast-message, .board-toast')?.textContent?.trim() ?? '',
      expectedPlayersVisible: {
        first: document.body.textContent?.includes(expectedFirstNickname) ?? false,
        second: document.body.textContent?.includes(expectedSecondNickname) ?? false,
      },
      yutDebug: window.__YUT_DEBUG_STATE__ ?? null,
    }), { firstNickname, secondNickname });
  } catch (error) {
    return {
      pageUnavailable: true,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function expectTwoPlayerGameReady(page, firstNickname, secondNickname) {
  await expect.poll(async () => {
    const state = await collectGameScreenReadinessDebug(page, firstNickname, secondNickname);
    return state.visibleScreens?.game ? 'ready' : JSON.stringify(state, null, 2);
  }, { message: '두 플레이어 게임 화면으로 전환되어야 합니다.', timeout: 10_000 }).toBe('ready');
  await expect(page.getByTestId('play-timer')).toBeVisible();
  await expect(page.getByTestId('players-panel')).toContainText(firstNickname);
  await expect(page.getByTestId('players-panel')).toContainText(secondNickname);
  await expect(page.getByTestId('turn-indicator')).toBeVisible();
  await expect(page.getByTestId('game-board')).toBeVisible();
}

function createGameActionCoverage() {
  return { rolled: 0, manualMoved: 0, autoWaited: 0, branchOuterSelected: 0, branchShortcutSelected: 0, branchMoved: 0, itemPromptHandled: 0, itemUsed: 0, itemSkipped: 0, itemPickupModalHandled: 0, trapPlacementHandled: 0 };
}

async function isVisible(locator) {
  return locator.isVisible().catch(() => false);
}

async function collectGameDebugState(page) {
  try {
    return await page.evaluate(() => ({
      turn: document.querySelector('[data-testid="turn-indicator"]')?.textContent?.trim() ?? '',
      controls: document.querySelector('.play-controls')?.textContent?.trim() ?? '',
      moveButton: {
        visible: Boolean(document.querySelector('[data-testid="move-piece-button"]')),
        text: document.querySelector('[data-testid="move-piece-button"]')?.textContent?.trim() ?? '',
        disabled: Boolean(document.querySelector('[data-testid="move-piece-button"]')?.hasAttribute('disabled')),
      },
      rollButton: {
        visible: Boolean(document.querySelector('[data-testid="roll-yut-button"]')),
        text: document.querySelector('[data-testid="roll-yut-button"]')?.textContent?.trim() ?? '',
        disabled: Boolean(document.querySelector('[data-testid="roll-yut-button"]')?.hasAttribute('disabled')),
      },
      branchControls: {
        visible: Boolean(document.querySelector('.bottom-branch-controls')),
        text: document.querySelector('.bottom-branch-controls')?.textContent?.trim() ?? '',
        moveDisabled: Boolean(document.querySelector('.bottom-branch-controls .branch-move-button')?.hasAttribute('disabled')),
      },
      winner: document.querySelector('.winner-overlay')?.textContent?.trim() ?? '',
      prompt: document.querySelector('.inline-item-prompt')?.textContent?.trim() ?? '',
      trap: document.querySelector('.trap-placement-banner')?.textContent?.trim() ?? '',
      actionErrorDialog: document.querySelector('[role="alertdialog"][aria-label="액션 오류"]')?.textContent?.trim() ?? '',
      yutDebug: window.__YUT_DEBUG_STATE__ ?? null,
      logs: Array.from(document.querySelectorAll('.log-list p')).slice(0, 5).map((node) => node.textContent?.trim() ?? ''),
      pieces: Array.from(document.querySelectorAll('[data-testid^="piece-"]')).map((node) => ({ testId: node.getAttribute('data-testid'), text: node.textContent?.trim(), className: node.getAttribute('class') })),
    }));
  } catch (error) {
    return {
      pageUnavailable: true,
      error: error instanceof Error ? error.message : String(error),
      yutDebug: null,
    };
  }
}

function summarizeDebugPieces(pieces) {
  return Array.isArray(pieces)
    ? pieces.map((piece) => `${piece.id}:${piece.ownerId}:${piece.nodeId}:${piece.started ? '1' : '0'}:${piece.finished ? '1' : '0'}`).sort().join('|')
    : '';
}

function summarizeMovedPieceIds(pieceIds) {
  return Array.isArray(pieceIds) ? pieceIds.join(',') : '';
}

function hasStateAdvanced(beforeYutDebug = {}, afterYutDebug = {}) {
  if (Number(afterYutDebug.lastAppliedSequence ?? 0) > Number(beforeYutDebug.lastAppliedSequence ?? 0)) return true;
  if (Number(afterYutDebug.lastAppliedStateVersion ?? 0) > Number(beforeYutDebug.lastAppliedStateVersion ?? 0)) return true;
  if (beforeYutDebug.turnIndex !== afterYutDebug.turnIndex) return true;
  if (beforeYutDebug.lastMovedSeatId !== afterYutDebug.lastMovedSeatId) return true;
  if (summarizeMovedPieceIds(beforeYutDebug.lastMovedPieceIds) !== summarizeMovedPieceIds(afterYutDebug.lastMovedPieceIds)) return true;
  return summarizeDebugPieces(beforeYutDebug.pieces) !== summarizeDebugPieces(afterYutDebug.pieces);
}

function hasMoveResolutionUi(debugState) {
  return Boolean(
    debugState?.moveButton?.visible ||
    debugState?.branchControls?.visible ||
    debugState?.prompt ||
    debugState?.trap ||
    debugState?.winner
  );
}

function findTerminalGameState(debugStates) {
  return debugStates.find((debugState) => {
    if (debugState?.pageUnavailable) return true;
    const screen = debugState?.yutDebug?.screen;
    return screen && screen !== 'game';
  }) ?? null;
}

function findCanonicalDebugState(debugStates) {
  return debugStates.find((debugState) => debugState?.yutDebug?.screen === 'game') ?? debugStates[0] ?? null;
}

function didAutoAdvanceAfterRoll(beforeDebugState, afterDebugState) {
  const beforeYutDebug = beforeDebugState?.yutDebug ?? {};
  const afterYutDebug = afterDebugState?.yutDebug ?? {};
  if (afterYutDebug.roll !== null || afterYutDebug.rollResultHolding) return false;
  if (!afterDebugState?.rollButton?.visible || afterDebugState.rollButton.disabled) return false;
  return hasStateAdvanced(beforeYutDebug, afterYutDebug);
}

function getPreferredDebugState(debugStates, preferredPageIndex) {
  if (Number.isInteger(preferredPageIndex) && debugStates[preferredPageIndex]?.yutDebug?.screen === 'game') return debugStates[preferredPageIndex];
  return findCanonicalDebugState(debugStates);
}

function hasStateAdvancedAcrossPages(beforeDebugStates, afterDebugStates, preferredPageIndex) {
  const beforeDebugState = getPreferredDebugState(beforeDebugStates, preferredPageIndex);
  const afterDebugState = getPreferredDebugState(afterDebugStates, preferredPageIndex);
  if (hasStateAdvanced(beforeDebugState?.yutDebug ?? {}, afterDebugState?.yutDebug ?? {})) return true;
  return afterDebugStates.some((afterDebugState, index) => hasStateAdvanced(beforeDebugStates[index]?.yutDebug ?? {}, afterDebugState?.yutDebug ?? {}));
}

function didAutoAdvanceAfterRollAcrossPages(beforeDebugStates, afterDebugStates, preferredPageIndex) {
  const beforeDebugState = getPreferredDebugState(beforeDebugStates, preferredPageIndex);
  const afterDebugState = getPreferredDebugState(afterDebugStates, preferredPageIndex);
  const afterYutDebug = afterDebugState?.yutDebug ?? {};
  const hasReadyRollButton = afterDebugStates.some((debugState) => debugState?.rollButton?.visible && !debugState.rollButton.disabled);
  if (afterYutDebug.roll !== null || afterYutDebug.rollResultHolding || !hasReadyRollButton) return false;
  return hasStateAdvanced(beforeDebugState?.yutDebug ?? {}, afterYutDebug);
}

function hasPendingTurnAction(debugState) {
  const yutDebug = debugState?.yutDebug ?? {};
  return Boolean(
    yutDebug.rollInProgress ||
    yutDebug.rollInProgressRef ||
    Number(yutDebug.pendingLocalRemoteActionCount ?? 0) > 0 ||
    Number(yutDebug.processingActionCount ?? 0) > 0
  );
}

function hasPendingTurnActionAcrossPages(debugStates) {
  return debugStates.some(hasPendingTurnAction);
}

const transientRollBlockReasons = new Set([
  'roll-in-progress',
  'pending-local-remote-action',
  'processing-remote-action',
  'saving-host-state',
  'roll-locked',
  'turn-order-intro-active',
  'turn-order-phase-active',
]);

function hasTransientRollBlocker(debugState) {
  const rollActionBlockReasons = debugState?.yutDebug?.rollActionBlockReasons ?? [];
  return rollActionBlockReasons.some((reason) => transientRollBlockReasons.has(reason));
}

function isWaitingForRollReadiness(debugState) {
  const yutDebug = debugState?.yutDebug ?? {};
  return Boolean(
    debugState?.rollButton?.visible &&
    debugState.rollButton.disabled &&
    (
      hasTransientRollBlocker(debugState) ||
      hasPendingTurnAction(debugState) ||
      yutDebug.rollResultHolding ||
      yutDebug.activeTurnOrderIntro ||
      yutDebug.turnOrderPhase?.active
    )
  );
}


function summarizeActionBlockers(debugState) {
  const yutDebug = debugState?.yutDebug ?? {};
  return {
    screen: yutDebug.screen ?? null,
    turnActionBlockReasons: yutDebug.turnActionBlockReasons ?? [],
    rollActionBlockReasons: yutDebug.rollActionBlockReasons ?? [],
    moveActionBlockReasons: yutDebug.moveActionBlockReasons ?? [],
    canSubmitTurnAction: yutDebug.canSubmitTurnAction ?? null,
    canRollNow: yutDebug.canRollNow ?? null,
    canRequestMove: yutDebug.canRequestMove ?? null,
    roll: yutDebug.roll ?? null,
    rollResultHolding: yutDebug.rollResultHolding ?? null,
    activeTurnOrderIntro: Boolean(yutDebug.activeTurnOrderIntro),
    turnOrderPhaseActive: Boolean(yutDebug.turnOrderPhase?.active),
    pendingLocalRemoteActionCount: Number(yutDebug.pendingLocalRemoteActionCount ?? 0),
    processingActionCount: Number(yutDebug.processingActionCount ?? 0),
    lastAppliedSequence: Number(yutDebug.lastAppliedSequence ?? 0),
    lastAppliedStateVersion: Number(yutDebug.lastAppliedStateVersion ?? 0),
    message: yutDebug.message ?? '',
    actionErrorDialog: yutDebug.actionErrorDialog ?? '',
    lastActionDiagnostic: yutDebug.lastActionDiagnostic ?? null,
  };
}

function hasAuthoritativeAlreadyRolledStaleState(debugState) {
  const yutDebug = debugState?.yutDebug ?? {};
  return Boolean(
    typeof yutDebug.message === 'string' &&
    yutDebug.message.includes('이미 윷을 던졌습니다') &&
    yutDebug.roll === null &&
    yutDebug.canRollNow === true &&
    debugState?.rollButton?.visible
  );
}

function hasAuthoritativeAlreadyRolledStaleStateAcrossPages(debugStates) {
  return debugStates.some(hasAuthoritativeAlreadyRolledStaleState);
}

function hasAuthoritativeTurnMismatchStaleState(debugState) {
  const yutDebug = debugState?.yutDebug ?? {};
  const turnActionBlockReasons = yutDebug.turnActionBlockReasons ?? [];
  const rollActionBlockReasons = yutDebug.rollActionBlockReasons ?? [];
  return Boolean(
    debugState?.rollButton?.visible &&
    yutDebug.roll === null &&
    yutDebug.canRollNow === true &&
    (
      (typeof yutDebug.message === 'string' && yutDebug.message.includes('지금은 내 차례가 아닙니다')) ||
      turnActionBlockReasons.includes('not-local-turn') ||
      rollActionBlockReasons.includes('not-local-turn')
    )
  );
}

function hasAuthoritativeTurnMismatchStaleStateAcrossPages(debugStates) {
  return debugStates.some(hasAuthoritativeTurnMismatchStaleState);
}

function hasStaleLocalMoveTarget(debugState) {
  const yutDebug = debugState?.yutDebug ?? {};
  const turnActionBlockReasons = yutDebug.turnActionBlockReasons ?? [];
  const moveActionBlockReasons = yutDebug.moveActionBlockReasons ?? [];
  return Boolean(
    (
      (typeof yutDebug.message === 'string' && yutDebug.message.includes('지금은 내 차례가 아닙니다')) ||
      turnActionBlockReasons.includes('not-local-turn') ||
      moveActionBlockReasons.includes('not-local-turn')
    ) &&
    (!debugState?.moveButton?.visible || debugState.moveButton.disabled)
  );
}

function didMoveAdvanceBeforeClickCompleted(beforeDebugState, afterDebugState) {
  const afterYutDebug = afterDebugState?.yutDebug ?? {};
  if (afterDebugState?.moveButton?.visible) return false;
  if (afterYutDebug.roll !== null || afterYutDebug.rollResultHolding) return false;
  if (hasStateAdvanced(beforeDebugState?.yutDebug ?? {}, afterYutDebug)) return true;
  return Boolean((afterDebugState?.rollButton?.visible && !afterDebugState.rollButton.disabled) || afterDebugState?.prompt || afterDebugState?.trap || afterDebugState?.winner);
}

function classifyRollOutcomeFailure(kind, debugStates) {
  const states = Array.isArray(debugStates) ? debugStates : [];
  const blockers = states.map(summarizeActionBlockers);
  if (states.some((debugState) => debugState?.pageUnavailable)) return { kind, category: 'page-unavailable', blockers };
  const terminalState = findTerminalGameState(states);
  if (terminalState) return { kind, category: 'left-game-screen', terminalState: summarizeActionBlockers(terminalState), blockers };
  if (states.some((debugState) => debugState?.yutDebug?.activeTurnOrderIntro)) return { kind, category: 'blocked-by-turn-order-intro', blockers };
  if (states.some((debugState) => debugState?.yutDebug?.turnOrderPhase?.active)) return { kind, category: 'blocked-by-turn-order-phase', blockers };
  if (hasAuthoritativeAlreadyRolledStaleStateAcrossPages(states)) return { kind, category: 'stale-local-roll-state', blockers };
  if (hasAuthoritativeTurnMismatchStaleStateAcrossPages(states)) return { kind, category: 'stale-local-turn-state', blockers };
  if (states.some(hasPendingTurnAction)) return { kind, category: 'pending-remote-action', blockers };
  if (states.some((debugState) => debugState?.yutDebug?.rollResultHolding)) return { kind, category: 'roll-result-holding', blockers };
  if (states.some((debugState) => (debugState?.yutDebug?.rollActionBlockReasons ?? []).length > 0)) return { kind, category: 'roll-blocked', blockers };
  return { kind, category: 'unclassified-no-progress', blockers };
}

function formatRollOutcomeFailure(kind, beforeDebugStates, afterDebugStates, preferredPageIndex) {
  return JSON.stringify({
    classification: classifyRollOutcomeFailure(kind, afterDebugStates),
    clickedPageIndex: Number.isInteger(preferredPageIndex) ? preferredPageIndex : null,
    clickedPageBefore: Number.isInteger(preferredPageIndex) ? summarizeActionBlockers(beforeDebugStates[preferredPageIndex]) : null,
    clickedPageAfter: Number.isInteger(preferredPageIndex) ? summarizeActionBlockers(afterDebugStates[preferredPageIndex]) : null,
    before: beforeDebugStates.map(summarizeActionBlockers),
    after: afterDebugStates,
  }, null, 2);
}

async function collectGameDebugStates(pages) {
  return Promise.all(pages.map((page) => collectGameDebugState(page)));
}

async function waitForRollOutcomeAfterClick(pages, beforeDebugStates, { timeout = 7_000, pendingTimeout = 15_000, preferredPageIndex } = {}) {
  const deadline = Date.now() + timeout;
  const pendingDeadline = Date.now() + pendingTimeout;
  let lastDebugStates = beforeDebugStates;
  let sawRollState = false;
  let sawPendingTurnAction = hasPendingTurnActionAcrossPages(beforeDebugStates);
  let lastHasPendingTurnAction = sawPendingTurnAction;
  let sawAuthoritativeAlreadyRolledStaleState = hasAuthoritativeAlreadyRolledStaleStateAcrossPages(beforeDebugStates);
  let lastHasAuthoritativeAlreadyRolledStaleState = sawAuthoritativeAlreadyRolledStaleState;
  let sawAuthoritativeTurnMismatchStaleState = hasAuthoritativeTurnMismatchStaleStateAcrossPages(beforeDebugStates);
  let lastHasAuthoritativeTurnMismatchStaleState = sawAuthoritativeTurnMismatchStaleState;

  while (Date.now() < deadline || ((sawPendingTurnAction || sawAuthoritativeAlreadyRolledStaleState || sawAuthoritativeTurnMismatchStaleState) && Date.now() < pendingDeadline)) {
    const debugStates = await collectGameDebugStates(pages);
    lastDebugStates = debugStates;

    const terminalDebugState = findTerminalGameState(debugStates);
    if (terminalDebugState) return { kind: 'terminal-state', debugStates, terminalDebugState };

    if (didAutoAdvanceAfterRollAcrossPages(beforeDebugStates, debugStates, preferredPageIndex)) {
      return { kind: 'auto-advance', debugStates };
    }

    if (debugStates.some(hasMoveResolutionUi)) {
      return { kind: 'move-resolution-ui', debugStates };
    }

    if (debugStates.some((debugState) => debugState?.yutDebug?.roll !== null && debugState?.yutDebug?.roll !== undefined)) {
      sawRollState = true;
    }
    lastHasPendingTurnAction = hasPendingTurnActionAcrossPages(debugStates);
    if (lastHasPendingTurnAction) {
      sawPendingTurnAction = true;
    }
    lastHasAuthoritativeAlreadyRolledStaleState = hasAuthoritativeAlreadyRolledStaleStateAcrossPages(debugStates);
    if (lastHasAuthoritativeAlreadyRolledStaleState) {
      sawAuthoritativeAlreadyRolledStaleState = true;
    }
    lastHasAuthoritativeTurnMismatchStaleState = hasAuthoritativeTurnMismatchStaleStateAcrossPages(debugStates);
    if (lastHasAuthoritativeTurnMismatchStaleState) {
      sawAuthoritativeTurnMismatchStaleState = true;
    }

    await pages[0].waitForTimeout(250);
  }

  if (sawRollState) return { kind: 'roll-observed', debugStates: lastDebugStates };
  if (hasStateAdvancedAcrossPages(beforeDebugStates, lastDebugStates, preferredPageIndex)) return { kind: 'state-advanced', debugStates: lastDebugStates };
  if (sawPendingTurnAction) return { kind: 'pending-timeout', debugStates: lastDebugStates };
  if (sawAuthoritativeAlreadyRolledStaleState && lastHasAuthoritativeAlreadyRolledStaleState) return { kind: 'stale-roll-state-timeout', debugStates: lastDebugStates };
  if (sawAuthoritativeTurnMismatchStaleState && lastHasAuthoritativeTurnMismatchStaleState) return { kind: 'stale-turn-state-timeout', debugStates: lastDebugStates };
  return { kind: 'no-state-change', debugStates: lastDebugStates };
}

async function collectWaitingRoomDebugState(page) {
  return page.evaluate(() => ({
    waitingRoom: document.querySelector('[data-testid="waiting-room"]')?.textContent?.trim() ?? '',
    startButton: {
      visible: Boolean(document.querySelector('[data-testid="start-game-button"]')),
      text: document.querySelector('[data-testid="start-game-button"]')?.textContent?.trim() ?? '',
      disabled: Boolean(document.querySelector('[data-testid="start-game-button"]')?.hasAttribute('disabled')),
    },
    addAiButtons: Array.from(document.querySelectorAll('[data-testid^="add-ai-"]')).map((node) => ({ testId: node.getAttribute('data-testid'), text: node.textContent?.trim() ?? '', disabled: node.hasAttribute('disabled') })),
    yutDebug: window.__YUT_DEBUG_STATE__ ?? null,
  }));
}

async function collectLobbyTransitionDebugState(page, roomTitle) {
  return page.evaluate((expectedRoomTitle) => {
    const createButton = document.querySelector('[data-testid="create-room-button"]');
    return {
      screen: window.__YUT_DEBUG_STATE__?.screen ?? null,
      notice: document.querySelector('.lobby-notice')?.textContent?.trim() ?? '',
      createButton: {
        visible: Boolean(createButton),
        text: createButton?.textContent?.trim() ?? '',
        disabled: Boolean(createButton?.hasAttribute('disabled')),
      },
      waitingRoom: {
        visible: Boolean(document.querySelector('[data-testid="waiting-room"]')),
        text: document.querySelector('[data-testid="waiting-room"]')?.textContent?.trim() ?? '',
      },
      matchingRoomCards: Array.from(document.querySelectorAll('.lobby-room-card')).filter((node) => node.textContent?.includes(expectedRoomTitle)).map((node) => node.textContent?.trim() ?? ''),
      yutDebug: window.__YUT_DEBUG_STATE__ ?? null,
    };
  }, roomTitle);
}

async function handleItemPickupModal(page, coverage) {
  const modal = page.getByRole('dialog', { name: '아이템 교체 선택' });
  if (!(await isVisible(modal))) return false;
  const skipButton = modal.getByRole('button', { name: '획득 안 함' });
  if (await isVisible(skipButton)) {
    await skipButton.click();
    coverage.itemPickupModalHandled += 1;
    return true;
  }
  const discardButton = modal.getByRole('button', { name: /버리기/ }).first();
  await expect(discardButton, '아이템 교체 모달에는 버리기 또는 획득 안 함 버튼이 있어야 합니다.').toBeVisible({ timeout: 5_000 });
  await discardButton.click();
  coverage.itemPickupModalHandled += 1;
  return true;
}

async function handleItemPrompt(page, coverage, { preferUseItem = true } = {}) {
  const prompt = page.locator('.inline-item-prompt');
  if (!(await isVisible(prompt))) return false;
  if (preferUseItem) {
    const itemButton = prompt.locator('.inline-item-button').first();
    if (await isVisible(itemButton)) {
      await itemButton.click();
      coverage.itemPromptHandled += 1;
      coverage.itemUsed += 1;
      return true;
    }
  }
  const skipButton = prompt.getByRole('button', { name: '사용 안 함' });
  await expect(skipButton, '아이템 사용 프롬프트에는 사용 안 함 버튼이 있어야 합니다.').toBeVisible({ timeout: 5_000 });
  await skipButton.click();
  coverage.itemPromptHandled += 1;
  coverage.itemSkipped += 1;
  return true;
}

async function handleTrapPlacement(page, coverage) {
  if (!(await isVisible(page.locator('.trap-placement-banner')))) return false;
  const selectableNode = page.locator('.board-node.trap-selectable').first();
  await expect(selectableNode, '함정 설치 중에는 선택 가능한 말판 노드가 있어야 합니다.').toBeVisible({ timeout: 10_000 });
  await selectableNode.click();
  coverage.trapPlacementHandled += 1;
  return true;
}

async function handleBranchMove(page, coverage) {
  const controls = page.locator('.bottom-branch-controls');
  if (!(await isVisible(controls))) return false;
  const useShortcut = coverage.branchShortcutSelected <= coverage.branchOuterSelected;
  const branchButton = controls.getByRole('button', { name: useShortcut ? '지름길' : '바깥길' });
  await branchButton.click();
  if (useShortcut) coverage.branchShortcutSelected += 1;
  else coverage.branchOuterSelected += 1;
  const moveButton = controls.locator('.branch-move-button');
  await expect(moveButton, '갈림길 선택 후 이동 버튼이 활성화되어야 합니다.').toBeEnabled({ timeout: 15_000 });
  await moveButton.click();
  coverage.branchMoved += 1;
  coverage.manualMoved += 1;
  return true;
}

async function playOneAvailableGameAction(page, coverage, options = {}) {
  const pages = options.pages ?? [page];
  const preferredPageIndex = Number.isInteger(options.preferredPageIndex) ? options.preferredPageIndex : pages.indexOf(page);
  if (await handleItemPickupModal(page, coverage)) return 'item-pickup-modal';
  if (await handleItemPrompt(page, coverage, options)) return 'item-prompt';
  if (await handleTrapPlacement(page, coverage)) return 'trap-placement';
  if (await handleBranchMove(page, coverage)) return 'branch-move';

  const moveButton = page.getByTestId('move-piece-button');
  if (await isVisible(moveButton)) {
    let moveButtonState = 'waiting';
    await expect.poll(async () => {
      const debugState = await collectGameDebugState(page);
      if (debugState.moveButton.visible && !debugState.moveButton.disabled) moveButtonState = 'ready';
      else {
        const yutDebug = debugState.yutDebug ?? {};
        moveButtonState = !debugState.moveButton.visible && yutDebug.roll === null && yutDebug.rollResultHolding === false ? 'advanced' : 'waiting';
      }
      return moveButtonState;
    }, { message: '선택한 말 이동 버튼은 활성화되거나 자동 이동으로 다음 상태에 진입해야 합니다.', timeout: 15_000 }).toMatch(/^(ready|advanced)$/);

    if (moveButtonState === 'ready' && await isVisible(moveButton) && await moveButton.isEnabled().catch(() => false)) {
      const beforeMoveDebugState = await collectGameDebugState(page);
      try {
        await moveButton.click({ timeout: 2_000 });
        coverage.manualMoved += 1;
        return 'manual-move';
      } catch (error) {
        const debugState = await collectGameDebugState(page);
        if (didMoveAdvanceBeforeClickCompleted(beforeMoveDebugState, debugState)) {
          coverage.autoWaited += 1;
          return 'auto-move';
        }
        if (hasPendingTurnAction(debugState) || debugState.yutDebug?.rollResultHolding || hasStaleLocalMoveTarget(debugState)) return 'wait';
        throw new Error(`선택한 말 이동 버튼 클릭이 실패했습니다: ${JSON.stringify({ error: error instanceof Error ? error.message : String(error), beforeMoveDebugState, debugState }, null, 2)}`);
      }
    }

    coverage.autoWaited += 1;
    return 'auto-move';
  }

  const rollButton = page.getByTestId('roll-yut-button');
  if (await isVisible(rollButton)) {
    let lastRollReadinessDebugState = await collectGameDebugState(page);
    await expect.poll(async () => {
      const debugState = await collectGameDebugState(page);
      lastRollReadinessDebugState = debugState;
      if (!debugState.rollButton.visible) return 'not-visible';
      if (!debugState.rollButton.disabled && debugState.yutDebug?.canRollNow === true) return 'ready';
      if (isWaitingForRollReadiness(debugState)) return 'waiting';
      return 'blocked';
    }, { message: '윷 던지기 버튼은 활성화되거나 일시적인 진행/저장 상태로 분류되어야 합니다.', timeout: 15_000 }).not.toBe('blocked');

    if (isWaitingForRollReadiness(lastRollReadinessDebugState)) {
      coverage.autoWaited += 1;
      return 'wait';
    }
    if (!lastRollReadinessDebugState.rollButton.visible) {
      coverage.autoWaited += 1;
      return 'wait';
    }

    await expect(rollButton, `윷 던지기 버튼이 보이면 활성화되어야 합니다: ${JSON.stringify(summarizeActionBlockers(lastRollReadinessDebugState), null, 2)}`).toBeEnabled({ timeout: 1_000 });
    const beforeRollDebugStates = await collectGameDebugStates(pages);
    await rollButton.click();

    const rollOutcome = await waitForRollOutcomeAfterClick(pages, beforeRollDebugStates, { preferredPageIndex });
    if (rollOutcome.kind === 'terminal-state') {
      throw new Error(`윷 던지기 이후 게임 화면을 벗어났습니다: ${formatRollOutcomeFailure(rollOutcome.kind, beforeRollDebugStates, rollOutcome.debugStates, preferredPageIndex)}`);
    }
    if (rollOutcome.kind === 'pending-timeout') {
      throw new Error(`윷 던지기 클릭 이후 원격 액션 대기 상태가 해소되지 않았습니다: ${formatRollOutcomeFailure(rollOutcome.kind, beforeRollDebugStates, rollOutcome.debugStates, preferredPageIndex)}`);
    }
    if (rollOutcome.kind === 'no-state-change') {
      throw new Error(`윷 던지기 클릭 이후 게임 상태 변화가 관측되지 않았습니다: ${formatRollOutcomeFailure(rollOutcome.kind, beforeRollDebugStates, rollOutcome.debugStates, preferredPageIndex)}`);
    }
    if (rollOutcome.kind === 'stale-roll-state-timeout') {
      throw new Error(`윷 던지기 클릭 이후 authoritative roll 상태가 로컬 화면에 동기화되지 않았습니다: ${formatRollOutcomeFailure(rollOutcome.kind, beforeRollDebugStates, rollOutcome.debugStates, preferredPageIndex)}`);
    }
    if (rollOutcome.kind === 'stale-turn-state-timeout') {
      throw new Error(`윷 던지기 클릭 이후 authoritative 턴 상태가 로컬 화면에 동기화되지 않았습니다: ${formatRollOutcomeFailure(rollOutcome.kind, beforeRollDebugStates, rollOutcome.debugStates, preferredPageIndex)}`);
    }

    coverage.rolled += 1;
    if (rollOutcome.kind === 'auto-advance') {
      coverage.autoWaited += 1;
      return 'roll-auto';
    }

    return rollOutcome.kind === 'roll-observed' ? 'roll-observed' : 'roll';
  }

  if (await isVisible(page.locator('.winner-overlay'))) return 'winner';
  if (await isVisible(page.getByTestId('game-screen'))) {
    await page.waitForTimeout(350);
    coverage.autoWaited += 1;
    return 'wait';
  }

  throw new Error(`처리 가능한 게임 액션을 찾지 못했습니다: ${JSON.stringify(await collectGameDebugState(page), null, 2)}`);
}

async function playUntilActions(page, testInfo, { targetActions = 10, maxTicks = 80, minActionsBeforeWinner = 6, stepPrefix = 'action-loop' } = {}) {
  const coverage = createGameActionCoverage();
  const actionHistory = [];
  let progressedActions = 0;
  for (let tick = 1; tick <= maxTicks && progressedActions < targetActions; tick += 1) {
    const action = await playOneAvailableGameAction(page, coverage);
    actionHistory.push(action);
    if (action === 'winner') {
      const debugState = await collectGameDebugState(page);
      expect(progressedActions, `게임이 너무 빨리 종료되었습니다: ${JSON.stringify({ coverage, actionHistory, debugState }, null, 2)}`).toBeGreaterThanOrEqual(minActionsBeforeWinner);
      break;
    }
    if (action !== 'wait') progressedActions += 1;
    if (tick % 10 === 0) await saveStepScreenshot(page, testInfo, `${stepPrefix}-${tick}`);
  }
  const debugState = await collectGameDebugState(page);
  const failureDebug = JSON.stringify({ coverage, actionHistory, debugState }, null, 2);
  expect(progressedActions, `충분한 게임 액션을 진행하지 못했습니다: ${failureDebug}`).toBeGreaterThanOrEqual(targetActions);
  expect(coverage.rolled, `QA 루프에서 윷 던지기를 최소 1회 이상 수행해야 합니다: ${failureDebug}`).toBeGreaterThan(0);
  expect(coverage.manualMoved + coverage.autoWaited, `QA 루프에서 수동 이동 또는 자동 이동 대기 상태를 검증해야 합니다: ${failureDebug}`).toBeGreaterThan(0);
  return coverage;
}

async function isPlayableActionVisible(page) {
  if (await page.getByRole('dialog', { name: '아이템 교체 선택' }).isVisible().catch(() => false)) return true;
  if (await page.getByTestId('roll-yut-button').isVisible().catch(() => false)) return true;
  if (await page.getByTestId('move-piece-button').isVisible().catch(() => false)) return true;
  if (await page.locator('.bottom-branch-controls').isVisible().catch(() => false)) return true;
  if (await page.locator('.inline-item-prompt').isVisible().catch(() => false)) return true;
  if (await page.locator('.trap-placement-banner').isVisible().catch(() => false)) return true;
  if (await page.locator('.winner-overlay').isVisible().catch(() => false)) return true;
  return false;
}

function getPlayableActionPriority(debugState) {
  const yutDebug = debugState?.yutDebug ?? {};
  if (debugState?.moveButton?.visible && !debugState.moveButton.disabled && yutDebug.canRequestMove === true) return 1;
  if (debugState?.branchControls?.visible && !debugState.branchControls.moveDisabled && yutDebug.canRequestMove === true) return 2;
  if (debugState?.rollButton?.visible && !debugState.rollButton.disabled && yutDebug.canRollNow === true && (yutDebug.rollActionBlockReasons ?? []).length === 0) return 3;
  if (debugState?.prompt || debugState?.trap || debugState?.winner) return 4;
  return Number.POSITIVE_INFINITY;
}

async function playOneAvailableGameActionAcrossPages(pages, coverage) {
  const pageStates = await Promise.all(pages.map(async (page) => ({ page, debugState: await collectGameDebugState(page) })));
  const playablePageState = pageStates
    .map((entry, index) => ({ ...entry, index, priority: getPlayableActionPriority(entry.debugState) }))
    .filter((entry) => Number.isFinite(entry.priority))
    .sort((left, right) => left.priority - right.priority || left.index - right.index)[0];
  if (playablePageState) return playOneAvailableGameAction(playablePageState.page, coverage, { pages, preferredPageIndex: playablePageState.index });

  for (const page of pages) {
    if (await isPlayableActionVisible(page)) return playOneAvailableGameAction(page, coverage, { pages, preferredPageIndex: pages.indexOf(page) });
  }

  for (const page of pages) {
    if (await isVisible(page.getByTestId('game-screen'))) {
      await page.waitForTimeout(350);
      coverage.autoWaited += 1;
      return 'wait';
    }
  }

  throw new Error(`처리 가능한 기기전 게임 액션을 찾지 못했습니다: ${JSON.stringify(pageStates.map((entry) => entry.debugState), null, 2)}`);
}

async function playUntilActionsAcrossPages(pages, testInfo, { targetActions = 10, maxTicks = 100, minActionsBeforeWinner = 6, stepPrefix = 'device-action' } = {}) {
  const coverage = createGameActionCoverage();
  const actionHistory = [];
  let progressedActions = 0;
  for (let tick = 1; tick <= maxTicks && progressedActions < targetActions; tick += 1) {
    const action = await playOneAvailableGameActionAcrossPages(pages, coverage);
    actionHistory.push(action);
    if (action === 'winner') {
      const debugStates = await Promise.all(pages.map((page) => collectGameDebugState(page)));
      expect(progressedActions, `기기전 게임이 너무 빨리 종료되었습니다: ${JSON.stringify({ coverage, actionHistory, debugStates }, null, 2)}`).toBeGreaterThanOrEqual(minActionsBeforeWinner);
      break;
    }
    if (action !== 'wait') progressedActions += 1;
    if (tick % 10 === 0) {
      await Promise.all(pages.map((page, index) => saveStepScreenshot(page, testInfo, `${stepPrefix}-${index + 1}-${tick}`)));
    }
  }

  const debugStates = await Promise.all(pages.map((page) => collectGameDebugState(page)));
  const failureDebug = JSON.stringify({ coverage, actionHistory, debugStates }, null, 2);
  expect(progressedActions, `기기전에서 충분한 게임 액션을 진행하지 못했습니다: ${failureDebug}`).toBeGreaterThanOrEqual(targetActions);
  expect(coverage.rolled, `기기전 QA 루프에서 윷 던지기를 최소 1회 이상 수행해야 합니다: ${failureDebug}`).toBeGreaterThan(0);
  expect(coverage.manualMoved + coverage.autoWaited, `기기전 QA 루프에서 수동 이동 또는 자동 이동 대기 상태를 검증해야 합니다: ${failureDebug}`).toBeGreaterThan(0);
  return coverage;
}

async function waitForAnyPlayableActionVisible(pages, timeout = 20_000) {
  await expect.poll(async () => {
    for (const page of pages) {
      if (await page.getByTestId('roll-yut-button').isVisible().catch(() => false)) return true;
      if (await page.getByTestId('move-piece-button').isVisible().catch(() => false)) return true;
      if (await page.locator('.bottom-branch-controls').isVisible().catch(() => false)) return true;
      if (await page.locator('.inline-item-prompt').isVisible().catch(() => false)) return true;
      if (await page.locator('.trap-placement-banner').isVisible().catch(() => false)) return true;
    }
    return false;
  }, { message: '차례 순서 연출이 끝난 뒤 현재 턴 기기에서 처리 가능한 게임 액션이 보여야 합니다.', timeout }).toBeTruthy();
}

async function cleanupRememberedRooms() {
  const errors = [];
  for (const roomId of Array.from(rememberedRoomIds)) {
    try {
      await deleteRoomForQa(roomId);
      rememberedRoomIds.delete(roomId);
    } catch (error) {
      errors.push(`${roomId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  expect(errors, `QA 방 폭파 실패:\n${errors.join('\n')}`).toEqual([]);
}

async function saveStepScreenshot(page, testInfo, step) {
  if (process.env.CI) return;
  await fs.mkdir(screenshotDir, { recursive: true });
  const fileName = `${testInfo.project.name.replaceAll(' ', '-')}-${String(testInfo.retry)}-${step}.png`;
  await page.screenshot({ path: path.join(screenshotDir, fileName), fullPage: true });
}

test.beforeEach(async ({ page }, testInfo) => {
  await fs.mkdir(screenshotDir, { recursive: true });
  await fs.appendFile(consoleLogPath, `\n## ${testInfo.project.name} - ${testInfo.title}\n`);
  page.on('console', async (message) => {
    const line = `[${new Date().toISOString()}] [${testInfo.project.name}] ${message.type()}: ${message.text()}\n`;
    await fs.appendFile(consoleLogPath, line);
  });
});

test.afterEach(async () => {
  await cleanupRememberedRooms();
});

test('mobile game QA: room creation, AI fill, start, and short autoplay', async ({ page }, testInfo) => {
  const consoleErrors = [];
  const qaRoomTitle = `QA 자동 테스트 ${testInfo.project.name} ${Date.now()}-${testInfo.retry}-${testInfo.workerIndex}`;
  attachConsoleErrorCapture(page, consoleErrors);
  await primeQaLobbyStorage(page.context(), { nickname: `QA-${testInfo.project.name}-${testInfo.workerIndex}`, maxPlayers: '4', itemMode: 'true', pieceCount: '4' });

  try {
    await runQaStep(testInfo, '01 로비 진입', async () => {
      await page.goto('/');
      await expect(page.getByTestId('app-shell')).toBeVisible();
      await saveStepScreenshot(page, testInfo, '01-lobby');
    });

    await runQaStep(testInfo, '02 방 생성 후 대기실 진입', async () => {
      await page.getByTestId('room-title-input').fill(qaRoomTitle);
      await page.getByTestId('create-room-button').click();
      await expect.poll(() => collectLobbyTransitionDebugState(page, qaRoomTitle), { message: '방 생성 후 대기실로 이동해야 합니다.', timeout: 25_000 }).toMatchObject({ waitingRoom: { visible: true } });
      await expect.poll(() => rememberRoomIdForQa(page, qaRoomTitle), { message: '생성한 QA 방 ID를 기억해야 합니다.' }).toBeTruthy();
      await saveStepScreenshot(page, testInfo, '02-waiting-room');
    });

    await runQaStep(testInfo, '03 AI 채우기 및 시작 버튼 활성화 확인', async () => {
      for (const label of ['P2', 'P3', 'P4']) {
        const button = page.getByTestId(`add-ai-${label}`);
        if (await button.isVisible()) {
          await button.click();
          await expect(button).toBeHidden({ timeout: 10_000 });
        }
      }
      await expect(page.getByTestId('waiting-room')).toBeVisible();
      await expect(page.getByTestId('start-game-button'), `시작 버튼이 방장 대기실에 보여야 합니다: ${JSON.stringify(await collectWaitingRoomDebugState(page), null, 2)}`).toBeVisible({ timeout: 10_000 });
      await expect(page.getByTestId('start-game-button'), `모든 AI 추가 후 시작 버튼이 활성화되어야 합니다: ${JSON.stringify(await collectWaitingRoomDebugState(page), null, 2)}`).toBeEnabled({ timeout: 10_000 });
      await saveStepScreenshot(page, testInfo, '03-ai-filled');
    });

    await runQaStep(testInfo, '04 게임 시작 화면 확인', async () => {
      await page.getByTestId('start-game-button').click();
      await expect(page.getByTestId('game-screen')).toBeVisible({ timeout: 8_000 });
      await expect(page.getByTestId('play-timer')).toBeVisible();
      await expect(page.getByTestId('players-panel')).toContainText('P1');
      await expect(page.getByTestId('turn-indicator')).toBeVisible();
      await expect(page.getByTestId('game-board')).toBeVisible();
      await expect(page.locator('[data-testid^="piece-"]').first()).toBeVisible();
      await saveStepScreenshot(page, testInfo, '04-game-started');
    });

    await runQaStep(testInfo, '05 실제 게임 상태 머신으로 10개 이상 액션 진행', async () => {
      const coverage = await playUntilActions(page, testInfo, { targetActions: 10, maxTicks: 100, minActionsBeforeWinner: 6, stepPrefix: '05-action' });
      await appendQaStepLog(testInfo, 'INFO', '05 상태 머신 커버리지', JSON.stringify(coverage));
      await expect(page.getByTestId('game-screen')).toBeVisible();
      await saveStepScreenshot(page, testInfo, '05-action-loop-complete');
    });

    await runQaStep(testInfo, '06 콘솔 에러 허용 범위 확인', async () => {
      assertConsoleErrorsWithinQaAllowance(consoleErrors);
    });
  } finally {
    await cleanupRememberedRooms();
  }
});

test.describe('mobile device-to-device QA', () => {
  test.skip(({ browserName }) => browserName !== 'webkit', '기기 간 대전은 iPad/WebKit 프로젝트에서 한 번만 실행합니다.');

  test('mobile game QA: iPad and Galaxy join one individual match', async ({ playwright }, testInfo) => {
    test.skip(!(await loadFirebaseConfig()), '기기 간 대전 QA는 Firebase 설정이 필요합니다.');
    const consoleErrors = [];
    const qaRoomTitle = `QA 기기 대전 ${Date.now()}-${testInfo.retry}-${testInfo.workerIndex}`;
    const ipadNickname = 'QA iPad';
    const galaxyNickname = 'QA Galaxy';
    const baseURL = testInfo.project.use.baseURL ?? 'http://127.0.0.1:4173';
    const ipadBrowser = await playwright.webkit.launch();
    const galaxyBrowser = await playwright.chromium.launch();
    const ipadContext = await ipadBrowser.newContext({ ...devices['iPad (gen 7)'], viewport: { width: 810, height: 1080 } });
    const galaxyContext = await galaxyBrowser.newContext({ ...devices['Galaxy S9+'], viewport: { width: 412, height: 915 }, deviceScaleFactor: 3.5 });

    try {
      await runQaStep(testInfo, '기기전 01 로컬 스토리지 준비', async () => {
        await primeQaLobbyStorage(ipadContext, { nickname: ipadNickname });
        await primeQaLobbyStorage(galaxyContext, { nickname: galaxyNickname });
      });

      const ipadPage = await runQaStep(testInfo, '기기전 02 iPad 페이지 생성', async () => ipadContext.newPage());
      const galaxyPage = await runQaStep(testInfo, '기기전 03 Galaxy 페이지 생성', async () => galaxyContext.newPage());
      attachConsoleErrorCapture(ipadPage, consoleErrors);
      attachConsoleErrorCapture(galaxyPage, consoleErrors);

      await runQaStep(testInfo, '기기전 04 iPad 방 생성 및 대기실 진입', async () => {
        await ipadPage.goto(baseURL);
        await expect(ipadPage.getByTestId('app-shell')).toBeVisible();
        await ipadPage.getByTestId('room-title-input').fill(qaRoomTitle);
        await ipadPage.getByTestId('create-room-button').click();
        await expect.poll(async () => {
          const state = await collectLobbyTransitionDebugState(ipadPage, qaRoomTitle);
          return state.waitingRoom.visible ? 'ready' : JSON.stringify(state, null, 2);
        }, { message: '기기전 host 방 생성 후 대기실로 이동해야 합니다.', timeout: 25_000 }).toBe('ready');
        await expect.poll(() => rememberRoomIdForQa(ipadPage, qaRoomTitle), { message: '생성한 QA 기기 대전 방 ID를 기억해야 합니다.' }).toBeTruthy();
        await saveStepScreenshot(ipadPage, testInfo, '06-device-host-waiting');
      });

      await runQaStep(testInfo, '기기전 05 Galaxy 방 참여 및 준비 버튼 확인', async () => {
        await galaxyPage.goto(baseURL);
        await expect(galaxyPage.getByTestId('app-shell')).toBeVisible();
        const targetRoomCard = galaxyPage.locator('.lobby-room-card').filter({ hasText: qaRoomTitle });
        await expect(targetRoomCard).toBeVisible({ timeout: 15_000 });
        await targetRoomCard.getByRole('button', { name: '참여' }).click();
        const galaxyWaitingRoom = galaxyPage.getByTestId('waiting-room');
        const galaxyReadyCard = galaxyWaitingRoom.locator('.ready-card.me');
        await expect(galaxyWaitingRoom).toBeVisible({ timeout: 25_000 });
        await expect(galaxyReadyCard).toContainText(galaxyNickname, { timeout: 15_000 });
        await expect(galaxyReadyCard).toContainText('나', { timeout: 15_000 });
        await expect(galaxyPage.getByRole('button', { name: '준비 완료' })).toBeEnabled({ timeout: 15_000 });
        await saveStepScreenshot(galaxyPage, testInfo, '07-device-guest-waiting');
      });

      await runQaStep(testInfo, '기기전 06 Galaxy 준비 완료 후 iPad 시작 버튼 확인', async () => {
        await galaxyPage.getByRole('button', { name: '준비 완료' }).click();
        await expect(ipadPage.getByTestId('waiting-room').locator('.ready-card').filter({ hasText: galaxyNickname })).toBeVisible({ timeout: 15_000 });
        await expect(ipadPage.getByTestId('start-game-button')).toBeEnabled({ timeout: 15_000 });
        await ipadPage.getByTestId('start-game-button').click();
      });

      await runQaStep(testInfo, '기기전 07 양쪽 게임 화면 준비 확인', async () => {
        await expectTwoPlayerGameReady(ipadPage, ipadNickname, galaxyNickname);
        await expectTwoPlayerGameReady(galaxyPage, ipadNickname, galaxyNickname);
        await saveStepScreenshot(ipadPage, testInfo, '08-device-host-game');
        await saveStepScreenshot(galaxyPage, testInfo, '09-device-guest-game');
      });

      await runQaStep(testInfo, '기기전 08 실제 게임 상태 머신으로 10개 이상 액션 진행', async () => {
        await waitForAnyPlayableActionVisible([ipadPage, galaxyPage]);
        const coverage = await playUntilActionsAcrossPages([ipadPage, galaxyPage], testInfo, { targetActions: 10, maxTicks: 100, minActionsBeforeWinner: 6, stepPrefix: '10-device-action' });
        await appendQaStepLog(testInfo, 'INFO', '기기전 08 상태 머신 커버리지', JSON.stringify(coverage));
        await expect(ipadPage.getByTestId('game-screen')).toBeVisible();
        await expect(galaxyPage.getByTestId('game-screen')).toBeVisible();
      });

      await runQaStep(testInfo, '기기전 09 콘솔 에러 허용 범위 확인', async () => {
        assertConsoleErrorsWithinQaAllowance(consoleErrors);
      });
    } finally {
      await ipadContext.close().catch(() => {});
      await galaxyContext.close().catch(() => {});
      await ipadBrowser.close().catch(() => {});
      await galaxyBrowser.close().catch(() => {});
      await cleanupRememberedRooms();
    }
  });
});
