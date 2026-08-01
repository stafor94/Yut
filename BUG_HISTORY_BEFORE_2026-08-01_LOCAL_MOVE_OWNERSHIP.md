# BUG_HISTORY.md

This file records repeated bugs, failed fixes, root causes, and approaches that must not be repeated.

The complete history recorded through 2026-07-26 is preserved without modification in [`BUG_HISTORY_ARCHIVE_2026-07-26.md`](./BUG_HISTORY_ARCHIVE_2026-07-26.md). The active entries recorded from 2026-07-27 through 2026-07-30 are preserved without modification in [`BUG_HISTORY_ACTIVE_ARCHIVE_2026-07-30.md`](./BUG_HISTORY_ACTIVE_ARCHIVE_2026-07-30.md).

---

## 2026-07-31 - #1285 병합 후 unit compile 및 Galaxy timeout presentation QA 실패

### Symptom

- 병합 SHA `9836e890...`의 Main Branch QA에서 `Build and unit tests`와 `QA Mobile Galaxy timing`이 실패했다.
- 신규 timeout autoplay 단위 테스트는 TypeScript compile 단계에서 중단돼 assertion이 한 번도 실행되지 않았다.
- 3초 지연 roll 제출 QA에서 제출 직후 사라진 기존 timer/live meter가 authoritative 응답 전 다시 표시됐다.
- 기존 timeout QA 6개는 자동 제출 후 timer가 사라진 새 제품 계약을 실패로 판단했다.

### Confirmed root cause

- `timeout-autoplay-authoritative-flow.test.ts`의 조건부 빈 객체가 optional-property union으로 추론됐고, `status === 'committed'` 검사만으로 optional `patch`가 타입상 좁혀지지 않았다.
- `turnActionPresentationPolicy`는 pending roll을 `canSubmitTurnAction`과 `rollResultHolding`만으로 추론했다. 지연 제출 중 roll animation 때문에 실제 roll action은 불가능한데 `canSubmitTurnAction`이 다시 true가 되는 경계에서 소비된 timer와 live meter가 재마운트됐다.
- `roll-timing-timeout-deadline.spec.js`는 이전 계약인 “시간 초과 처리 상태에서도 timer DOM 유지”를 계속 요구했다. #1285의 “유효한 자동 제출 즉시 소비된 timer/live meter 종료” 계약과 assertion이 반대였다.
- #1285는 신규 unit 및 Galaxy timing 테스트를 실제 실행하기 전에 병합됐고, `BUG_HISTORY.md`의 verification checklist도 미완료 상태였다.

### Required state invariants

- roll phase에서 `canRollNow=false`이면 roll animation, pending action, timeout 자동 제출 등 실제 입력 불가 presentation으로 간주하고 소비된 timer/live meter를 표시하지 않는다.
- 서버 거부나 재동기화 후 `canRollNow=true`, `canSubmitTurnAction=true`, `rollResultHolding=false`가 되면 유효한 authoritative roll deadline의 실제 잔여시간으로 입력 UI를 복구한다.
- timeout QA는 deadline 직전까지 timer와 live meter가 같은 deadline으로 존재하는지 확인하고, 자동 제출 상태가 시작된 뒤에는 둘 다 종료됐는지 확인한다.
- 신규·수정 TypeScript 테스트는 compile 성공 후 assertion이 실제 실행돼야 한다.

### Do not try again

- `canSubmitTurnAction` 하나만으로 roll presentation pending 여부를 추론하지 않는다.
- 자동 제출 뒤 timer DOM이 사라진 것을 회귀로 간주해 이전 assertion을 그대로 유지하지 않는다.
- 테스트 파일이 suite에 포함됐다는 사실만으로 실행 완료로 판단하지 않는다.
- compile 실패를 assertion 실패나 일시적 CI 문제로 분류해 재실행만 하지 않는다.

### Verification checklist

- [x] unit fixture map 타입과 authoritative commit type guard를 보강했다.
- [x] roll action availability를 presentation pending 정책에 포함했다.
- [x] timeout QA를 deadline 직전 표시와 자동 제출 직후 종료의 연속 계약으로 변경했다.
- [ ] Unit tests pass
- [ ] Build succeeds
- [ ] QA architecture validation passes
- [ ] Mobile Galaxy timing QA passes
- [ ] Main Branch QA succeeds

---

## 2026-07-31 - 온라인 roll 제출·move 연출·말 settlement·연속 timeout autoplay 상태 불일치

### Symptom

- 유효한 윷 제출 뒤 authoritative 응답을 기다리는 동안 이미 소비된 roll 제한시간 막대와 live timing meter가 계속 움직였다.
- optimistic 말 이동이 목표 위치를 표시한 뒤 출발 상태로 돌아갔다가 authoritative 목표 위치로 다시 이동했다.
- 윷 결과 연출이 끝나 말 이동 버튼이 활성화되기 전에 move 제한시간과 timeout recovery가 진행될 수 있었다.
- 같은 좌석이 실제 제한시간을 두 번 연속 초과해도 `autoPlayBySeatId`가 활성화되지 않았다.

### Confirmed root cause

- `GameBoardControls`의 표시 조건이 `canSubmitTurnAction=false`인 pending roll과 `rollResultHolding`을 timer/meter 종료 조건으로 사용하지 않았다.
- #1273은 pending 중 subscription의 same/older snapshot을 막았지만, commit 뒤 zero-delay `apply-wake`가 같은 sequence를 다시 적용했고 이미 enqueue된 `GameBoardSection` settlement는 실행 시 최신 presentation revision인지 검증하지 않았다. 실제 rollback 공급 경로는 equal-sequence `apply-wake`와 stale queued settlement였다.
- core reducer의 `rollResultReadyAt=now+2600`과 client pending presentation의 `primary 1200 + landing 1000 + result hold 2600`, 지연 응답의 extra-spin 경계가 서로 다른 완료 시각을 사용했다. 그 결과 authoritative move deadline이 실제 action-ready보다 먼저 시작했다.
- 즉시 제출 timeout roll canonicalization은 network-grace recovery를 피하려고 `timeoutDeadlineAt`을 제거하면서 `deadlineAutoSubmitted` 표식도 남기지 않았다. move/item 자동 행동은 recovery/coordinator payload 때문에 marker 소비 전에 반환돼 timeout count가 증가하지 않거나 정상 행동처럼 보일 수 있었다.

### Required state invariants

- roll 입력 제출 직후 기존 roll timer와 live meter는 종료되고, 서버 거부 시에만 아직 유효한 authoritative deadline의 실제 남은 시간으로 복구한다.
- 한 local `clientMutationId`에는 하나의 presentation owner만 존재하고, authoritative 확인은 `start → target` 단조성을 유지한다. apply-wake는 strictly newer sequence만 적용하며 queued settlement는 실행 시 revision을 다시 검증한다.
- `turnDeadlineAt - 적용 제한시간 = rollResultReadyAt`이고, move 버튼 enabled 최초 프레임보다 move timer가 먼저 표시되거나 timeout recovery가 먼저 실행되면 안 된다.
- deadline 자동 행동은 actor/action/deadline marker를 authoritative payload에 보존한다. 성공한 timeout commit만 count를 증가시키고, 두 번째 commit에서 count 2와 autoplay true를 같은 patch로 저장한다. timeout AI/coordinator 행동은 count를 초기화하지 않는다.

### Do not try again

- authoritative deadline을 로컬 presentation 편의를 위해 재설정하거나 timer DOM만 숨겨 서버 timeout을 계속 진행시키지 않는다.
- queue key 중복 제거만으로 stale closure를 안전하다고 판단하지 않는다.
- CSS, sleep, timeout 증가로 optimistic rollback이나 연출/제한시간 순서 오류를 숨기지 않는다.
- coordinator metadata가 있다는 이유만으로 deadline marker를 소비하지 않거나 자동 행동을 정상 수동 행동으로 분류하지 않는다.
- fixture에서 `autoPlayBySeatId=true`를 직접 주입하는 테스트만으로 연속 timeout 정책을 검증 완료하지 않는다.

### Verification checklist

- [x] same/older apply-wake와 stale presentation revision 단위 회귀 테스트 추가
- [x] pending roll timer/meter 표시 정책 단위 테스트 추가
- [x] fast·primary·extra-spin 지연 응답의 authoritative roll readyAt 단위 테스트 추가
- [x] 실제 timeout action 두 번의 reducer commit으로 count 1→2와 autoplay 전환 테스트 추가
- [x] Galaxy 412×915에서 제출 직후 roll timer/meter 종료와 move enabled/timer 최초 프레임 순서 QA 추가
- [ ] Unit tests pass
- [ ] Build succeeds
- [ ] QA architecture validation passes
- [ ] Mobile Galaxy timing QA passes
- [ ] Main Branch QA succeeds

---

## 2026-07-31 - 온라인 제한시간 막대·실제 deadline과 시간초과 윷 판정 불일치 재발

### Symptom

- 온라인 턴 전환 hold 뒤 제한시간 막대가 늦게 표시되면 막대가 약 10~15% 남은 상태에서 `윷 던지기` 버튼이 먼저 비활성화됐다.
- 막대가 소진된 뒤 `TURN_NETWORK_GRACE_MS` 동안 처리 상태가 명확히 표시되지 않았고, 약 1초 뒤 자동 던지기가 실행됐다.
- 시간초과 자동 던지기의 타이밍 위치가 매 기회 같은 phase로 수렴해 결과가 사실상 `Bad`로 고정될 수 있었다.

### Expected behavior

- 막대 소진과 수동 입력 차단은 같은 authoritative `turnDeadlineAt`을 사용한다.
- timer DOM이 늦게 마운트돼도 현재 deadline 진행률에서 시작하고, 같은 deadline의 일반 rerender에서는 다시 시작하지 않는다.
- deadline 이후 network grace 동안 버튼은 비활성화되고 `시간 초과 처리 중...` 상태를 표시하며, timeout action은 한 번만 제출한다.
- 새 던지기 기회는 0~30%에서 한 번 정한 초기 위치로 기존 속도·판정 구간을 유지해 왕복하고, 화면·pointerdown·deadline timeout·coordinator recovery가 같은 계산을 사용한다.

### Confirmed root cause

- `GameBoardControls.tsx`가 `actionReady`와 실제 timer 표시 조건이 충족되기 전에 `deadlineTimerAnimation` cache를 선점했다.
- 온라인 상태 수신 뒤 로컬 전환 hold가 끝나 timer DOM이 마운트될 때도 상태 수신 시점의 animation snapshot을 재사용해 CSS 막대 종료가 authoritative deadline보다 늦어졌다.
- 기존 cache 단위 테스트는 같은 key의 snapshot 보존만 확인했고 hidden 상태 계산 뒤 늦은 최초 표시를 검증하지 않았다.
- `RollTimingControl`은 마운트 시점 phase 0에서 시작했고 timeout은 마지막 rAF snapshot을 제출했다. coordinator fallback도 `timeoutWindowMs`만 phase 0 공식에 넣어 표준 10초·5초 window에서 같은 위치로 수렴했다.
- React state만으로 timeout 제출을 막아 같은 deadline callback 재진입이 network grace timer를 중복 예약할 수 있었다.

### Previous coverage gap and recurrence

- timer animation cache 도입 시 late mount와 10초↔5초 duration 전환을 실제 표시 계약으로 고정하지 않았다.
- 이전 timeout 수정은 명시적인 `Bad/0%` 하드코딩을 제거했지만, 초기 phase가 기회별로 달라지지 않아 표준 timeout window에서 결과가 다시 고정되는 경로를 남겼다.
- 기존 Galaxy timing QA는 pointerdown immutable snapshot과 표시 일치를 검증했지만 authoritative deadline에서 자동 제출되는 위치, network grace 상태, 단일 sequence를 연결해 검증하지 않았다.

### Do not try again

- `TURN_ACTION_TIMEOUT_MS`, 10초/5초 누적 정책, `TURN_NETWORK_GRACE_MS` 또는 reducer의 exact deadline·actor·grace 검증을 표시 문제 해결 목적으로 변경하지 않는다.
- deadline 이후 수동 입력을 다시 허용하거나 network grace를 제한시간 막대에 포함하지 않는다.
- timer가 보이기 전에 animation cache를 생성하지 않는다.
- React render마다 `Math.random()`을 호출하거나 rerender·StrictMode·온라인 snapshot 갱신 때 초기 위치를 다시 추첨하지 않는다.
- 화면 위치와 timeout 판정을 별도 formula 또는 고정 `Bad` 값으로 계산하지 않는다.
- pointerdown snapshot 대신 pointerup·computed style·compositor 위치를 authoritative 입력으로 되돌리지 않는다.
- timeout 증가, sleep, assertion 삭제, skip으로 재현 실패를 숨기지 않는다.

### Correct fix plan

- deadline animation cache는 hidden 계산을 저장하지 않고 timer가 실제 처음 보이는 시점의 `deadlineAt - Date.now()` snapshot만 저장한다.
- roll·move와 item prompt timer 모두 실제 표시 조건과 authoritative deadline을 공유하고 deadline 이후 남은 막대를 표시하지 않는다.
- network grace 동안 처리 상태를 표시하고 deadline key별 timeout commit guard로 정확히 한 번만 제출한다.
- deadline에서 재현 가능한 0~30% 초기 위치를 opportunity snapshot에 저장하고 기존 왕복 공식을 화면·수동 입력·자동 timeout·coordinator recovery에서 공유한다.
- sampler 주입 단위 테스트와 Galaxy 412×915 온라인 회귀 테스트로 late mount, 0%/30% timeout 결과, 단일 sequence, 최종 연출까지 검증한다.

### Verification checklist

- [x] hidden 계산이 cache를 선점하지 않는 단위 테스트를 추가했다.
- [x] 0·15·30% sampler, 동일 opportunity 보존, 새 deadline 재생성, 양끝 왕복, 동일 위치 판정 단위 테스트를 추가했다.
- [x] timeout resolver가 UI와 같은 deadline-seeded motion을 사용하도록 연결했다.
- [x] Galaxy 412×915 timeout spec을 `mobile-galaxy-timing` suite manifest에 연결했다.
- [ ] Unit tests pass
- [ ] Build succeeds
- [ ] QA architecture validation passes
- [ ] Mobile Galaxy timeout deadline QA passes
- [ ] Main Branch QA succeeds
