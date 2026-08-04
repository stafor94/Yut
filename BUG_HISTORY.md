# BUG_HISTORY.md

This file records repeated bugs, failed fixes, root causes, and approaches that must not be repeated.

The earlier active history is preserved without modification in [`BUG_HISTORY_BEFORE_2026-08-01_LOCAL_MOVE_OWNERSHIP.md`](./BUG_HISTORY_BEFORE_2026-08-01_LOCAL_MOVE_OWNERSHIP.md).

---

## 2026-08-04 - 요청 오해, 반복 조회와 대체 도구 전환 루프

### Symptom

- 사용자가 과거 작업 실패를 지적하거나 개선책을 요구했는데, 이전 미완료 PR 작업을 다시 시작했다.
- 사용자가 현재 요청은 수정 지시가 아니라고 정정한 뒤에도 GitHub 스킬과 도구를 계속 조회했다.
- 조회나 mutation이 실패하면 실제 오류를 분류하기보다 권한·환경 제약을 추측하거나 다른 방식으로 다시 시도하겠다는 설명을 반복했다.
- 이미 확인한 저장소, PR, 승인과 계획을 다시 조회·질문하면서 실제 완료보다 준비와 설명이 길어졌다.

### Failed operating assumptions

- 이전 작업이 미완료이면 현재 메시지와 관계없이 계속 진행해도 된다고 잘못 판단했다.
- 도구를 더 많이 호출하면 진전이 생긴다고 보고, 현재 요청의 목적과 필요한 단일 정보를 먼저 고정하지 않았다.
- 한 경로가 실패하면 원인 분석 전에 다른 connector, API 또는 조회 방식으로 전환했다.
- “다른 방식으로 시도하겠다”는 보고 자체를 진행으로 취급했다.
- 사용자 승인과 명시된 수정 방향을 세션 또는 도구 전환 뒤 다시 확인해야 한다고 잘못 판단했다.

### Confirmed root cause

- 현재 사용자 메시지를 작업 상태보다 우선하지 않았고, 질문·항의·회고와 실제 저장소 mutation 요청을 구분하지 않았다.
- 실패를 인증·입력·리소스·기능 미지원·일시적 오류·제품/CI 실패로 분류하는 단계가 없었다.
- 저장소, branch, PR, SHA, Run 등 이미 확정된 식별자를 작업 상태로 유지하지 않아 같은 조회를 반복했다.
- 도구 사용과 설명을 산출물로 착각해 실제 수정, 검증, terminal 상태 확인과 완료 판정이 뒤로 밀렸다.

### Required operating invariants

- 현재 사용자 메시지가 과거 대화의 미완료 작업보다 우선한다.
- 질문·항의·회고·정리 요청에는 저장소 mutation을 수행하지 않는다.
- 같은 범위의 승인은 보존하며 범위 확대나 강제 중단선이 없는 한 재요청하지 않는다.
- 도구 실패 후에는 원인을 분류하고 실패한 기능만 대체한다.
- 이미 확인한 저장소, branch, PR, SHA, Run, Issue는 재사용한다.
- 다른 도구는 부족한 단일 정보를 제공할 근거가 있을 때만 사용한다.
- 진행 보고는 실제 조회 결과, diff, commit, PR, Check 또는 Run 상태 변화가 생겼을 때만 한다.
- 문서 전용 작업은 문서 변경과 수동 diff 검토로 범위를 제한하며 제품 코드·테스트·workflow를 추가하지 않는다.

### Do not try again

- 현재 메시지와 무관한 이전 작업을 자동 재개하지 않는다.
- 사용자가 작업 오해를 정정한 뒤 기존 도구 호출을 계속하지 않는다.
- 실제 권한 오류를 확인하기 전에 “권한이 없어서 불가능하다”고 단정하지 않는다.
- 같은 상태를 connector, CLI, API, 임시 workflow, Issue, 대체 PR로 반복 조회하지 않는다.
- 조회 한계 때문에 새 branch·PR·Issue·workflow를 만들지 않는다.
- 같은 승인이나 계획을 다시 요구하지 않는다.
- 실행 결과 없이 “다른 방식으로 시도하겠다”고 보고하지 않는다.

### Documentation promotion

- `AGENTS.md`: 현재 요청 우선, 승인 보존, 반복 조회·실행 없는 대체 시도 금지, 문서 전용 범위 규칙으로 승격했다.
- `DEVELOPMENT_PLAYBOOK.md`: 요청 분류, 도구 실패 분류표, 문서 전용 검증, 중복 branch·PR 금지 절차로 승격했다.

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
- PR #1331은 실행 클라이언트의 성공 commit 결과를 controller에서 ACK로 소비해 `stateAfter.pieces` 재적용은 막았다. 그러나 ACK 수신 즉시 pending action을 해제해 local presentation이 roll 소비와 turn 전환을 적용하기 전에 기존 `걸`이 다시 action-ready가 되었고 두 번째 `move_piece` mutation이 생성됐다.

### Confirmed root cause

- 온라인 `move_piece`의 실행 클라이언트가 로컬 `movePiece()`로 `pieces` 경로를 직접 재생하면서, controller도 shared reducer의 `finalState` 전체를 화면 snapshot으로 spread 적용했다.
- shared reducer의 `finalState.pieces`는 fingerprint와 서버 결과 비교에는 필요하지만 실행 클라이언트 화면에 다시 적용하면 로컬 경로 소유권과 충돌한다.
- 빠른 ACK에서는 reducer final 위치 `n04`가 로컬 첫 프레임보다 먼저 또는 중간에 화면 canonical 상태로 들어가 `n04 → n02 → n03 → n04` 또는 `n02 → n04 → n03 → n04`가 발생했다.
- controller의 subscription, replay, apply-wake에는 local echo 분류가 있었지만, `enqueueAuthoritativeGameAction()`이 성공 결과를 consumer callback에 그대로 넘겼고 consumer는 원본 `applyAuthoritativeResultSequence()`로 `stateAfter.pieces`를 적용했다.
- 성공 ACK를 소비한 뒤 pending action을 presentation 완료 전에 제거하면 `roll`, `turnIndex` 등 reducer final non-piece state가 아직 적용되지 않은 동안 같은 roll의 자동 이동 guard가 사라져 두 번째 이동 요청이 가능해진다.
- active ledger 정리 후 delivery는 기존 sequence/subscription 파이프라인에 위임해야 하며 mutation tombstone으로 장기간 차단하면 정상적인 이후 상태 전파와 재입장을 막는다.

### Required state invariants

- 이동 실행 클라이언트는 로컬 `movePiece()`가 `pieces`, `movingPieceId`, 이동 경로 presentation을 한 번만 소유한다.
- shared reducer final state는 roll 소비, turn 전환, stack, item, 로그와 fingerprint 검증에 사용한다.
- shared reducer의 final `pieces`는 ledger와 fingerprint 내부에는 보존하되 실행 클라이언트 화면에 spread 적용하지 않는다.
- 같은 `clientMutationId`의 성공 commit 결과는 controller가 consumer callback 전에 ACK로 소비하고 sequence/version, authoritative 기준 상태와 fingerprint만 갱신한다.
- 같은 `clientMutationId`의 서버 snapshot은 active ledger 또는 같은 presenting action에서 sequence/version, authoritative 기준 상태와 fingerprint만 갱신하고 로컬 말 경로를 다시 적용하지 않는다.
- pending action은 local presentation 완료, 서버 sequence ACK, fingerprint 일치가 모두 확인된 뒤에만 해제한다.
- 빠른 ACK에서는 final non-piece state를 적용한 뒤 pending을 해제하고, 느린 ACK에서는 presentation 완료 뒤에도 서버 검증 전까지 pending을 유지한다.
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
- server ACK 수신만으로 local move pending을 즉시 해제하지 않는다.

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
- [x] presentation, sequence ACK, fingerprint 일치가 모두 끝난 뒤 pending을 해제하는 단위 회귀 테스트 추가
- [ ] Unit tests pass
- [ ] Build succeeds
- [ ] QA architecture validation passes
- [ ] Target Mobile Galaxy Playwright passes
- [ ] Main Branch QA succeeds
