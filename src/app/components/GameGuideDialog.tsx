import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { getYutResultProbabilitiesForTiming } from '../../game-core/roll';
import { publishGameGuideDialogOpenHandler } from '../flows/gameGuideDialogPresentation';

const STANDARD_YUT_RESULT_PROBABILITIES = getYutResultProbabilitiesForTiming('nice');
const PERFECT_YUT_RESULT_PROBABILITIES = getYutResultProbabilitiesForTiming('perfect');

const formatYutResultProbabilities = (probabilities: ReturnType<typeof getYutResultProbabilitiesForTiming>) => probabilities
  .map(({ name, probability }) => `${name} ${Number((probability * 100).toFixed(2))}%`)
  .join(' · ');

type GameGuideQaWindow = Window & {
  __YUT_QA_OPEN_GAME_GUIDE__?: () => void;
};

function GameGuideIcon() {
  return <svg viewBox="0 0 32 32" aria-hidden="true" focusable="false"><path d="M4 6.5c5-1.2 8-.3 12 2.2v18c-4-2.5-7-3.4-12-2.2zM28 6.5c-5-1.2-8-.3-12 2.2v18c4-2.5 7-3.4 12-2.2z" /></svg>;
}

export function GameGuideDialogHost() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const dialogRef = useRef<HTMLElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  const closeDialog = useCallback(() => setDialogOpen(false), []);
  const openDialog = useCallback(() => {
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setDialogOpen(true);
  }, []);

  useLayoutEffect(() => {
    const unpublish = publishGameGuideDialogOpenHandler(openDialog);
    const qaWindow = typeof window === 'undefined' ? null : window as GameGuideQaWindow;
    if (qaWindow) qaWindow.__YUT_QA_OPEN_GAME_GUIDE__ = openDialog;
    return () => {
      unpublish();
      if (qaWindow?.__YUT_QA_OPEN_GAME_GUIDE__ === openDialog) delete qaWindow.__YUT_QA_OPEN_GAME_GUIDE__;
    };
  }, [openDialog]);

  useEffect(() => {
    if (!dialogOpen) return undefined;
    scrollRef.current?.scrollTo({ top: 0, left: 0 });
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const frame = window.requestAnimationFrame(() => {
      dialogRef.current?.querySelector<HTMLElement>('button:not([disabled])')?.focus();
    });
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeDialog();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previousFocusRef.current?.focus();
    };
  }, [closeDialog, dialogOpen]);

  if (!dialogOpen) return null;

  return createPortal(
    <div className="screen-lobby game-guide-dialog-host">
      <div className="lobby-sheet-backdrop" role="presentation" onMouseDown={closeDialog}>
        <section
          ref={dialogRef}
          data-testid="game-guide-dialog"
          className="panel lobby-sheet lobby-howto-sheet"
          role="dialog"
          aria-modal="true"
          aria-label="게임 방법"
          onMouseDown={(event: MouseEvent<HTMLElement>) => event.stopPropagation()}
        >
          <header className="lobby-sheet-heading howto-fixed-header">
            <span className="lobby-sheet-emblem" aria-hidden="true"><GameGuideIcon /></span>
            <div><p className="section-kicker">처음이어도 쉬워요</p><h2>게임 방법</h2></div>
            <button className="sheet-close" type="button" onClick={closeDialog} aria-label="닫기">×</button>
          </header>
          <div ref={scrollRef} className="howto-scroll-body">
            <section className="howto-section howto-results-section" aria-labelledby="game-guide-results-title">
              <h3 id="game-guide-results-title" className="howto-section-title">윷 결과</h3>
              <div className="howto-result-probabilities" aria-label="윷 결과 확률 안내">
                <p><strong>Nice·Good·Bad</strong><span>{formatYutResultProbabilities(STANDARD_YUT_RESULT_PROBABILITIES)}</span><small>낙이 아닌 정상 투척 기준</small></p>
                <p><strong>Perfect</strong><span>{formatYutResultProbabilities(PERFECT_YUT_RESULT_PROBABILITIES)}</span></p>
              </div>
              <div className="howto-result-strip" aria-label="윷 결과 이동 칸 수"><span><b>빽도</b>-1칸</span><span><b>도</b>1칸</span><span><b>개</b>2칸</span><span><b>걸</b>3칸</span><span><b>윷</b>4칸</span><span><b>모</b>5칸</span></div>
            </section>
            <section className="howto-section" aria-labelledby="game-guide-basic-title">
              <h3 id="game-guide-basic-title" className="howto-section-title">기본 규칙</h3>
              <div className="howto-list">
                <article><span className="howto-step">01</span><div className="howto-icon" role="img" aria-label="방 만들기 도식">＋</div><div><h4>기본 진행</h4><p>방장이 인원과 규칙을 정하고 모두 준비하면 게임을 시작합니다. 게임 시작 시 플레이 순서가 자동으로 정해집니다.</p><p>자신의 차례에 윷을 던진 뒤 결과에 맞춰 이동할 말을 선택합니다.</p></div></article>
                <article><span className="howto-step">02</span><div className="howto-icon howto-yut-icon" role="img" aria-label="윷 던지기 도식">타이밍</div><div><h4>타이밍</h4><p>막대는 Perfect(보라), Nice(하늘), Good(연두), Bad(검정)로 판정됩니다.</p><p>Perfect는 낙이 없고 윷·모 확률이 높습니다. Nice·Good·Bad는 단계가 낮을수록 낙이 발생하기 쉽습니다.</p></div></article>
                <article><span className="howto-step">03</span><div className="howto-icon" role="img" aria-label="말 이동 도식">●→●</div><div><h4>말 이동 규칙</h4><p>아직 출발하지 않은 말도 결과를 사용해 판 위로 이동할 수 있고, 갈림길에 도착하면 바깥길 또는 지름길을 선택합니다.</p><p>같은 편 말은 업어서 함께 이동하고, 상대 말을 잡으면 출발 전 상태로 돌려보낸 뒤 한 번 더 던집니다.</p></div></article>
                <article><span className="howto-step">04</span><div className="howto-icon" role="img" aria-label="완주 도식">🏁</div><div><h4>빽도와 완주</h4><p>빽도는 판 위에 있는 말을 한 칸 뒤로 이동합니다. 움직일 말이 없을 때 나온 빽도는 이동하지 못합니다.</p><p>출발점을 다시 지나 완주 지점까지 도착해야 완주 처리됩니다.</p></div></article>
              </div>
              <aside className="howto-tip"><span aria-hidden="true">✦</span><p><strong>승리 조건</strong> 개인전은 내 말을, 팀전은 우리 팀 말을 모두 완주시키면 승리합니다.</p></aside>
            </section>
            <section className="howto-section" aria-labelledby="game-guide-options-title">
              <h3 id="game-guide-options-title" className="howto-section-title">방 옵션</h3>
              <div className="howto-compact-grid">
                <p><strong>개인전</strong><span>각 플레이어가 자신의 말을 완주시키는 방식입니다.</span></p>
                <p><strong>팀전</strong><span>4명이 청팀 2명, 홍팀 2명으로 진행합니다.</span></p>
                <p><strong>인원</strong><span>개인전은 2~4인, 팀전은 4인으로 진행합니다.</span></p>
                <p><strong>말 개수</strong><span>플레이어 또는 팀별로 1~4개를 사용합니다.</span></p>
                <p><strong>아이템</strong><span>아이템 칸과 아이템 사용 여부를 정합니다.</span></p>
                <p><strong>누적 던지기</strong><span>윷·모로 얻은 결과를 모아 사용합니다.</span></p>
              </div>
              <div className="howto-mini-card"><h4>누적 던지기</h4><ul><li>켜져 있으면 윷이나 모가 나왔을 때 바로 이동하지 않고 계속 던집니다.</li><li>추가 던지기가 끝나면 누적된 결과 중 사용할 결과를 선택해 하나씩 말을 이동합니다.</li><li>상대 말을 잡으면 다시 던질 기회가 추가될 수 있습니다.</li><li>남아 있는 결과를 모두 사용하면 다음 차례로 넘어갑니다.</li></ul></div>
            </section>
            <section className="howto-section" aria-labelledby="game-guide-online-title">
              <h3 id="game-guide-online-title" className="howto-section-title">온라인 플레이</h3>
              <div className="howto-mini-card"><ul><li>잠시 연결이 끊기거나 게임에서 나가면 AI가 플레이를 대신 이어갈 수 있습니다.</li><li>같은 방에 다시 입장하면 기존 자리의 통제권을 복구합니다.</li><li>이미 게임 중인 방은 관전할 수 있습니다.</li></ul></div>
            </section>
          </div>
          <footer className="howto-fixed-footer"><button className="primary-cta howto-confirm-button" type="button" onClick={closeDialog}>확인</button></footer>
        </section>
      </div>
    </div>,
    document.body,
  );
}
