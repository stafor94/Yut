# SYSTEM_FLOW_MAP.md

> 문서 상태: 프로젝트 소스용 초기 기준서
> 작성 기준: GitHub `stafor94/Yut`의 `main` `ca676216ef2c25bac940a7cc0e871d9a520ef2c4`
> 기준일: 2026-08-06
> 저장소 반영 검토 기준: GitHub `stafor94/Yut`의 `main` `58f7ee0b252abfda019efe1da4ec53caac8bfde8` / 2026-08-09
> 적용 원칙: 이 문서는 제품 계약과 판단 근거를 제공한다. 코드·테스트·workflow·Issue·PR·Actions의 실제 상태는 항상 최신 GitHub `main`과 현재 작업 브랜치에서 다시 확인한다.

## 1. 목적

이 문서는 Yut의 사용자 입력이 제품 코드, authoritative reducer, Firestore, sequence replay, 화면 연출을 거치는 흐름을 추적하기 위한 시스템 지도다.

버그 분석 시 다음 순서로 사용한다.

```text
증상
→ 사용자-visible 상태 전이
→ producer
→ action identity
→ authoritative commit
→ state/sequence 저장
→ subscription/replay consumer
→ local presentation
→ 최종 DOM
```

## 2. 상위 구조

```text
src/main.tsx
└─ src/app/App.tsx
   ├─ 화면 상태와 주요 게임 orchestration
   ├─ src/app/controllers/*
   │  └─ authoritative state, sequence, local presentation 조정
   ├─ src/app/hooks/*
   │  └─ timeout, recovery, lifecycle effect
   ├─ src/app/flows/*
   │  └─ action queue, ACK 분류, replay/apply 정책
   ├─ src/features/room/services/*
   │  ├─ room 생성·입장·presence·정리
   │  ├─ authoritative action commit
   │  ├─ reducer와 Firestore transaction
   │  └─ coordinator·deadline·identity 정책
   ├─ src/game-core/*
   │  └─ 게임 규칙과 순수 계산
   └─ Firebase Auth / Firestore
      ├─ rooms
      ├─ players / seats
      ├─ state
      ├─ sequences
      ├─ processedActions
      └─ turnOrderSubmissions
```

## 3. 책임 경계

| 영역 | 대표 경로 | 책임 |
|---|---|---|
| 앱 진입 | `src/main.tsx` | React 앱 초기화 |
| 제품 orchestration | `src/app/App.tsx` | 화면 단계, action 시작, 주요 recovery 연결 |
| authoritative 동기화 | `src/app/controllers/useAuthoritativeGameSyncController.ts` | commit 결과, snapshot, sequence, local echo 조정 |
| action queue | `src/app/flows/authoritativeGameSyncFlow.ts` | authoritative commit 직렬화와 apply 직렬화 |
| local ACK | `src/app/flows/localMoveCommitAck.ts` | stateful/stateless duplicate 분류와 pending 해제 조건 |
| apply wake | `src/app/flows/authoritativeApplyWakeFlow.ts` | 실제 state payload가 있는 응답만 snapshot으로 구성 |
| local presentation | `src/app/flows/localMovePresentationLifecycle.ts` | 말 이동 연출 lifecycle |
| timeout recovery | `src/app/hooks/useStackedRollTimeoutRecovery.ts` | roll/move deadline 복구와 coordinator action |
| timeout identity | `src/features/room/services/timeoutRollActionIdentity.ts` | canonical timeout ID와 local alias |
| timeout resolver | `src/features/room/services/timeoutResolvers.ts` | deterministic timeout 결과와 action key |
| room façade | `src/features/room/services/roomService.ts` | room lifecycle, state/sequence subscription, commit wrapper |
| Firestore core | `src/features/room/services/roomServiceCore.ts` | transaction, reducer, state/sequence 저장 |
| Firestore path | `src/features/room/services/roomFirestore.ts` | subcollection 목록과 안전한 문서 ID |
| reducer | `src/features/room/services/roomAuthoritativeReducer.ts` | action 검증과 authoritative patch 산출 |
| 게임 규칙 | `src/game-core/*` | 윷 결과, 이동 경로, 보드·아이템 규칙 |
| QA manifest | `tests/qa/suite-manifest.mjs` | spec과 QA lane 연결 |

경로가 최신 `main`에서 이동하거나 이름이 바뀌면 이 표를 먼저 갱신한다.

## 4. 일반 온라인 action 흐름

```text
1. 사용자 입력
2. App 또는 container가 GameAction 생성
3. clientActionId 부여
4. local pending/ledger 등록
5. 필요 시 local presentation 시작
6. authoritative action queue에 제출
7. roomService.commitAuthoritativeGameAction()
8. Firestore transaction에서 권한·turnVersion·deadline·identity 검증
9. roomAuthoritativeReducer가 patch와 sequence 생성
10. state, sequence, processedActions 원자적 갱신
11. commit result 반환
12. state snapshot 또는 sequence subscription 수신
13. controller가 local echo / stale / remote 적용 분류
14. local presentation settlement와 authoritative 최종 상태 정합
15. pending 해제
```

### 4.1 action 생성 시 확인

- actor ID가 현재 authoritative actor와 일치하는가?
- action type이 현재 pending stage에서 허용되는가?
- `clientActionId`가 deterministic 또는 재사용 가능한가?
- timeout action이면 authoritative deadline을 사용했는가?
- UI action과 coordinator action이 같은 사건을 서로 다른 ID로 만들지 않는가?
- presentation owner를 action 제출 전에 등록해야 하는가?

### 4.2 commit 시 확인

- room ID가 현재 active room과 일치하는가?
- authenticated user가 actor를 대리할 권한이 있는가?
- coordinator lease와 epoch가 유효한가?
- expected previous sequence 또는 turn version이 맞는가?
- processed action 문서가 이미 존재하는가?
- duplicate 결과에 실제 state payload가 포함되는가, metadata만 포함되는가?

## 5. state와 sequence 전달 흐름

`roomService.subscribeGameState()`는 최신 state snapshot을 전달할 때 필요한 recent sequence가 cache에 준비됐는지 확인한다.

```text
rooms/{roomId}/sequences 최신 항목 구독
             │
             ├─ recent sequence cache 갱신
             │
rooms/{roomId}/state 구독
             │
             └─ state.lastSequence가 cache에 있으면 전달
                없으면 짧은 fallback flush를 예약
```

핵심 목적:

- state snapshot이 sequence보다 먼저 도착해 action 연출·로그를 건너뛰는 문제 완화
- 재접속 시 최근 sequence replay 가능
- 동일 sequence의 중복 적용 방지

분석 시 확인:

- `pendingState`
- `lastSequence`
- recent sequence cache
- `deliveredInitialState`
- subscription teardown
- room 변경 시 cache 정리

## 6. local move presentation 흐름

```text
move_piece UI 입력
→ local action identity 생성
→ local move ledger 등록
→ movePiece() presentation 시작
→ authoritative commit
→ ACK / sequence / snapshot 도착
→ local echo이면 presentation 소유권 유지
→ 경로 완료 + authoritative fingerprint 일치
→ pending 해제
→ 다음 단계 노출
```

필수 불변식:

- ledger 등록은 빠른 ACK보다 늦어서는 안 된다.
- pending 해제는 ACK 수신만으로 결정하지 않는다.
- reducer final `pieces`가 presentation 경로 중간에 화면을 덮지 않는다.
- 같은 `pieceId`라는 사실만으로 경로 완료를 판단하지 않는다.
- 필요한 경우 전체 경로와 최종 노드 관찰을 settlement 조건으로 사용한다.

## 6.1 빽도 무말 자동 패스 흐름

```text
roll_yut authoritative commit
→ 빽도 결과와 현재 actor 확정
→ roll presentation / authoritative move readiness 경계
→ 최신 authoritative pieces에서 actor의 합법적 빽도 이동 후보 확인
→ 후보 0개
→ 사용자 move control은 비활성 유지
→ 빈 pieceId의 자동 pass action을 한 logical identity로 제출
→ manual move reservation은 생성하지 않음
→ reducer가 skip으로 resolve
→ state: roll = null, turnIndex = next, pieces unchanged
→ move_piece_resolved sequence 1개
→ commit/snapshot/sequence/replay consumer가 같은 identity로 수렴
→ 양 클라이언트 pending 0, 다음 actor input 가능
```

분석 포인트:

- 자동 패스를 local `canSelectPiece()`만으로 authoritative readiness 이전에 제출하지 않았는가?
- 빈 `pieceId` action이 수동 말 이동으로 분류되어 `clientActionStartedAt`을 예약하지 않았는가?
- 같은 auto-pass identity가 commit callback과 subscription에서 두 번 소비되지 않았는가?
- `turnIndex`가 정확히 한 번 증가했는가?
- `roll`이 소비됐고 실제 `pieces`, `lastMovedPieceIds`, capture 데이터가 변하지 않았는가?
- reload/remount 후에도 pass sequence 수가 1개인가?
- 실행자와 관찰자에서 server/debug/DOM 다음 턴이 일치하는가?

## 7. timeout move 흐름

### 7.1 정상 경로

```text
authoritative state
  turnDeadlineKind = move
  turnDeadlineAt = D
       │
       ├─ UI deadline callback
       │   local ID = move_piece:...
       │   deadlineAutoSubmitted = true
       │   autoSubmittedDeadlineAt = D
       │
       ├─ stalled-turn recovery
       │
       └─ coordinator recovery
            canonical ID = timeout:v1:<room>:<actor>:move:<D>

queue 제출 직전:
local UI action ID → canonical timeout ID로 정규화
canonical ID ↔ local presentation ID alias 등록
```

결과:

- Firestore에는 canonical timeout identity가 사용된다.
- 실행 클라이언트의 최초 presentation은 local ID로 계속 소유한다.
- commit/subscription/replay에서 canonical ID가 돌아오면 local ID로 alias한다.
- 하나의 timeout 사건은 하나의 sequence와 하나의 presentation으로 수렴한다.

### 7.2 분석 포인트

- UI action에 `deadlineAutoSubmitted === true`인가?
- `autoSubmittedDeadlineAt`이 현재 `turnDeadlineAt`과 일치하는가?
- queue 이전에는 local ID, commit된 action에는 canonical ID가 있는가?
- alias ledger가 room lifecycle 전에 정리되지 않았는가?
- sequence의 `clientMutationId`와 action payload의 ID가 canonical로 일치하는가?
- controller 분류 후 local ledger lookup은 alias된 ID로 수행되는가?

## 8. metadata-only duplicate ACK 흐름

발생 예:

```text
1. donor/coordinator가 canonical timeout action을 먼저 commit
2. primary UI가 같은 canonical action을 commit
3. Firestore가 duplicate 영수증 반환
4. 응답에는 status, sequence, turnVersion만 있고 stateAfter/patch 없음
```

정상 처리:

```text
commit result
→ classifyLocalMoveCommitAck()
→ stateless-duplicate
→ state/cursor 적용 안 함
→ apply-wake snapshot 생성 안 함
→ Firestore Listen 정상 수신
→ 실제 move_piece_resolved sequence 적용
→ presentation과 authoritative 상태 정합
```

오류 패턴:

```text
metadata-only duplicate
→ lastSequence 선점
→ 실제 sequence를 stale로 분류
→ local presentation과 server state 충돌
```

## 9. replay와 재접속 흐름

```text
페이지 reload 또는 재접속
→ activeRoomId/player identity 복구
→ current authoritative state 구독
→ afterSequence 기준 sequence 조회
→ recent cache 또는 Firestore replay
→ sequence 순서 적용
→ 화면 snapshot 동기화
→ unresolved local presentation/ledger 정리 판단
```

실제 lifecycle 경계:

- room ID 변경
- 방 이탈
- 새 게임 시작
- 게임 완전 종료
- 명시적 teardown

실제 경계가 아닌 것:

- component rerender
- 동일 room snapshot echo
- commit callback
- 일시적인 listener 재호출

## 10. 게임 시작 흐름

```text
대기실 player/seat snapshot
→ 방장 start request
→ startRequestId / startRequestVersion
→ countdown 시각 확정
→ 모든 필수 player/seat snapshot 확인
→ buildPreparedRoomGameState()
→ initializeGameState()
→ authoritative game state와 first sequence 생성
→ 각 클라이언트가 동일 start version으로 진입
```

분석 시 확인:

- room status와 `startStatus`
- `startRequestId`
- `startRequestVersion`
- countdown start/end
- players와 seats의 완전성
- host와 coordinator seat
- 재접속 클라이언트의 entered version

불완전한 player snapshot으로 게임을 시작하지 않는다.

## 11. coordinator 흐름

```text
현재 game state
→ coordinatorSeatId / coordinatorEpoch / lease expiry
→ coordinator claim 또는 갱신
→ AI·timeout action 생성
→ action payload에 lease token
→ transaction에서 현재 lease와 비교
→ 유효하면 commit, 아니면 reject
```

확인 항목:

- coordinator seat가 실제 `gameSeats`에 존재하는가?
- lease expiry가 지나지 않았는가?
- action의 epoch가 현재 epoch와 같은가?
- 자동 action source가 허용된 값인가?
- 사용자 입력과 coordinator 입력이 동일 canonical ID로 수렴하는가?

## 12. room lifecycle 흐름

### 12.1 생성

```text
createRoom()
→ createRoomSafely()
→ room summary 생성
→ host player/seat 저장
→ 로컬 activeRoomId/host 상태 설정
→ waiting room 진입
```

### 12.2 입장

```text
joinRoom()
→ joinRoomSafely()
→ player 저장
→ room currentPlayers/lastActivityAt 갱신
→ 다른 활성 방의 중복 membership 정리
```

### 12.3 presence

```text
heartbeatRoomPlayer()
→ players/{playerId}.lastSeen 갱신
→ 일정 주기마다 room lastHumanSeenAt/lastActivityAt 갱신
```

### 12.4 이탈·AI 대체

```text
human disconnect/leave
→ playing 여부와 seat 상태 확인
→ 필요 시 동일 seat를 AI substitute로 보존
→ room/player/seat 원자적 갱신
→ cleanup 실패 시 pending cleanup queue
```

### 12.5 삭제

```text
빈 방/완료 방/오래된 방 후보
→ deletion guard
→ room subcollection batch 삭제
→ room root 삭제
```

## 13. Firestore write 경계

한 authoritative action에서 함께 정합성을 유지해야 하는 대표 항목:

- current state
- next sequence
- processed action identity
- turn version
- last sequence
- last client mutation ID
- room activity metadata

서로 다른 transaction 또는 비동기 callback으로 분리할 경우 중간 실패·재시도·duplicate 처리 위험을 분석한다.

## 14. 디버깅 추적표

버그별로 다음 표를 채운다.

| 단계 | 확인 값 | 실제 값 |
|---|---|---|
| 사용자 입력 | action type, actor, piece, roll | |
| local identity | `clientActionId` | |
| canonical identity | timeout key 또는 동일 ID | |
| pending 등록 | ledger key, 등록 시각 | |
| commit | status, sequence, state payload 유무 | |
| Firestore sequence | type, action ID, patch | |
| state snapshot | lastSequence, turnVersion | |
| controller 분류 | local-echo/stale/remote | |
| presentation | 시작 횟수, node path, settlement | |
| 최종 상태 | server/debug/DOM | |
| 다음 단계 | 다음 턴 또는 input 가능 | |

## 15. 변경 영향 조사

공통 helper, 상수, fixture 또는 flow를 바꿀 때 다음 소비자를 조사한다.

```bash
rg "<함수명|상수명|필드명>" src tests .github
```

최소 확인 범위:

- 제품 producer
- 직접 consumer
- sequence/replay consumer
- teardown
- unit test
- Playwright fixture
- QA manifest
- PR workflow
- Main QA workflow

## 16. 금지된 구조적 우회

- duplicate 처리 문제를 presentation timeout 증가로 숨기기
- state/sequence 순서 문제를 listener 추가로 덮기
- 동일 action에 새 random ID를 매번 생성하기
- 현재 Run 상태를 보기 위한 workflow·PR·Issue 만들기
- fixture가 제품 상태 전이를 우회하도록 직접 DOM 조작하기
- 제품 코드와 QA helper의 책임을 한 파일에 혼합하기
- 실제 state payload가 없는 ACK에서 synthetic patch 만들기

## 17. 갱신 규칙

다음 변경이 발생하면 관련 흐름을 갱신한다.

- action type 또는 sequence type 추가
- Firestore path 변경
- authoritative reducer 계약 변경
- state/sequence 전달 순서 변경
- local presentation ownership 변경
- timeout identity 변경
- coordinator lease 변경
- room lifecycle 또는 cleanup 변경
- QA fixture가 새로운 내부 hook을 사용할 때

각 갱신에는 관련 PR, merge SHA, 테스트와 QA lane을 기록한다.
