export async function installGameStatisticsFixture(page, {
  roomId = 'qa-statistics-room',
  localSeatId = 'p2',
  seats,
  sequences,
  latestState = null,
  delayMs = 80,
  failuresBeforeSuccess = 0,
  roomData = null,
} = {}) {
  const nicknameDialog = page.getByRole('dialog', { name: '닉네임 설정' });
  if (await nicknameDialog.isVisible().catch(() => false)) {
    await nicknameDialog.getByRole('textbox').fill('통계QA');
    await nicknameDialog.getByRole('button', { name: '시작하기' }).click();
    await nicknameDialog.waitFor({ state: 'hidden' });
  }

  await page.evaluate(({ nextRoomId, nextLocalSeatId, nextSeats, nextSequences, nextLatestState, nextDelayMs, nextFailuresBeforeSuccess, nextRoomData }) => {
    const setActiveRoomId = (roomId) => window.localStorage.setItem('yut-online:activeRoomId', roomId);
    const restoreActiveRoomIdIfMissing = (roomId) => {
      if (!window.localStorage.getItem('yut-online:activeRoomId')?.trim()) setActiveRoomId(roomId);
    };
    setActiveRoomId(nextRoomId);
    window.__YUT_QA_GAME_STATISTICS_LOCAL_SEAT_ID__ = nextLocalSeatId;
    window.__YUT_QA_GAME_STATISTICS_LOADER_CALLS__ = [];
    window.__YUT_QA_GAME_STATISTICS_FAILURES_LEFT__ = nextFailuresBeforeSuccess;
    window.__YUT_QA_GAME_STATISTICS_LOADER__ = async (requestedRoomId) => {
      window.__YUT_QA_GAME_STATISTICS_LOADER_CALLS__.push(requestedRoomId);
      const configured = nextRoomData?.[requestedRoomId] ?? {
        seats: nextSeats,
        sequences: nextSequences,
        latestState: nextLatestState,
        delayMs: nextDelayMs,
      };
      await new Promise((resolve) => window.setTimeout(resolve, Number(configured.delayMs ?? nextDelayMs)));
      restoreActiveRoomIdIfMissing(requestedRoomId);
      if (window.__YUT_QA_GAME_STATISTICS_FAILURES_LEFT__ > 0) {
        window.__YUT_QA_GAME_STATISTICS_FAILURES_LEFT__ -= 1;
        throw new Error('QA 통계 조회 실패');
      }
      return [{ gameSeats: configured.seats, ...(configured.latestState ?? {}) }, configured.sequences];
    };

    document.querySelector('#qa-game-statistics-fixture')?.remove();
    const fixture = document.createElement('main');
    fixture.id = 'qa-game-statistics-fixture';
    fixture.className = 'game-shell';
    Object.assign(fixture.style, {
      position: 'fixed',
      inset: '0 auto auto 0',
      width: 'min(100vw, 760px)',
      zIndex: '2',
      pointerEvents: 'none',
    });

    const sideColumn = document.createElement('div');
    sideColumn.dataset.testid = 'game-side-column';
    sideColumn.className = 'game-side-column';
    const logPanel = document.createElement('aside');
    logPanel.className = 'panel side';
    const header = document.createElement('div');
    header.className = 'log-header';
    const heading = document.createElement('h2');
    heading.textContent = '진행 기록';
    const actions = document.createElement('div');
    actions.className = 'log-header-actions';
    actions.style.pointerEvents = 'auto';
    const exportButton = document.createElement('button');
    exportButton.type = 'button';
    exportButton.className = 'diagnostic-button';
    exportButton.setAttribute('aria-label', '최신 상태와 전체 시퀀스 내보내기');
    exportButton.textContent = '🧾';
    const statisticsButton = document.createElement('button');
    statisticsButton.type = 'button';
    statisticsButton.className = 'diagnostic-button game-statistics-open-button';
    statisticsButton.dataset.testid = 'open-game-statistics';
    statisticsButton.setAttribute('aria-label', '통계 정보 열기');
    statisticsButton.setAttribute('title', '통계 정보 열기');
    statisticsButton.innerHTML = '<svg viewBox="0 0 28 28" aria-hidden="true"><g transform="rotate(-18 9 14)"><rect x="5" y="3" width="7" height="22" rx="3.5"></rect><path d="M8.5 7v3M8.5 18v3"></path></g><g transform="rotate(18 19 14)"><rect x="16" y="3" width="7" height="22" rx="3.5"></rect><path d="M19.5 7v3M19.5 18v3"></path></g></svg>';
    statisticsButton.addEventListener('click', () => {
      setActiveRoomId(nextRoomId);
      window.__YUT_QA_OPEN_GAME_STATISTICS__?.();
    });
    actions.append(exportButton, statisticsButton);
    header.append(heading, actions);
    logPanel.append(header);
    sideColumn.append(logPanel);
    fixture.append(sideColumn);
    document.body.append(fixture);
  }, {
    nextRoomId: roomId,
    nextLocalSeatId: localSeatId,
    nextSeats: seats,
    nextSequences: sequences,
    nextLatestState: latestState,
    nextDelayMs: delayMs,
    nextFailuresBeforeSuccess: failuresBeforeSuccess,
    nextRoomData: roomData,
  });
}

export const baseStatisticsSeats = [
  { id: 'p1', label: 'P1', name: '첫째', color: 'red', team: '청팀', seatIndex: 0 },
  { id: 'p2', label: 'P2', name: '둘째', color: 'blue', team: '홍팀', seatIndex: 1 },
  { id: 'ai-3', label: 'P3', name: 'AI 단풍', color: 'green', team: '청팀', seatIndex: 2, isAI: true },
];

export const baseStatisticsSequences = [
  { id: 's9', sequence: 9, type: 'roll_yut', actorId: 'p1', payload: { timingZone: 'perfect', displayRoll: { name: '모', steps: 5, bonus: true }, fallOccurred: false } },
  { id: 's8', sequence: 8, type: 'roll_yut', actorId: 'p2', payload: { timingZone: 'normal', displayRoll: { name: '개', steps: 2 }, fallOccurred: false } },
  { id: 's7', sequence: 7, type: 'roll_yut', actorId: 'p1', payload: { timingZone: 'good', displayRoll: { name: '도', steps: 1 }, fallOccurred: false } },
  { id: 's6', sequence: 6, type: 'roll_yut', actorId: 'p2', payload: { timingZone: 'bad', displayRoll: { name: '윷', steps: 4, bonus: true }, fallOccurred: true } },
  { id: 's5', sequence: 5, type: 'move_piece_resolved', actorId: 'p1', payload: { captured: true, capturedPieceIds: ['p2-piece-1', 'p2-piece-2'] } },
  { id: 's4', sequence: 4, type: 'roll_yut', actorId: 'ai-3', payload: { timingZone: 'nice', displayRoll: { name: '빽도', steps: -1 }, fallOccurred: false } },
];
