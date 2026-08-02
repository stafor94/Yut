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
- PR #1316은 동일 말의 실제 settlement 예약을 추가했지만 Promise resolver 타입 선언 누락으로 build가 중단됐다.
- PR #1317은 resolver 타입을 수정했지만 Galaxy timing에서 빠른 ACK의 canonical 경로가 `n04 → n02 → n03 → n04`로 시작했다.
- PR #1318은 정확히 같은 `pieceId`만 settlement할 수 있게 했지만 말 ID 일치만으로는 경로 완료를 증명하지 못했다.
- PR #1324는 `n02 → n03 → n04` 전체 경로 관찰을 settlement 조건으로 추가해 느린 ACK와 자동 이동을 통과시켰다.
- PR #1326은 synced state에 roll이 아직 없을 때 표준 move action identity에서 roll을 복구해 ledger 준비 범위를 넓혔다.
- PR #1327은 #1326의 optional config TypeScript narrowing 오류를 수정했다.
- PR #1328은 같은 action key를 실제 presenting 중인 결과도 local echo로 처리했지만 빠른 ACK에서 reducer final `pieces`가 여전히 로컬 경로보다 먼저 화면 상태에 들어갈 수 있었다.
- PR #1329는 active ledger 정리 뒤 동일 mutation을 tombstone으로 계속 차단하려 했다. 기존 sequence-first 계약을 깨뜨려 unit, Online core 재입장, Galaxy 제한시간 이동을 회귀시켰고 빠른 ACK도 해결하지 못했다.
- PR #1330은 reducer final state의 `pieces`를 local settlement display spread에서 제외했다. settlement 자체의 조기 덮어쓰기는 막았지만 `App.tsx`의 commit callback은 controller가 반환한 local-echo 적용 래퍼를 사용하지 않고 기존 `applyAuthoritativeResultSequence()`를 직접 호출해 `stateAfter.pieces`를 다시 적용했다.

### Confirmed root cause

- 온라인 `move_piece`의 실행 클라이언트가 로컬 `movePiece()`로 `pieces` 경로를 직접 재생하면서, controller도 shared reducer의 `finalState` 전체를 화면 snapshot으로 spread 적용했다.
- shared reducer의 `finalState.pieces`는 fingerprint와 서버 결과 비교에는 필요하지만 실행 클라이언트 화면에 다시 적용하면 로컬 경로 소유권과 충돌한다.
- 빠른 ACK에서는 reducer final 위치 `n04`가 로컬 첫 프레임보다 먼저 또는 중간에 화면 canonical 상태로 들어가 `n04 → n02 → n03 → n04` 또는 `n02 → n04 → n03 → n04`가 발생했다.
- controller의 subscription, replay, apply-wake에는 local echo 분류가 있었지만, `enqueueAuthoritativeGameAction()`이 성공 결과를 consumer callback에 그대로 넘겼고 consumer는 원본 `applyAuthoritativeResultSequence()`로 `stateAfter.pieces`를 적용했다.
- active ledger 정리 후 delivery는 기존 sequence/subscription 파이프라인에 위임해야 하며 mutation tombstone으로 장기간 차단하면 정상적인 이후 상태 전파와 재입장을 막는다.

### Required state invariants

- 이동 실행 클라이언트는 로컬 `movePiece()`가 `pieces`, `movingPieceId`, 이동 경로 presentation을 한 번만 소유한다.
- shared reducer final state는 roll 소비, turn 전환, stack, item, 로그와 fingerprint 검증에 사용한다.
- shared reducer의 final `pieces`는 ledger와 fingerprint 내부에는 보존하되 실행 클라이언트 화면에 spread 적용하지 않는다.
- 같은 `clientMutationId`의 성공 commit 결과는 controller가 consumer callback 전에 ACK로 소비하고 sequence/version, authoritative 기준 상태, pending ACK와 fingerprint만 갱신한다.
- 같은 `clientMutationId`의 서버 snapshot은 active ledger 또는 같은 presenting action에서 sequence/version, authoritative 기준 상태, pending ACK와 fingerprint만 갱신하고 로컬 말 경로를 다시 적용하지 않는다.
- active ledger가 정상 정리된 뒤의 delivery는 기존 sequence-first subscription/replay 정책에 위임한다.
- 다른 플레이어의 새 sequence는 기존 replay 경로로 한 번 표시한다.
- 서버 거부나 fingerprint 불일치에서만 입력을 잠그고 corrective animation 없이 최신 snapshot을 한 번 hard resync한다.

### Do not try again

- callback 대기, presentation lifecycle 시작 시점 이동, authoritative snapshot 적용 지연 또는 timeout 증가로 재적용을 숨기지 않는다.
- 자동 이동 차단, `canRequestMove`/`actionReady` 정책 변경, sleep 증가나 assertion 완화로 수정하지 않는다.
- 클라이언트가 보낸 전체 pieces를 서버 authoritative 결과로 신뢰하지 않는다.
- active ledger 정리 뒤 동일 mutation ID를 장기 tombstone으로 유지해 정상 sequence/stateVersion 전파를 막지 않는다.
- shared reducer final `pieces`를 실행 클라이언트 화면 snapshot에 다시 spread 적용하지 않는다.
- local move 성공 commit 결과를 원본 consumer apply callback에 다시 전달하지 않는다.

### Verification checklist

- [x] shared reducer 기반 local move result와 독립 local move ledger 추가
- [x] commit, subscription, replay, apply-wake, manual sync의 local-echo/remote-action 공통 분류 추가
- [x] ACK 전 ledger 유지, remote replay, mismatch hard resync, room clear 단위 테스트 추가
- [x] 실제 host·guest 2클라이언트의 빠른/느린 ACK와 `n01/off-board` 관찰 Playwright 추가
- [x] 동일 piece와 전체 `n02 → n03 → n04` 경로 완료 뒤 settlement하는 단위 회귀 테스트 추가
- [x] synced roll이 늦은 빠른 ACK 실행 클라이언트에서도 action identity로 local move ownership을 준비하는 단위 회귀 테스트 추가
- [x] ledger가 없어도 동일 action key를 실제 presenting 중인 결과를 local echo로 분류하는 단위 회귀 테스트 추가
- [x] reducer final pieces는 fingerprint 내부에 보존하지만 화면 적용 spread에서는 제외하는 단위 회귀 테스트 추가
- [x] 실행 클라이언트가 소유한 성공 commit 결과만 controller에서 ACK로 소비하는 단위 회귀 테스트 추가
- [ ] Unit tests pass
- [ ] Build succeeds
- [ ] QA architecture validation passes
- [ ] Target Mobile Galaxy Playwright passes
- [ ] Main Branch QA succeeds
