from pathlib import Path
import traceback

path = Path('tests/regression/bug-history-smoke.spec.js')
status_path = Path('.patch-status')
error_path = Path('.patch-error')


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'{label}: expected one match, found {count}')
    return text.replace(old, new, 1)


try:
    text = path.read_text(encoding='utf-8')

    text = replace_once(
        text,
        """      await clickSequenceRollAtPerfect();
      await expect(page.locator('.roll-stage.pending-roll'),""",
        """      await page.evaluate(() => {
        window.__YUT_QA_RESULT_HOLD_OBSERVER__?.disconnect();
        const timing = { startedAt: 0, endedAt: 0 };
        window.__YUT_QA_RESULT_HOLD_TIMING__ = timing;
        let observer;
        const sample = () => {
          const visible = Boolean(document.querySelector('.roll-stage.resolved-from-pending.result-hold-roll'));
          const now = performance.now();
          if (visible && timing.startedAt === 0) timing.startedAt = now;
          if (!visible && timing.startedAt > 0 && timing.endedAt === 0) {
            timing.endedAt = now;
            observer?.disconnect();
          }
        };
        observer = new MutationObserver(sample);
        window.__YUT_QA_RESULT_HOLD_OBSERVER__ = observer;
        observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
        sample();
      });
      await clickSequenceRollAtPerfect();
      await expect(page.locator('.roll-stage.pending-roll'),""",
        'result-hold observer before roll click',
    )

    text = replace_once(
        text,
        """      window.__YUT_QA_AI_MOVE_OBSERVATIONS__ = {};
      window.__YUT_QA_AI_MOVE_OBSERVER__ = window.setInterval(() => {""",
        """      window.__YUT_QA_AI_MOVE_OBSERVATIONS__ = {};
      window.__YUT_QA_LOCAL_MOVE_SEEN__ = false;
      window.__YUT_QA_AI_MOVE_OBSERVER__ = window.setInterval(() => {""",
        'local move observation initialization',
    )

    text = replace_once(
        text,
        """          const debugPiece = pieces.find((piece) => piece && typeof piece === 'object' && piece.id === pieceId) ?? {};
          if (localSeatId && debugPiece.ownerId === localSeatId) continue;
          const rect = node.getBoundingClientRect();""",
        """          const debugPiece = pieces.find((piece) => piece && typeof piece === 'object' && piece.id === pieceId) ?? {};
          if (localSeatId && debugPiece.ownerId === localSeatId) {
            window.__YUT_QA_LOCAL_MOVE_SEEN__ = true;
            continue;
          }
          const rect = node.getBoundingClientRect();""",
        'local movement persistent observation',
    )

    text = replace_once(
        text,
        """      await expect.poll(async () => (await getMovingPieces()).length, { timeout: 8_000, message: '본인 optimistic 이동 애니메이션이 시작되어야 합니다.' }).toBeGreaterThan(0);
      await expect.poll(async () => (await getMovingPieces()).length, { timeout: 12_000, message: '본인 optimistic 이동 애니메이션이 종료되어야 합니다.' }).toBe(0);""",
        """      await expect.poll(() => page.evaluate(() => Boolean(window.__YUT_QA_LOCAL_MOVE_SEEN__)), {
        timeout: 8_000,
        message: '본인 optimistic 이동 애니메이션이 한 번 이상 관찰되어야 합니다.',
      }).toBe(true);
      await expect.poll(async () => (await getMovingPieces()).length, { timeout: 12_000, message: '본인 optimistic 이동 애니메이션이 종료되어야 합니다.' }).toBe(0);""",
        'local movement assertion',
    )

    if text.count('__YUT_QA_RESULT_HOLD_TIMING__ = timing') != 1:
        raise RuntimeError('result-hold observer must be initialized exactly once')
    if "본인 optimistic 이동 애니메이션이 시작되어야 합니다." in text:
        raise RuntimeError('transient local movement assertion remains')

    path.write_text(text, encoding='utf-8')
    status_path.write_text('ok\n', encoding='utf-8')
    error_path.unlink(missing_ok=True)
except Exception:
    status_path.write_text('failed\n', encoding='utf-8')
    error_path.write_text(traceback.format_exc(), encoding='utf-8')
