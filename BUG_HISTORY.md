# BUG_HISTORY.md

This file records repeated bugs, failed fixes, root causes, and approaches that must not be repeated.

The earlier active history is preserved without modification in [`BUG_HISTORY_BEFORE_2026-08-01_LOCAL_MOVE_OWNERSHIP.md`](./BUG_HISTORY_BEFORE_2026-08-01_LOCAL_MOVE_OWNERSHIP.md).

---

## 2026-08-01 - 온라인 move_piece 로컬 상태 소유권과 server echo 재적용

### Symptom

- 온라인에서 이동 실행 클라이언트가 `n01 → n02 → n03 → n04` 경로를 표시한 뒤 같은 말을 다시 출발 상태나 중간 칸으로 되돌렸다가 이동했다.
- 서버의 `clientMutationId`와 `move_piece_resolved` sequence는 각각 하나여도 commit callback, subscription, replay 또는 apply-wake가 같은 로컬 결과를 화면 상태에 다시 적용할 수 있었다.

### Previous fixes and why they were insufficient

- PR #1304는 stale 자동 이동 callback과 동일 턴의 두 번째 이동 요청을 차단했다. 두 번째 서버 요청은 막았지만 첫 번째 요청의 로컬 결과가 server echo로 다시 적용되는 구조는 남았다.
- PR #1306은 authoritative settlement를 local presentation 완료 뒤로 직렬화했다. 재적용 시점만 늦췄고 동일 로컬 결과가 다시 `pieces`, `roll`, `turnIndex`를 덮는 소유권은 바꾸지 않았다.
- PR #1308은 pending 등록 시 presentation lifecycle을 먼저 선점했다. 시작 경쟁은 줄였지만 server echo의 화면 상태 적용 자체는 유지했다.
- PR #1309는 성공·오류 callback을 presentation settlement 뒤로 직렬화했다. callback 순서는 고정했지만 subscription, sequence replay, apply-wake, 수동 sync와 callback이 동일 로컬 결과를 다시 적용할 수 있었다.
- PR #1310은 shared reducer 결과와 local move ledger를 추가했지만, controller가 lifecycle idle 상태에서 `waitForSettlement()`를 호출하면 이미 완료된 Promise를 받아 reducer 최종 상태를 실제 말 경로보다 먼저 적용할 수 있었다.
- PR #1316은 동일 말의 실제 settlement 예약을 추가했지만 `let resolve = () => undefined`가 `() => undefined`로 추론되어 Promise resolver `() => void` 대입이 build에서 거부됐다. 런타임 로직과 무관한 타입 선언 누락이었다.
- PR #1317은 resolver 타입을 수정해 build와 전체 unit·architecture·대부분의 브라우저 QA를 통과시켰지만, Galaxy timing에서 빠른 ACK의 canonical 경로가 `n04 → n02 → n03 → n04`로 시작했고 기존 디버그 상태에는 top-level `movingPieceId`가 없어 연출 시작 횟수를 관찰하지 못했다.
- PR #1318은 정확히 같은 `pieceId`만 settlement할 수 있게 했지만, 같은 말의 최종 위치 `n04`가 첫 경로 프레임 `n02`보다 먼저 들어오는 경우까지 정상 완료로 인정했다. 말 ID 일치만으로는 경로 완료를 증명하지 못했다.
- PR #1324는 shared reducer의 전체 `pathNodeIds`를 실제로 관찰하기 전에는 settlement하지 않도록 수정해 느린 ACK와 자동 개 이동을 정상화했다. 하지만 빠른 ACK에서는 local move ledger 자체가 생성되기 전에 서버 결과가 도착해 여전히 첫 canonical `n04`가 적용됐다.

### Confirmed root cause

- 온라인 `move_piece`의 실행 클라이언트가 path frame만 재생하고 roll 소비, turn 전환, stack 소비와 최종 pieces 확정을 authoritative 결과에 위임했다.
- pending metadata는 ACK 시 제거되므로 동일 `clientMutationId`를 이후 다시 수신하면 이미 로컬에서 재생한 이동을 remote action으로 오인할 수 있었다.
- 모든 authoritative 적용 경로에 공통 local-echo/remote-action/stale 분류가 없었다.
- Main Branch QA trace에서 서버 ACK와 다음 턴 전환이 완료된 뒤에도 `movingPieceId`가 유지되고 로컬 경로가 진행 중인 상태가 확인됐다. local reducer 계산과 ledger 등록은 성공했지만, idle lifecycle의 settlement Promise가 즉시 완료되어 최종 `pieces`, `roll`, `turnIndex`가 경로 중간에 적용된 것이 직접 원인이었다.
- `GameBoardSection`은 animation queue가 바쁠 때 말 ID가 없는 generic `settle()` callback을 예약한다. 이 이전 callback이 새 이동의 `observe(pieceId)` 뒤 실행되면 현재 presentation을 잘못 완료해 reducer final state를 경로보다 먼저 적용할 수 있었다.
- #1318 병합 후 trace에서는 같은 말의 최종 위치가 `n02`보다 먼저 canonical에 나타났다. 동일 말 여부뿐 아니라 이동 직전 계산된 `pathNodeIds`가 `n02 → n03 → n04` 순서로 실제 관찰됐는지를 settlement 조건으로 확인해야 했다.
- #1324 병합 후 Main Branch QA Run `30728043029`에서는 전체 16개 Galaxy timing 테스트 중 빠른 ACK 1개만 남았다. 서버 move는 로컬 첫 step보다 약 0.1초 먼저 확정됐고, 느린 ACK와 자동 개 이동은 성공했다.
- controller의 `applyAuthoritativeResultSequence()`는 App의 authoritative 적용 Promise가 완료된 뒤에만 `latestSyncedStateRef`를 갱신했다. App이 React state setters를 호출한 뒤 Promise continuation이 실행되기 전에 자동 이동 effect가 시작될 수 있어, controller는 직전 roll 이전 상태로 `prepareLocalMoveOwnership()`를 호출했다. 그 결과 shared reducer가 move를 commit하지 못하고 ledger가 생성되지 않아 빠른 server echo가 remote action으로 적용됐다.

### Required state invariants

- 이동 실행 클라이언트는 서버와 같은 shared game-core reducer로 결과를 한 번 계산하고 local canonical 상태와 presentation을 한 번 완료한다.
- 같은 `clientMutationId`의 서버 결과는 sequence/version, authoritative 기준 상태, pending ACK와 fingerprint만 갱신하며 `pieces`, `roll`, `movingPieceId` 또는 이동·윷 presentation을 다시 변경하지 않는다.
- 다른 플레이어의 새 sequence만 기존 replay 경로로 한 번 표시한다. 이미 적용한 sequence/version은 상태와 presentation 모두 생략한다.
- local move ledger는 pending metadata와 독립적으로 유지하고 presentation 완료, server sequence ACK, fingerprint 일치가 모두 확인된 뒤 정리한다.
- reducer 결과 finalization은 lifecycle이 이미 active인지와 무관하게 ledger가 예약한 동일 piece의 실제 GameBoard 관찰과 settlement 뒤에만 실행한다.
- active local move settlement는 정확히 같은 `pieceId`를 가진 callback만 완료할 수 있다. 이전 queue의 generic settlement나 다른 말 settlement는 현재 waiter를 해제하지 않는다.
- 최종 목적지가 먼저 관찰돼도 이동 직전의 전체 경로가 순서대로 관찰되기 전에는 settlement하지 않는다.
- commit result의 `stateAfter`는 App 적용 Promise를 기다리기 전에 controller authoritative cache에 동기 반영한다. React effect가 즉시 실행돼도 local move reducer는 화면과 같은 최신 roll·turn 상태를 사용해야 한다.
- 서버 거부나 fingerprint 불일치에서만 입력을 잠그고 corrective animation 없이 최신 snapshot을 한 번 hard resync한다.

### Do not try again

- callback 대기, presentation lifecycle 시작 시점 이동, authoritative snapshot 적용 지연 또는 timeout 증가로 같은 local server echo의 재적용을 숨기지 않는다.
- 동일 문제를 자동 이동 차단, `canRequestMove`/`actionReady` 정책 변경, sleep 증가나 assertion 완화로 수정하지 않는다.
- 클라이언트가 보낸 전체 pieces를 서버 authoritative 결과로 신뢰하지 않는다.
- idle lifecycle을 이미 settlement된 것으로 간주해 reducer final state를 실제 `movingPieceId` 종료 전에 적용하지 않는다.
- 말 ID가 없는 오래된 queue settlement로 현재 active move를 완료하지 않는다.
- 같은 말의 최종 위치만 확인하고 중간 경로가 실제로 한 번 진행됐다고 판단하지 않는다.
- React effect 경쟁을 숨기기 위해 자동 이동 delay나 서버 callback delay를 늘리지 않는다. 다음 action이 의존하는 authoritative cache를 Promise continuation 전에 갱신한다.

### Verification checklist

- [x] shared reducer 기반 local move result와 독립 local move ledger 추가
- [x] commit, subscription, replay, apply-wake, manual sync의 local-echo/remote-action/stale 공통 분류 추가
- [x] ACK 전 ledger 유지, stale 재수신, remote replay, mismatch hard resync, room clear 단위 테스트 추가
- [x] 실제 host·guest 2클라이언트의 빠른/느린 ACK와 `n01/off-board` 관찰 Playwright 추가
- [x] ledger 등록 시 idle lifecycle이 동일 piece의 실제 관찰·settlement를 기다리는 단위 회귀 테스트 추가
- [x] 이전 generic settlement가 active piece waiter를 해제하지 않는 단위 회귀 테스트 추가
- [x] 최종 목적지가 먼저 들어온 뒤 `n02 → n03 → n04` 전체 경로를 관찰해야 settlement하는 단위 회귀 테스트 추가
- [x] commit `stateAfter`가 비동기 App 적용 완료 전 controller cache에 동기 반영되는 단위 회귀 테스트 추가
- [ ] Unit tests pass
- [ ] Build succeeds
- [ ] QA architecture validation passes
- [ ] Target Mobile Galaxy Playwright passes
- [ ] Main Branch QA succeeds
