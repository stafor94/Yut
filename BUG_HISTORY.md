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

### Confirmed root cause

- 온라인 `move_piece`의 실행 클라이언트가 path frame만 재생하고 roll 소비, turn 전환, stack 소비와 최종 pieces 확정을 authoritative 결과에 위임했다.
- pending metadata는 ACK 시 제거되므로 동일 `clientMutationId`를 이후 다시 수신하면 이미 로컬에서 재생한 이동을 remote action으로 오인할 수 있었다.
- 모든 authoritative 적용 경로에 공통 local-echo/remote-action/stale 분류가 없었다.

### Required state invariants

- 이동 실행 클라이언트는 서버와 같은 shared game-core reducer로 결과를 한 번 계산하고 local canonical 상태와 presentation을 한 번 완료한다.
- 같은 `clientMutationId`의 서버 결과는 sequence/version, authoritative 기준 상태, pending ACK와 fingerprint만 갱신하며 `pieces`, `roll`, `movingPieceId` 또는 이동·윷 presentation을 다시 변경하지 않는다.
- 다른 플레이어의 새 sequence만 기존 replay 경로로 한 번 표시한다. 이미 적용한 sequence/version은 상태와 presentation 모두 생략한다.
- local move ledger는 pending metadata와 독립적으로 유지하고 presentation 완료, server sequence ACK, fingerprint 일치가 모두 확인된 뒤 정리한다.
- 서버 거부나 fingerprint 불일치에서만 입력을 잠그고 corrective animation 없이 최신 snapshot을 한 번 hard resync한다.

### Do not try again

- callback 대기, presentation lifecycle 시작 시점 이동, authoritative snapshot 적용 지연 또는 timeout 증가로 같은 local server echo의 재적용을 숨기지 않는다.
- 동일 문제를 자동 이동 차단, `canRequestMove`/`actionReady` 정책 변경, sleep 증가나 assertion 완화로 수정하지 않는다.
- 클라이언트가 보낸 전체 pieces를 서버 authoritative 결과로 신뢰하지 않는다.

### Verification checklist

- [x] shared reducer 기반 local move result와 독립 local move ledger 추가
- [x] commit, subscription, replay, apply-wake, manual sync의 local-echo/remote-action/stale 공통 분류 추가
- [x] ACK 전 ledger 유지, stale 재수신, remote replay, mismatch hard resync, room clear 단위 테스트 추가
- [x] 실제 host·guest 2클라이언트의 빠른/느린 ACK와 `n01/off-board` 관찰 Playwright 추가
- [ ] Unit tests pass
- [ ] Build succeeds
- [ ] QA architecture validation passes
- [ ] Target Mobile Galaxy Playwright passes
- [ ] Main Branch QA succeeds
