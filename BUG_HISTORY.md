# BUG_HISTORY.md

This file records repeated bugs, failed fixes, root causes, and approaches that must not be repeated.

The active history before this fix is preserved without modification in [`BUG_HISTORY_BEFORE_2026-08-16_AUTO_MOVE_TIMER.md`](./BUG_HISTORY_BEFORE_2026-08-16_AUTO_MOVE_TIMER.md).

---

## 2026-08-16 - 턴 handoff receipt 지연, 중복 auto-move producer, AI fallback 지연

### Symptom

- 온라인 다음 턴의 `activeSeat` snapshot을 늦게 받은 클라이언트가 서버 ready 경계의 남은 시간만 기다리지 않고 receipt 시점부터 약 2초 전환 대기를 다시 시작할 수 있었다.
- 출발점 단일 말 자동 이동은 App effect와 durable hook 두 producer가 경합했고, canonical readiness 이후에도 별도 500ms가 붙었다.
- AI는 유효한 authoritative ready 경계가 이미 열렸거나 1초 미만 남았어도 기본 1초 fallback을 다시 적용할 수 있었다.

### Confirmed root cause

- action readiness가 서버 deadline에서 파생한 `readyAt` 외에 receipt-relative local transition과 TurnIndicator hold를 함께 소비했다.
- 온라인 start-piece auto-move ownership이 App effect와 `useDurableStartPieceAutoMove`에 중복되어 있었고 durable opportunity 자체에도 500ms delay가 있었다.
- AI scheduling이 authoritative `readyAt`을 계산한 뒤에도 fallback delay를 최소값처럼 적용했다.

### Required state invariants

- 온라인 action readiness 시계는 authoritative deadline에서 파생한 하나의 `readyAt`만 사용한다. 늦은 snapshot 수신은 이미 지난 시간을 다시 기다리지 않는다.
- move 실행 readiness는 authoritative action readiness와 실제 move presentation readiness가 모두 충족될 때만 publish한다. presentation 완료 전 자동 제출이나 pending 해제는 금지한다.
- 온라인 start-piece auto-move producer는 durable hook 하나다. readiness 이후 deterministic 자동 이동에 별도 500ms를 추가하지 않는다.
- 오프라인 `AUTO_SINGLE_MOVE_DELAY_MS` 500ms는 기존 UX 경로로 유지하며 온라인 producer와 공유하지 않는다.
- AI는 유효한 authoritative deadline이 살아 있으면 남은 ready 시간 + 80ms boundary buffer만 기다리고, ready 경계가 이미 지났다면 80ms만 기다린다. deadline 누락/해석 불가/만료로 timeout recovery가 ownership을 가져간 경우에만 기존 1초 fallback을 사용한다.
- accepted move submission의 pending/claim identity와 서버 early-submit guard는 유지한다.

### Do not try again

- `activeSeat` receipt 시각을 기준으로 별도 end-hold + start-delay를 재시작하지 않는다.
- TurnIndicator에 authoritative handoff와 별개인 receipt-relative hold timer를 추가하지 않는다.
- 온라인 자동 이동을 App effect와 durable hook에서 동시에 생산하지 않는다.
- readiness 이후 500ms sleep/retry나 AI 1초 fallback을 성능 안정화 명목으로 다시 추가하지 않는다.
- presentation/pending 경합을 timeout 증가, retry 추가, assertion 완화로 숨기지 않는다.

### Regression and verification

- unit: `tests/unit/turn-transition-clock.test.ts`, `tests/unit/moveActionPresentationPolicy.test.ts`, `tests/unit/turnIndicatorPresentation.test.ts`, `tests/unit/move-submission-opportunity-policy.test.ts`, `tests/unit/aiTurnScheduling.test.ts`에서 authoritative boundary, 단일 producer, 즉시 auto-move, AI ready scheduling을 고정한다.
- Galaxy: `tests/mobile/auto-move-pending-timer.spec.js`, `tests/mobile/online-ai-human-atomic-move-start.spec.js`, `tests/mobile/online-ai-turn-progress.spec.js`에서 slow ACK 경합, 단일 move execution, presentation 뒤 AI action 시작을 검증한다.
- QA manifest는 durable 수동 클릭 경합 테스트의 최신 제목을 `mobile-galaxy-move-ack`에 연결하며 workflow/성능 threshold는 변경하지 않는다.
- 최종 build/unit/Required QA 및 exact merge-SHA Main Branch QA 결과는 통합 PR에 기록한다.

---

## 2026-08-16 - 출발 말 자동 이동 one-shot 유실과 move pending 타이머 잔존

### Symptom

- 실제 온라인 플레이어가 판 위에 말을 하나도 올리지 않은 상태에서 이동 경로와 활성 이동 버튼은 정상인데 자동 이동이 실행되지 않는 경우가 있었다.
- 말 이동을 제출해 버튼은 즉시 비활성화됐는데도 서버 ACK를 기다리는 동안 `.turn-action-timer`가 계속 표시됐다.

### Confirmed root cause

- 기존 출발 말 자동 이동은 500ms effect timer 한 번에 `moveSelectedPiece()`를 맡겼고, authoritative snapshot 재렌더로 effect가 정리되면 대기 시간이 다시 시작됐다. callback 시점의 transient canonical readiness가 false면 반환값을 소비하지도 보존하지도 않아 같은 이동 기회를 다시 실행할 안정적인 identity가 없었다.
- move 제출 자체는 `moveInProgressRef`/local presentation ownership을 먼저 선점해 성공 제출의 중복 실행은 막고 있었지만, 그 이전의 자동 이동 opportunity lifecycle은 별도 one-shot timer에만 의존했다.
- move controls는 authoritative deadline과 transition readiness만으로 timer visibility를 계산해, accepted/pending move presentation을 별도 소비 상태로 보지 않았다. 따라서 이동 버튼과 타이머가 서로 다른 pending 계약을 사용했다.

### Required state invariants

- 출발 말 자동 이동은 room/actor/authoritative move deadline/roll로 만든 안정적인 move opportunity key를 사용한다. 같은 snapshot 재렌더는 최초 `readyAt`을 유지한다.
- canonical `moveRequestReady`와 실제 UI `moveActionReady`가 모두 준비되지 않은 transient 상태에서는 opportunity를 소비하지 않는다. readiness가 복구되면 같은 key와 기존 `readyAt`으로 다시 평가한다.
- 자동 제출, 수동 클릭, deadline callback 중 하나가 성공 제출을 선점하면 synchronous local move ownership과 presentation pending이 같은 opportunity를 소비해 `move_piece_resolved`를 정확히 한 번만 만든다.
- 판 위에 말이 없을 때 기존 lowest-label 선택, 분기/경로, local presentation ownership은 변경하지 않는다.
- accepted move submission은 authoritative deadline과 별개의 presentation-pending 상태를 가진다. pending 동안 move timer만 숨기며 deadline 값 자체는 변경하지 않는다.
- 느린 ACK에서 이동 애니메이션이 먼저 끝나도 request가 pending이면 timer가 다시 나타나지 않는다. 서버 거부/재동기화로 같은 deadline의 `moveRequestReady`가 복구되면 pending을 해제하고 기존 deadline의 실제 남은 시간으로 timer를 다시 표시한다.
- 누적 윷의 stack 선택 전 move deadline은 submission pending이 아니므로 기존처럼 표시한다.

### Do not try again

- 자동 이동 실패를 delay 증가, sleep, 주기적 retry, timeout 증가로 숨기지 않는다.
- snapshot마다 500ms one-shot timer를 새 기회처럼 다시 시작하거나 `moveSelectedPiece()`의 false 반환을 성공처럼 소비하지 않는다.
- timer를 `!moveRequestReady`, `!moveActionReady`, CSS visibility만으로 숨기지 않는다.
- UI 편의를 위해 authoritative `turnDeadlineAt`/`turnDeadlineKind`를 조기 삭제하거나 서버 상태를 변경하지 않는다.
- 수동 클릭·deadline callback·자동 이동에 서로 다른 중복 방지 identity를 추가하지 않는다.

### Regression and verification

- unit: `tests/unit/move-submission-opportunity-policy.test.ts`에서 snapshot readyAt 보존, transient not-ready→ready, accepted pending의 slow-ACK 유지·거부 복구, 성공 opportunity 단일 소비를 고정한다.
- Galaxy: `tests/mobile/auto-move-pending-timer.spec.js`에서 실제 guest/2말/걸 무클릭 자동 이동, authoritative snapshot 재렌더, lowest-label n01→n02→n03→n04 단일 이동, 다른 말 n01 유지, 양쪽 수렴, `move_piece_resolved` 1개를 검증한다.
- Galaxy move ACK: 같은 spec에서 느린 ACK 직후 버튼 비활성화와 `.turn-action-timer` 즉시 0개 및 ACK 대기 중 재노출 방지를 검증한다.
- Main QA manifest의 `mobile-galaxy-move-start`와 `mobile-galaxy-move-ack`에 위 신규 테스트 제목과 spec을 직접 포함한다.
- 최종 build/unit/architecture/Galaxy/Required Checks/Main Branch QA 결과는 이 변경의 PR 및 merge SHA 기준으로 확인한다.
