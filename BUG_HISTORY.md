# BUG_HISTORY.md

This file records repeated bugs, failed fixes, root causes, and approaches that must not be repeated.

The complete history recorded through 2026-07-26 is preserved without modification in [`BUG_HISTORY_ARCHIVE_2026-07-26.md`](./BUG_HISTORY_ARCHIVE_2026-07-26.md). New repeated-bug entries are recorded here so the currently active constraints remain reviewable.

---

## 2026-07-29 - 일반 말 이동 제한시간 이후 버튼만 잠기고 턴이 영구 고착됨

### Symptom

- 온라인 게임에서 일반 `roll` 결과가 확정되고 말 이동을 기다리는 중 제한시간이 끝나면 이동 버튼만 비활성화될 수 있었다.
- authoritative state의 `roll`, `turnIndex`, `turnDeadlineKind='move'`, 만료된 `turnDeadlineAt`이 유지되고 `move_piece_resolved` sequence가 생성되지 않았다.
- 다중 미선택 이동 스택이 아닌 비누적 일반 이동에서도 새로고침 전까지 게임이 진행되지 않았다.

### Expected behavior

- deadline 이후 일반 사용자 입력은 계속 차단한다.
- UI의 deadline 직전 callback이 실행되지 않거나 늦어도 현재 coordinator가 `deadline + TURN_NETWORK_GRACE_MS` 이후 진행을 보장한다.
- 동일 room·actor·deadline은 같은 action key로 처리하고 committed/duplicate 이후 중복 이동을 만들지 않는다.
- 비누적 roll, 선택된 누적 스택, 기존 미선택 누적 스택의 timeout 역할이 충돌하지 않아야 한다.

### Confirmed root cause

- `App.tsx`의 일반 stalled-turn recovery는 authoritative 절대 recovery 시각이 아니라 effect 활성화 시점부터의 `TURN_ACTION_TIMEOUT_MS` 경과시간을 사용했다.
- 최초 timer가 deadline 부근에 실행되면 reducer의 network grace 이전이라 거부됐다.
- network grace 거부와 네트워크 오류에서 `stalledTurnRecoveryKeyRef`가 해제되지 않아 같은 턴의 이후 재평가가 `already-recovery-requested`로 차단될 수 있었다.
- 기존 `useStackedRollTimeoutRecovery`는 `roll=null`인 닫힌 미선택 스택만 담당해 일반 `roll` 이동 대기를 복구하지 않았다.

### Previous coverage gap

- stacked timeout QA는 0번 스택 단일 소비와 중복 방지를 검증했지만 비누적 `roll={ name: '개', steps: 2 }` 이동 대기를 만들지 않았다.
- reducer의 grace 이전 거부와 grace 이후 커밋은 단위 검증됐지만 UI callback 실패 뒤 coordinator fallback까지 연결한 Desktop/Galaxy QA가 없었다.
- 표시 제한시간이 10초 또는 5초로 달라지거나 effect가 늦게 활성화되는 경우에도 authoritative recoveryAt이 동일해야 한다는 순수 정책 테스트가 없었다.

### Do not try again

- deadline 이후 이동 버튼을 다시 활성화하지 않는다.
- `AUTO_ACTION_LEAD_MS`, 제한시간, network grace, Playwright timeout을 늘려 고착을 숨기지 않는다.
- reducer의 exact deadline, actor, coordinator lease, network grace 검증을 완화하지 않는다.
- rejection 또는 네트워크 오류 뒤 recovery key를 유지한 채 자동 재시도가 될 것이라고 가정하지 않는다.
- 일반 `roll` 문제를 기존 `roll=null` stacked recovery만 검증하고 해결됐다고 판단하지 않는다.

### Correct fix plan

- move timeout recovery는 `getTurnRecoveryDeadlineAt(turnDeadlineAt)` 절대 시각을 사용하고 callback에서도 현재 시각과 room·actor·phase·deadline·coordinator seat·epoch를 다시 검증한다.
- 기존 timeout resolver로 비누적 roll, 선택된 누적 스택, 미선택 누적 스택의 immutable context를 한 번 계산한다.
- 기존 coordinator move timeout transaction을 모든 move timeout context에 재사용해 reducer와 save transaction의 exact deadline·grace·lease·sequence·processed action 검증을 유지한다.
- committed/duplicate만 terminal로 기록하고 조기 실행·lease/sequence/state mismatch·네트워크 오류는 in-flight를 해제해 제한 횟수로 재평가한다.
- Desktop online-core와 Galaxy 412×915 QA에서 일반 개 이동 fixture, grace 전 미제출, grace 후 단일 sequence, timeout count 1회, stale 버튼 해제, 중복 없음까지 검증한다.

### Verification checklist

- [x] 절대 recoveryAt, exact scope, retry 분류·제한 정책 단위 테스트를 추가했다.
- [x] 일반 roll과 기존 stacked roll이 같은 stable action key와 coordinator transaction을 사용하는 실행 연결 테스트를 추가했다.
- [x] Desktop spec을 `online-core`, Galaxy spec을 `mobile-galaxy` suite manifest에 연결했다.
- [ ] Unit tests pass
- [ ] Build succeeds
- [ ] QA architecture validation passes
- [ ] Desktop online-core normal move timeout QA passes
- [ ] Mobile Galaxy normal move timeout QA passes
- [ ] Main Branch QA succeeds

## 2026-07-29 - 게임 방법 팝업 높이 추정값과 방 목록 로딩 순간 상태로 Main Branch QA 실패

### Symptom

- PR #1235 병합 뒤 Main Branch QA Run `30422939647`에서 Desktop regression과 Mobile Galaxy의 게임 방법 팝업 높이 비교가 실패했다.
- 같은 Run의 Online core에서 4인 순서 정하기 시나리오가 세 번째 게스트의 방 참가 중 `room-list-loading` 표시를 찾지 못해 실패했다.

### Expected behavior

- 게임 방법 팝업은 설정 팝업을 변경하지 않고 Desktop과 Mobile에서 실제 설정 팝업 높이와 같아야 한다.
- 방 참가 공용 QA helper는 방 목록 로딩이 아직 진행 중인 경우와 이미 완료된 경우를 모두 처리하고 목표 방 카드가 준비될 때까지 기다려야 한다.

### Confirmed root cause

- 게임 방법 팝업 높이를 설정 팝업의 실제 브라우저 계산값과 대조하지 않고 Desktop `438px`, Mobile `492px`로 추정했다.
- 실패 trace에서 설정 팝업의 실제 높이는 Desktop `471.265625px`, Mobile `542.375px`였고 각각 `33.265625px`, `50.375px` 차이가 났다.
- `joinRoomFromLobby()`는 방 참가 팝업이 열린 뒤 `room-list-loading`이 반드시 보였다가 사라진다고 가정했다.
- 세 번째 게스트에서는 구독 결과가 먼저 도착해 팝업을 확인했을 때 목표 방 카드가 이미 표시됐으므로 정상 완료 상태인데도 로딩 UI assertion이 실패했다.

### Previous failed approach

- 설정 팝업의 콘텐츠 기반 실제 높이를 확인하지 않고 예상 고정 높이로 게임 방법 팝업을 맞췄다.
- 비동기 완료 조건인 목표 방 카드 대신 짧게 존재할 수 있는 중간 로딩 UI의 노출을 공용 helper의 필수 조건으로 사용했다.

### Do not try again

- 설정 팝업 높이를 추정값으로 다시 계산하거나 설정 팝업 자체를 변경해 게임 방법 팝업에 맞추지 않는다.
- `room-list-loading`처럼 이미 사라질 수 있는 중간 상태를 방 참가 성공의 필수 선행 조건으로 사용하지 않는다.
- assertion 삭제, 무근거 timeout 증가, 테스트 skip 또는 재실행으로 실패를 숨기지 않는다.

### Correct fix plan

- 실패 trace에서 확인한 설정 팝업의 실제 계산 높이를 기준으로 게임 방법 팝업의 Desktop·Mobile 높이만 조정하고 viewport 상한과 내부 스크롤을 유지한다.
- 방 참가 helper는 로딩 표시가 있으면 숨겨질 때까지 기다리되 이미 없으면 통과하고, 목표 방 카드의 표시와 참가 버튼 활성화를 실제 완료 조건으로 사용한다.
- 기존 Desktop regression·Mobile Galaxy 높이·닫기 버튼 비교와 Online core 4인 동시 제출 시나리오의 실행 연결을 유지한다.

### Verification checklist

- [x] Unit tests pass
- [x] Build succeeds
- [x] QA architecture validation passes
- [ ] Desktop regression game guide QA passes
- [x] Mobile Galaxy game guide QA passes
- [x] Online core 4-client turn-order QA passes
- [ ] Main Branch QA succeeds

### Follow-up failure after PR #1238

- Main Branch QA Run `30423900639`에서 새 높이 비교와 Online core는 통과했고, 그 다음 순차 assertion인 닫기 버튼 상단 여백 비교가 Desktop `26px`, Mobile Galaxy `15px` 차이로 실패했다.
- 공통 `.lobby-sheet.panel`의 padding 규칙이 더 높은 specificity로 게임 방법 팝업의 `padding: 0`을 이겨, 전용 헤더 padding 바깥에 Desktop `30px`, Mobile `16px`의 패널 padding이 중복 적용됐다.
- 게임 방법 팝업에 임의 음수 margin이나 절대 좌표를 추가하지 않는다. 공통 패널과 전용 팝업 클래스를 함께 선택해 중복 padding을 명시적으로 제거하고, Desktop 헤더 상단은 설정 팝업이 사용하는 공통 padding 토큰과 기존 heading `-2px` 오프셋을 재사용한다.
- 상단 위치만 순차적으로 맞추고 오른쪽 위치를 다음 Run에 맡기지 않는다. 같은 수정에서 Desktop·Mobile의 상단·오른쪽 계산을 모두 설정 팝업과 대조한다.

### Follow-up failure after PR #1239

- Main Branch QA Run `30424426215`에서 Mobile Galaxy 게임 방법 QA와 Online core는 통과했고, Desktop도 높이·닫기 버튼 크기·상단 여백까지 통과했다.
- Desktop의 다음 순차 assertion인 닫기 버튼 오른쪽 여백은 `15px` 차이로 실패했다. 외부 `.lobby-howto-sheet`에 남은 `scrollbar-gutter: stable`이 내부 스크롤 영역과 별도로 데스크톱 스크롤바 폭을 예약한 것이 원인이었다.
- 같은 Run의 독립 Mobile Galaxy timing은 Good 장기 press 테스트가 `64.07%`에서 중앙과 반대 방향으로 증가하는 프레임을 선택해, 180ms 뒤 가상 위치가 예상 Perfect 범위가 아닌 `82.07%`가 되면서 실패했다.
- 외부 팝업 gutter를 유지한 채 right margin이나 헤더 padding에서 `15px`를 빼지 않는다. 실제 스크롤을 담당하는 내부 body의 gutter만 유지하고 외부 gutter 예약을 제거한다.
- Good 장기 press의 허용 범위나 Perfect assertion을 넓히지 않는다. 왼쪽 Good에서는 증가 중이고 오른쪽 Good에서는 감소 중인, 실제로 중앙을 향하는 렌더 프레임만 선택한다.

## 2026-07-28 - 이동 스택 미선택 상태에서 제한시간 이후 게임이 영구 고착됨

### Symptom

- 누적 던지기 모드에서 서로 다른 이동 결과가 두 개 이상 쌓이고 아직 사용할 스택을 선택하지 않은 상태였다.
- authoritative/local 상태는 `roll=null`, `rollStackClosed=true`, `selectedRollStackIndex=null`, `turnDeadlineKind='move'`로 정상적인 선택 대기를 표현했다.
- 제한시간이 지나면 스택 버튼은 잠겼지만 `move_piece` sequence가 생성되지 않았고 같은 턴과 같은 이동 대기 상태가 계속 유지됐다.
- 새로고침이나 사용자의 수동 재클릭 없이는 게임을 진행할 수 없었다.

### Expected behavior

- deadline 직전 UI 자동 선택 callback이 실행되지 않거나 늦게 실행돼도 정확성이 깨지면 안 된다.
- deadline 이후 일반 사용자 입력은 계속 차단하되 `deadline + TURN_NETWORK_GRACE_MS` 이후 유효한 coordinator가 진행을 보장해야 한다.
- 유효한 기존 선택이 없으면 현재 화면 자동 처리 정책과 동일하게 배열의 0번 스택을 결정적으로 사용해야 한다.
- 선택한 roll과 `rollStackIndex`는 하나의 immutable timeout context에서 계산해 같은 authoritative payload로 제출해야 한다.

### Confirmed root cause

- 스택 동기화와 `resolveEffectiveMoveContext()`는 다중 미선택 상태를 의도대로 `roll=null`과 `rollStackIndex=null`로 유지했다.
- `GameBoardControls`의 deadline 약 80ms 전 자동 선택 callback이 사실상 유일한 진행 경로였고, Android/Samsung Internet의 타이머 지연·메인 스레드 정체·백그라운드 복귀로 callback이 deadline 이후 실행될 수 있었다.
- 늦은 callback은 일반 `move_piece`를 제출하지 않고 timeout 표시와 버튼 잠금만 수행했다.
- 기존 stalled-turn recovery는 local `roll`과 확정된 스택 인덱스를 요구했고, 다중 미선택 상태를 `roll-stack-index-ambiguous`로 차단해 coordinator 복구 대상을 만들지 못했다.
- authoritative reducer는 exact deadline, network grace, actor, coordinator lease, 유효한 `rollStackIndex`, 단일 스택 소비 계약을 이미 지원했지만 클라이언트가 해당 payload를 만들지 않았다.

### Previous failed approaches and coverage gap

- 기존 #443 계열 수정은 제한시간 자동 행동과 timeout 복구를 추가했지만 다중 미선택 스택에서 `roll=null`이 되는 정상 제품 상태를 회귀 fixture로 고정하지 않았다.
- deadline 직전 80ms 화면 타이머가 정상 실행되는 경로만 검증해 모바일 타이머 지연 시 정확성 보장 경로가 사라지는 문제를 남겼다.
- selected stack override 또는 이미 존재하는 local roll만 단위 테스트했고 `roll=null`, 닫힌 다중 스택, 미선택 상태의 coordinator recovery를 검증하지 않았다.
- reducer의 일반 move deadline과 선택된 스택 소비는 검증했지만 timeout recovery가 0번 스택 하나만 소비하고 같은 action key가 중복 이동을 만들지 않는 연결 테스트가 없었다.

### Do not try again

- 제한시간 이후 사용자가 스택 버튼을 다시 눌러야 진행되는 방식으로 복구하지 않는다.
- deadline 직전 80ms timer, React `setSelectedRollStackIndex()` 반영 순서, local `roll` 존재를 정확성의 필수 조건으로 사용하지 않는다.
- `roll-stack-index-ambiguous`를 이유로 닫힌 유효 스택의 timeout 복구를 영구 보류하지 않는다.
- UI disabled 조건 완화, 버튼 재활성화, deadline 이후 일반 사용자 action 허용으로 해결하지 않는다.
- 제한시간·Playwright timeout 증가, assertion 삭제, skip, `continue-on-error`, 스택 전체 소비로 고착을 숨기지 않는다.
- coordinator lease, actor, exact deadline, network grace 검증을 약화하지 않는다.

### Correct fix plan

- 수동 이동용 `resolveEffectiveMoveContext()`는 미선택 상태를 그대로 유지한다.
- 별도 순수 timeout resolver가 비누적 roll, 유효한 선택 인덱스, 단일 스택, 닫힌 미선택 다중 스택을 하나의 immutable `{ roll, rollStackIndex, steps, reason }`으로 결정한다.
- 닫힌 미선택 스택은 결과 중복 여부와 무관하게 배열의 0번을 기본값으로 사용하고 열린 스택·빈 스택·잘못된 인덱스·유효하지 않은 결과는 unresolved로 남긴다.
- 현재 coordinator만 `deadline + TURN_NETWORK_GRACE_MS` 이후 exact deadline과 동일 action key로 timeout recovery를 제출한다.
- 양수 이동에서 유효한 말이 없거나 분기점 선택이 필요한 기존 안전 상태는 임의 진행하지 않고 기존 진단·재동기화 정책을 유지한다.
- 빽도에 이동 가능한 말이 없으면 기존 authoritative 빈 `pieceId` 소비 계약을 유지한다.
- Desktop online-core와 Galaxy 412×915 QA가 미래 deadline의 선택 UI를 먼저 확인한 뒤 deadline을 만료시켜 UI callback에 의존하지 않고 sequence·state를 polling한다.

### Verification checklist

- [x] timeout 전용 immutable 이동 컨텍스트와 수동 선택 계약 분리를 단위 테스트에 추가했다.
- [x] reducer의 exact deadline, grace 이후 0번 단일 소비, 남은 스택 보존, 잘못된 deadline/index 거부, 재적용 비중복, 빽도 pass 계약을 회귀 테스트에 추가했다.
- [x] Desktop spec을 `online-core`, Galaxy spec을 `mobile-galaxy` suite manifest에 연결했다.
- [ ] Unit tests pass
- [ ] Build succeeds
- [ ] QA architecture validation passes
- [ ] Desktop online-core stacked timeout QA passes
- [ ] Mobile Galaxy stacked timeout QA passes
- [ ] Main Branch QA succeeds

## 2026-07-27 - AI끼리 순서 정하기 재대결 시 제출 완료 후 결과 수집 상태가 끝나지 않음

### Symptom

- 3인 개인전에서 사람 1명의 순위가 먼저 확정되고 AI 2명만 동률 재대결에 들어가면 두 AI 카드는 모두 `결과 대기`를 표시했다.
- AI별 `turnOrderSubmissions` 문서는 저장됐지만 화면은 `자동 던지기 결과를 모으는 중입니다`와 `동률 재대결이 진행 중입니다`에 계속 머물렀다.
- 제한시간 이후에도 결과 공개, 최종 순서 확정, 실제 게임 시작으로 진행되지 않았다.

### Expected behavior

- 재대결 라운드 제출 문서가 authoritative 라운드 활성화보다 먼저 저장돼도 같은 sessionId와 roundId의 전원 제출 상태를 다시 평가해야 한다.
- 대상 라운드를 authoritative 계산 안에서 활성화하고, eligibleSeatIds 전체의 고유 제출이 준비됐으면 같은 patch에서 집계해야 한다.
- 사람 플레이어에게 이미 확정된 placement, turnVersion·sequence 단조 증가, 최종 순서 로그 단일 생성 계약을 유지해야 한다.

### Confirmed root cause

- 화면은 `activateNextTurnOrderRound()`로 다음 라운드를 먼저 표시했지만 authoritative `currentRound` 전환은 별도 `updateTurnOrderState()` 트랜잭션에서 수행됐다.
- AI 제출 문서 저장과 제출 snapshot callback의 집계 트랜잭션이 라운드 전환보다 먼저 완료될 수 있었다.
- 기존 집계 patcher는 authoritative `currentRound.id`가 화면 라운드와 즉시 일치하고 status가 `collecting`일 때만 진행했으므로 이전 라운드의 `reveal-pending`을 읽으면 null을 반환했다.
- null 이후 잠금은 해제됐지만 이미 저장된 제출 문서에는 새 snapshot 변경이 없었고, transient coordinator lease 불일치에서도 같은 방식으로 재시도 신호가 사라졌다.
- 결과적으로 집계가 전원 제출이라는 상태가 아니라 제출 snapshot 이벤트가 발생한 순간에 의존했다.

### Previous coverage gap

- 기존 QA는 AI 자동 제출, 좌석별 제출 문서, 조기 집계, 2인 사람+AI 재대결, 3인 사람 1명+AI 2명 재대결의 정상 순서를 검증했다.
- authoritative 라운드가 이전 라운드인 동안 다음 라운드의 제출 문서가 먼저 모두 준비되는 역순 경합을 결정적으로 만들지 않았다.
- 네트워크 응답 순서에 따라 발생하는 문제를 반복 실행으로만 기대했기 때문에 정상 순서 QA가 통과해도 고착 가능성이 남았다.

### Do not try again

- `aggregatingRoundIdRef`를 무조건 초기화하고 제출 snapshot이 다시 발생할 것이라고 가정하지 않는다.
- 제한시간·Playwright timeout 증가, 무작위 반복 실행, AI 결과 재추첨으로 고착을 숨기지 않는다.
- 라운드 활성화와 집계를 계속 별도 이벤트 edge에 의존하게 두지 않는다.
- coordinator lease 검증, turnVersion·sequence 단조 증가, 좌석별 제출 중복 방지 계약을 약화하지 않는다.

### Correct fix plan

- 제출 구독 callback은 대상 라운드의 최신 제출 목록을 보관하고 UI에 반영하는 역할만 담당한다.
- 별도 coordinator aggregation effect가 캐시된 전원 제출 상태, authoritative 상태 변경, 잠금 해제, coordinator epoch 변경을 기준으로 재평가한다.
- 트랜잭션 안에서 `activateNextTurnOrderRound(current, transactionNow)`를 먼저 적용한 뒤 대상 sessionId·roundId·collecting 상태를 검증한다.
- eligibleSeatIds별 고유 제출이 모두 준비됐을 때만 `submitAndMaybeAggregateTurnOrderRound()`로 활성화와 집계를 하나의 idempotent patch로 만든다.
- null 또는 복구 가능한 오류는 in-flight 잠금을 해제하고 동일 scope의 전원 제출 상태가 유지될 때 제한된 단일 timer로 재시도한다.
- 순수 단위 테스트에서 다음 라운드 제출 준비 → authoritative 라운드 활성화의 역순을 고정하고, online-core와 mobile-galaxy에서 최종 화면·오버레이 종료·게임 시작까지 검증한다.

### Verification checklist

- [x] snapshot callback에서 직접 집계하던 경로를 최신 제출 캐시와 상태 기반 coordinator 집계로 분리했다.
- [x] authoritative 활성화와 전원 제출 집계를 한 계산에서 수행하는 순수 idempotent helper를 추가했다.
- [x] 일부 제출, 중복 좌석, 오래된 sessionId·roundId, 같은 입력 재호출 계약을 단위 테스트에 추가했다.
- [x] online-core와 mobile-galaxy 기존 spec의 suite manifest·Playwright project·workflow matrix 연결을 재확인했다.
- [ ] Unit tests pass
- [ ] Build succeeds
- [ ] QA architecture validation passes
- [ ] Online core AI-only rematch QA passes
- [ ] Mobile Galaxy turn-order completion QA passes
- [ ] Main Branch QA succeeds

## 2026-07-27 - AI 자동 플레이 안내가 모바일 스크롤에서 조작 영역과 분리됨

### Symptom

- 사람이 연속으로 제한시간을 초과해 authoritative AI 자동 플레이로 전환되면 안내가 윷판 위에 별도 플로팅 오버레이로 표시됐다.
- 모바일에서 화면을 아래로 스크롤하면 자동 플레이 상태, 대신 행동 중인 AI, 직접 플레이 복귀 방법을 조작 영역에서 확인할 수 없었다.
- 자동 플레이 중에도 제한시간·타이밍·던지기 등 직접 조작 UI와 별도 안내가 동시에 존재했다.

### Expected behavior

- 자동 플레이 상태는 기존 `play-controls` 영역 전체를 대체해 표시되어야 한다.
- 자동 플레이 중에는 제한시간, 타이밍 막대, 던지기·이동·아이템·분기 선택 UI를 렌더링하지 않아야 한다.
- 로컬 좌석만 같은 영역에서 직접 플레이로 복귀할 수 있고 pending 상태가 명확해야 한다.
- 시작·종료 전후 조작 영역 높이와 모바일 스크롤 위치 변화가 최소화되어야 한다.

### Confirmed root cause

- `GameScreenView`가 `BoardPanel` 내부에 `.auto-play-overlay`를 렌더링하고 모바일 CSS에서 `position: fixed`를 적용했다.
- 상태 안내 DOM이 실제 조작 UI를 소유한 `GameBoardControls`와 분리돼 윷판 positioning context, visual viewport, 문서 스크롤에 종속됐다.
- 기존 정적 테스트는 플로팅 CSS 문자열만 확인하고 실제 Galaxy viewport의 스크롤·DOM 포함 관계·복귀 흐름을 검증하지 않았다.

### Do not try again

- 자동 플레이 안내를 윷판 패널 내부 fixed/absolute overlay로 다시 렌더링하지 않는다.
- 자동 플레이 상태와 수동 조작 버튼을 다른 위치에 중복 렌더링하지 않는다.
- CSS 문자열 확인만으로 모바일 스크롤 회귀가 해결됐다고 판단하지 않는다.
- authoritative `autoPlayBySeatId`, timeout 정책, AI action 제출, `resume_human_control` 로직을 표시 문제 해결 목적으로 변경하지 않는다.

### Correct fix plan

- `GameBoardControls`가 자동 플레이 UI의 단일 렌더링 위치가 되도록 상태·표시 이름·로컬 여부·pending·복귀 callback을 전달한다.
- 자동 플레이 분기를 모든 직접 조작 분기보다 우선하고 기존 `play-controls` 컨테이너와 최소 높이를 유지한다.
- 로컬 좌석에는 복귀 버튼을, 다른 좌석에는 설명만 표시한다.
- Galaxy 412×915 온라인 QA에서 authoritative 상태 설정, 스크롤, DOM·좌표 포함 관계, pending, 통제권 회수, 일반 조작 UI 복구를 polling으로 검증한다.
- 신규 spec을 `mobile-galaxy` suite manifest와 Chromium Playwright project에 연결한다.

### Verification checklist

- [x] `GameScreenView`의 플로팅 자동 플레이 DOM 제거와 `GameBoardControls` 단일 렌더링 계약을 정적 검토했다.
- [x] 자동 플레이 분기가 제한시간·타이밍·던지기·이동·아이템·분기 선택보다 우선함을 단위 계약에 추가했다.
- [x] 신규 Galaxy spec을 `tests/qa/suite-manifest.mjs`의 `mobile-galaxy` 실행 목록에 연결했다.
- [ ] Unit tests pass
- [ ] Build succeeds
- [ ] QA architecture validation passes
- [ ] Mobile Galaxy autoplay scroll/resume QA passes
- [ ] Main Branch QA succeeds

## 2026-07-27 - 윷 던지기 pointerdown 위치와 결과 판정 불일치 세 번째 재발

### Symptom

- 첨부 영상 `1000075200.mp4`는 1080×2340, 약 120fps, 3.92초다.
- 약 0.47초에 터치 표시가 처음 나타날 때 오브 중심은 약 40%로 Good/Nice 경계이며 Perfect 구간 45~55% 밖이다.
- 터치 이후 라이브 오브는 계속 움직여 약 55%까지 이동했다.
- 약 0.71초에 roll-stage가 나타날 때 result hold 오브는 약 46%로 되돌아갔다.
- 최종 결과는 `PERFECT`로 표시됐다.
- 같은 입력에서 실제 pointerdown 위치, 마지막 라이브 위치, result hold/판정 위치가 서로 달랐다.

### Expected behavior

- 유효한 primary `pointerdown` 직전 마지막으로 실제 렌더링된 오브 위치가 authoritative 입력 snapshot이어야 한다.
- pointerdown 직후 live 오브가 즉시 고정되고, 오래 누르더라도 위치와 판정이 변하지 않아야 한다.
- live freeze, result hold, action payload, authoritative sequence/patch, RollStage 최종 등급은 하나의 immutable snapshot을 사용해야 한다.
- 버튼 밖 pointerup과 pointercancel은 제출하지 않고 멈춘 phase와 진행 방향에서 자연스럽게 재개해야 한다.

### Actual behavior

- `RollTimingControl`은 pointerdown에서 pointerId와 resetKey만 저장하고 pointerup에서 위치를 새로 측정해 제출했다.
- CSS compositor animation이 오브 transform을 소유하면서 JavaScript도 computed transform 읽기, inline transform 쓰기, animation cancel을 수행했다.
- Android/Samsung Internet에서 화면에 scanout된 합성 프레임과 메인 스레드가 읽은 computed transform 및 cancel 반영 시점이 달라 live 오브와 result hold가 다른 위치를 표시할 수 있었다.
- snapshot 안의 `positionPercent`, `trackOffsetPx`, `frozenTransform`이 서로 다른 표시·판정 경로에 사용돼 단일 기준이 아니었다.
- 기존 QA는 Good에서 누른 뒤 Perfect에서 손을 떼면 Perfect가 되는 pointerup 계약을 정상 동작으로 고정했다.

### Confirmed root cause

- 제품의 authoritative 입력 시점이 사용자가 인식하는 pointerdown이 아니라 pointerup이었다.
- CSS compositor와 JavaScript가 동시에 transform 위치 소유자로 동작했다.
- `getComputedStyle()`은 사용자가 마지막으로 본 scanout 프레임을 보장하지 않으며, compositor animation 진행과 메인 스레드 animation cancel 사이에는 모바일 브라우저별 반영 지연이 존재한다.
- 제출 percent와 표시 transform이 하나의 canonical 값에서 파생되지 않았다.

### Previous failed attempts

- PR #1130:
  - What was changed: CSS animation은 유지하고 requestAnimationFrame에서 화면 위치를 관찰했다.
  - Why it failed: 메인 스레드가 지연되면 rAF 관찰 snapshot과 compositor가 실제 표시한 프레임이 다시 갈라졌다. 위치 소유자는 여전히 CSS compositor였다.
- PR #1134:
  - What was changed: pointerup에서 computed transform을 읽고 inline transform으로 고정한 뒤 animation을 취소했다.
  - Why it failed: pointerup을 authoritative 입력으로 계속 사용했고 computed transform이 실제 scanout과 같다고 가정했다. 합성 프레임이 더 진행한 뒤 다른 위치로 되돌아가는 문제를 막지 못했다.
- 커밋 `998b6e2`, `91e0068`, `741bde6` 계열:
  - What was changed: local rAF transform writer를 도입했다가 기존 CSS animation 계약 테스트를 맞추기 위해 compositor animation을 다시 활성화했다.
  - Why it failed: CSS animation과 JavaScript rAF가 다시 동시에 transform을 써 단일 위치 소유 계약이 깨졌다.

### Do not try again

- pointerup 시점에 DOM 좌표, computed transform, Web Animations timeline을 다시 측정해 authoritative 위치를 만들지 않는다.
- CSS compositor animation과 JavaScript rAF가 동시에 `.roll-timing-orb-track` transform을 쓰게 하지 않는다.
- rAF writer를 도입한 뒤 과거 CSS animation 계약 테스트를 통과시키기 위해 `animation: roll-timing-orb-track ...`을 다시 활성화하지 않는다.
- 화면 위치, result hold, 제출 위치를 각각 px offset 또는 transform 문자열로 별도 저장하지 않는다.
- 실제 모바일 합성 지연을 재현하지 못하는 동일-task `animation.currentTime` 조작만으로 회귀가 해결됐다고 판단하지 않는다.
- assertion 삭제, skip 확대, 무근거 timeout 증가, 성능 예산 완화로 통과시키지 않는다.

### Correct fix plan

- `RollTimingControl`의 leaf-level requestAnimationFrame 루프 하나만 오브 transform을 기록한다.
- 기존 2초 왕복 `getRollTimingPositionPercent()` 계산을 재사용하고 React state는 프레임마다 갱신하지 않는다.
- 각 rAF가 `{ phaseMs, positionPercent, capturedAt, resetKey }` immutable snapshot을 저장한다.
- 표시 transform은 canonical `positionPercent`에서만 파생하고 frozen transform 문자열을 authoritative 값으로 저장하지 않는다.
- primary left-button pointerdown에서 다음 rAF를 취소하고 마지막으로 DOM에 기록한 snapshot을 고정한다.
- pointerup은 같은 pointerId/resetKey와 버튼 내부 release만 확인한 뒤 pointerdown snapshot을 그대로 제출한다.
- 버튼 밖 pointerup과 pointercancel은 action을 만들지 않고 pointerdown phase와 방향에서 rAF를 재개한다.
- keyboard click과 timeout도 마지막 실제 rAF 또는 활성 pointerdown snapshot만 사용하고 중복 제출을 resetKey 단위로 차단한다.
- result hold는 live freeze와 같은 canonical percent로 생성해 roll-stage가 표시돼도 최소 1000ms 유지한다.
- QA는 실제 제품 rAF data를 관찰해 pointerdown을 발생시키고 180ms 뒤 live freeze, result hold 0/500/900ms, action, sequence, patch, 최종 등급을 함께 검증한다.

### Verification checklist

- [x] 단일 rAF writer와 pointerdown immutable snapshot 구조를 정적 검토했다.
- [x] CSS track animation을 제거하고 `animation: none`, `will-change`, backface visibility 계약을 확인했다.
- [x] `getComputedStyle`, `getAnimations`, `frozenTransform`, `trackOffsetPx`가 입력 컴포넌트의 authoritative 경로에서 제거됐음을 확인했다.
- [x] targeted TypeScript compile (`npx --yes tsc -p tsconfig.check.json`)이 성공했다.
- [x] `node --check tests/mobile/roll-timing-pointer-capture.spec.js`가 성공했다.
- [x] `node --check tests/qa/suite-manifest.mjs`가 성공했다.
- [x] 테스트 파일 → suite manifest → `qa:emulator-suite` runner → `.github/workflows/qa.yml` matrix → Playwright project/testMatch/브라우저/viewport 연결을 검토했다.
- [x] Main Branch QA Run `30226873062`에서 `npm ci`, architecture validation, build, unit, Galaxy timing, Galaxy grade/layout 등은 성공했다.
- [x] Main Branch QA Run `30227987345`의 Safari/Galaxy timing 실패 job과 artifact를 직접 분석했다.
- [x] Main Branch QA Run `30230218854`에서 Safari visible mismatch와 Safari timing이 성공하고 실제 Good/Nice/outside/cancel 테스트가 실행됐음을 확인했다.
- [x] Run `30230218854`의 unit contract 실패와 Galaxy pointercancel phase-wrap 오인 실패를 직접 분석했다.
- [x] Main Branch QA Run `30231031693`에서 build/unit과 모든 기능 QA가 성공하고 Galaxy pointercancel 수정이 실제 실행됐음을 확인했다.
- [x] Run `30231031693`의 유일한 실패가 Safari timing 성능 `252.2s / 250.0s`임을 확인했다.
- [x] 취소 시나리오 방 재사용 수정 Run `30231697755`에서 Safari timing 기능과 250초 성능 예산이 성공했다.
- [x] 최종 제품·QA merge SHA `9e10435337ecc419e7a1059db422cd8053a9533a` 기준 Main Branch QA 전체 success를 확인했다.

### Main Branch QA follow-up - Run 30226873062

- PR #1138 merge SHA `a324b3ded0bd6618182368c22d2c4806ae214cac`의 Main Branch QA에서 제품 build/unit과 Galaxy Chromium timing은 성공했지만 Safari visible mismatch와 Safari timing이 실패했다.
- Safari visible mismatch의 `31.2%` canonical snapshot을 기존 QA가 meter border-box 기준으로 `31.454055...%`로 계산했다. meter의 2px border와 transform 기준인 content-box 차이가 약 `0.254055%`의 결정적 오차를 만들었다.
- 제품 transform 또는 허용 오차를 바꾸지 않고 QA가 `clientLeft`와 `clientWidth`를 사용해 content-box 기준 오브 중심을 측정하도록 수정했다.
- 기존 QA는 result hold를 생성한 뒤 roll-stage를 최대 5초 기다린 다음 0/500/900ms 샘플을 수집해, 1000ms hold가 이미 제거된 상태를 뒤늦게 관찰할 수 있었다. result hold 0/500/900ms를 먼저 샘플링하고 제거 시각을 확인한 뒤 roll-stage 표시를 별도로 확인하도록 변경했다.
- Safari timing 3-worker 실행에서는 30~34%, 41~44%의 좁은 구간을 rAF가 건너뛰었다. timeout을 늘리거나 animation timeline을 조작하지 않고, Nice와 취소 시나리오는 실제 등급 전체의 좌·우 구간을 허용하되 pointerdown 당시 phase 방향을 함께 기록·검증하도록 변경했다.
- exact `safari-visible-mismatch` title과 manifest grep/grepInvert는 유지했고 테스트 삭제·skip 확대·timeout 증가·0.25% 허용 오차 확대·성능 예산 변경을 하지 않았다.

### Main Branch QA follow-up - Run 30227987345

- PR #1140 merge SHA `539f7ab7bdba002c02852f1d67f08850d209f502`의 Main Branch QA에서 build, unit, architecture validation, Online core, Desktop, 일반 Mobile Galaxy는 성공했다. 실패는 `QA Mobile Galaxy timing`, `QA Safari visible mismatch`, `QA Safari timing` 세 timing lane에 한정됐다.
- Safari timing의 Nice·버튼 밖 pointerup·pointercancel은 같은 spec을 3개 WebKit page에서 병렬 실행하면서 모두 목표 rAF snapshot을 찾지 못했다. 비활성 page에서 제품 rAF가 throttling되어 `positionPercent`가 진행하지 않은 것이었다.
- Safari visible mismatch는 테스트의 `waitUntilElapsed()` 자체가 requestAnimationFrame을 기다려 `500ms 관측 시점에 도달하지 못했습니다`로 실패했다. 제품 rAF와 테스트 관측 시계를 wall-clock timer로 분리했다.
- Galaxy timing은 result hold 500ms sample callback이 늦게 실행돼 clone이 이미 제거된 뒤 `clientWidth === 0` 상태를 측정했다. 0ms·500ms·900ms timer를 1000ms 제거 timer보다 먼저 동시에 예약하도록 변경했다.
- `safari-timing` lane의 manifest worker 수 3과 `mobile-webkit-timing` project의 `fullyParallel: true`는 유지했다. `QA_ROLE=safari-timing`일 때 pointer spec 내부 mode만 `default`로 실행해 한 활성 WebKit page에서 Nice·release·cancel을 순차 검증했다.

### Main Branch QA follow-up - Run 30230218854

- PR #1141 merge SHA `d912eadde590db1d45550f978283667845af81db`의 Main Branch QA에서 Safari visible mismatch와 Safari timing은 모두 성공했다.
- Galaxy timing에서는 Good·Nice·버튼 밖 release·Galaxy 추가 반복과 browser isolation 5건이 성공했고 pointercancel 1건만 실패했다.
- pointercancel 실패값은 expected `< 500ms`, received `1999.626ms`였다. 취소 직후 snapshot phase가 pointerdown phase보다 약 `0.374ms` 작게 관측되자 modulo 계산이 이를 거의 한 주기 진행한 것으로 해석했다.
- polling 단계에 assertion과 같은 bounded next-frame 계약 `phaseDeltaMs >= 48 && phaseDeltaMs < 500`을 적용했다.
- Build job은 architecture validation과 build를 통과했지만 unit이 과거 순차 `sampleHold(500)`·`sampleHold(900)` 문자열을 강제했다. unit 계약을 `Promise.all([0, 500, 900].map(sampleAt))`, `rollStageVisibleWhileHeld`, 순차 hold waiter 부재 검증으로 갱신했다.
- 모든 lane 성능은 예산 내였고 workflow 시작부터 summary 예상 완료는 260.2초로 300초 예산을 통과했다.

### Main Branch QA follow-up - Run 30231031693

- PR #1142 merge SHA `7d1801872052feef41dc0aab93f9442defefc9c2`의 Main Branch QA에서 build, unit, architecture validation과 모든 기능 QA가 성공했다.
- Galaxy timing은 browser isolation, Good, Nice, 버튼 밖 release, pointercancel, Galaxy 추가 반복 6건이 모두 성공했다. Safari visible mismatch와 Safari timing도 실제 대상 테스트가 모두 성공했다.
- 기능 matrix는 모두 success였고 workflow 시작부터 summary 예상 완료도 `284.3s / 300.0s`로 성공했다.
- 유일한 차단은 Safari timing 전체 job 시간이 `252.2s / 250.0s`로 2.2초 초과한 성능 실패였다.
- 허용 오차, timeout, worker, browser, manifest, workflow, 성능 예산을 완화하지 않고, 제출하지 않는 outside release와 pointercancel을 같은 방과 활성 버튼 상태에서 연속 실행하도록 변경했다.

### Final verification - Run 30231697755

- PR #1143 merge SHA `9e10435337ecc419e7a1059db422cd8053a9533a`의 Main Branch QA는 attempt 1에서 terminal `success`로 완료됐다.
- Build/unit, architecture validation, Online core, Desktop sequence/regression, Mobile Galaxy, Mobile Galaxy timing, Safari visible mismatch, Safari timing, Firebase emulator QA matrix가 모두 성공했다.
- Safari timing에서 browser isolation, Nice, 통합 outside release + pointercancel 테스트 3건이 실제 실행돼 모두 성공했다. 통합 취소 테스트는 같은 방에서 두 입력의 action/sequence/log 미생성, synthetic click 무시, 버튼 재활성, bounded phase·방향 재개를 모두 검증했다.
- Galaxy timing에서 browser isolation, Good pointerdown, Nice pointerdown, 통합 outside release + pointercancel, Galaxy 추가 반복 5건이 실제 실행돼 모두 성공했다.
- 테스트 실행 시간은 Galaxy timing 80.6초, Safari visible mismatch 57.6초, Safari timing 93.6초였다.
- 전체 job 시간은 Galaxy timing `149.0s / 240.0s`, Safari visible mismatch `145.3s / 195.0s`, Safari timing `176.6s / 250.0s`였고 모두 예산 내였다.
- workflow 시작부터 summary 예상 완료는 `279.3s / 300.0s`로 성공했다.
- 병합 후 3분 30초 시점에는 새 merge SHA 관련 실패가 감지되지 않았고, 7분 시점에는 자동 실패 이슈 #1139가 Run `30231697755` 성공으로 종료된 것을 확인했다.
