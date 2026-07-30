# BUG_HISTORY.md

This file records repeated bugs, failed fixes, root causes, and approaches that must not be repeated.

The complete history recorded through 2026-07-26 is preserved without modification in [`BUG_HISTORY_ARCHIVE_2026-07-26.md`](./BUG_HISTORY_ARCHIVE_2026-07-26.md). The active entries recorded from 2026-07-27 through 2026-07-30 are preserved without modification in [`BUG_HISTORY_ACTIVE_ARCHIVE_2026-07-30.md`](./BUG_HISTORY_ACTIVE_ARCHIVE_2026-07-30.md).

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
