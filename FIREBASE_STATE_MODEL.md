# FIREBASE_STATE_MODEL.md

> 문서 상태: 프로젝트 소스용 초기 기준서
> 작성 기준: GitHub `stafor94/Yut`의 `main` `ca676216ef2c25bac940a7cc0e871d9a520ef2c4`
> 기준일: 2026-08-06
> 저장소 반영 검토 기준: GitHub `stafor94/Yut`의 `main` `58f7ee0b252abfda019efe1da4ec53caac8bfde8` / 2026-08-09
> 적용 원칙: 이 문서는 제품 계약과 판단 근거를 제공한다. 코드·테스트·workflow·Issue·PR·Actions의 실제 상태는 항상 최신 GitHub `main`과 현재 작업 브랜치에서 다시 확인한다.

## 1. 목적

이 문서는 Yut 온라인 모드의 Firebase Auth·Firestore 데이터 계약과 상태 일관성 규칙을 정리한다.

목표:

- room, player, seat, game state, sequence의 책임을 구분
- authoritative action이 어떤 데이터를 원자적으로 갱신해야 하는지 명확화
- duplicate, retry, server echo, reconnect의 처리 기준 제공
- QA fixture가 제품 계약을 우회하지 않도록 제한
- 보안·데이터 손실 위험이 있는 변경을 사전에 식별

실제 필드와 path는 변경 작업 시작 시 최신 `roomService.ts`, `roomServiceCore.ts`, `roomFirestore.ts`, Firestore rules에서 다시 확인한다.

## 2. Firebase 사용 범위

- Firebase Auth: 사용자 identity와 action 권한 판단
- Firestore: room summary, player/seat presence, authoritative game state, sequence, idempotency 기록
- QA: 격리된 Auth·Firestore emulator project 사용
- production과 QA config를 혼용하지 않음

## 3. 상위 데이터 구조

대표 root:

```text
rooms/{roomId}
```

현재 코드가 관리·정리 대상으로 인식하는 room 하위 collection:

```text
actions
boardItems
players
rooms
seats
state
sequences
processedActions
turnOrderSubmissions
```

주의:

- 위 목록은 cleanup 대상으로 등록된 subcollection 목록이다.
- 각 collection의 실제 사용 여부, 문서 ID, legacy 여부는 수정 전에 현재 코드를 확인한다.
- 이름만 보고 새로운 write path를 만들지 않는다.

## 4. room summary

경로:

```text
rooms/{roomId}
```

대표 필드 그룹:

### 식별·표시

- `title`
- `hostId`
- `status`: `waiting | playing | finished`
- `maxPlayers`
- `currentPlayers`
- `playerIds`

### 게임 설정

- `playMode`: `individual | team`
- `pieceCount`: `1 | 2 | 3 | 4`
- `itemMode`
- `stackedRollMode`
- `roomConfigVersion`

### 시작 상태

- `startStatus`
- `startRequestId`
- `startRequestVersion`
- `startRequestedAt`
- `startCountdownStartsAt`
- `startCountdownEndsAt`
- `startCountdownUntil`
- `startCancelledAt`

### lifecycle·presence

- `createdAt`
- `lastActivityAt`
- `lastHumanSeenAt`
- `emptySince`
- `deletingAt`
- presence cleanup lease 필드
- QA 식별자 `qaRunId`
- 중복 생성 방지 `createRequestId`

불변식:

- `status`와 `startStatus`가 서로 모순되지 않아야 한다.
- `currentPlayers`는 연결된 인간 참가자 수와 일관되어야 한다.
- 게임 시작에 사용하는 room 설정은 authoritative game state에 snapshot으로 포함되어야 한다.
- 빈 방 삭제와 사용자 입장이 경합할 때 deletion guard를 사용한다.

## 5. players

경로:

```text
rooms/{roomId}/players/{playerId}
```

대표 필드:

- `nickname`
- `ready`
- `color`
- `seatIndex`
- `team`
- `isAI`
- `isSubstitutedByAI`
- `aiDifficulty`
- `isSpectator`
- `joinedAt`
- `lastSeen`
- `enteredGameAt`
- `enteredStartVersion`
- `lastGamePresenceAt`
- `playerId`
- `currentPlayerId`
- `originalPlayerId`
- `presenceEpoch`
- `substitutedAt`
- `restoredAt`

불변식:

- 인간 player, 수동 AI player, 인간 대체 AI를 구분한다.
- authenticated UID가 player ID와 다를 수 있는 대체·복구 경로를 명시적으로 검증한다.
- `lastSeen`은 presence 판단에 사용하므로 server timestamp와 로컬 숫자 timestamp의 용도를 구분한다.
- game 중 player 삭제가 좌석 소유권을 소실시키지 않도록 한다.

## 6. seats

경로:

```text
rooms/{roomId}/seats/{seatId 또는 seatIndex}
```

대표 필드:

- `playerId`
- `originalPlayerId`
- `currentPlayerId`
- `nickname`
- `color`
- `team`
- `seatIndex`
- `label`
- `isHost`
- `aiActive`
- `aiName`
- `isSubstitutedByAI`
- `status`: `human | ai_substitute | disconnected | removed`
- `presenceEpoch`
- `substitutedAt`
- `restoredAt`
- `updatedAt`
- `createdAt`

불변식:

- 좌석은 게임 중 actor identity의 기준이다.
- player 문서가 일시적으로 변경되어도 original/current identity를 통해 복구할 수 있어야 한다.
- coordinator seat는 authoritative game state의 `gameSeats`에 존재해야 한다.
- 수동 AI 좌석 제거와 인간 대체 AI 복구를 동일 로직으로 처리하지 않는다.

## 7. authoritative game state

경로 형식:

```text
rooms/{roomId}/state/{implementation-defined document}
```

문서 ID는 최신 코드에서 직접 확인한다.

대표 상태 그룹:

### 턴과 순서

- `turnIndex`
- `turnOrderIds`
- `initialTurnOrderIds`
- `turnVersion`
- `lastSequence`
- `lastClientMutationId`

### 말과 보드

- `pieces`
- `boardItems`
- `trapNodes`
- `shieldedPieceIds`
- `lastMovedPieceIds`
- `lastMovedSeatId`
- `branchChoice`

### 윷 결과와 연출 상태

- `roll`
- `rollStack`
- `selectedRollStackIndex`
- `rollStackClosed`
- `rollAnimation`
- `rollResultReadyAt`
- `lastRollTimingZone`

### 게임 진행

- `pendingAfterMoveTurnIndex`
- `pendingGoldenYutSelection`
- `pendingTrapPlacement`
- `pendingItemPickup`
- `itemPromptTiming`
- `waitingForPlayersReady`
- `winner`
- `completedSeatIds`
- `rankingSeatIds`
- `gameEndMode`
- `continuationRound`

### effect

- `captureEffect`
- `trapEffect`
- `fallEffect`

### deadline·자동 진행

- `turnDeadlineAt`
- `turnDeadlineKind`
- `turnActionTimeoutCountBySeatId`
- `autoPlayBySeatId`

### coordinator

- `coordinatorSeatId`
- `coordinatorEpoch`
- `coordinatorLeaseExpiresAt`
- `coordinatorLeaseUpdatedAt`

### 게임 설정 snapshot

- `playMode`
- `itemMode`
- `stackedRollMode`
- `pieceCount`
- `gameSeats`
- `startRequestId`
- `startRequestVersion`

불변식:

- `turnVersion`은 상태 변경의 낙관적 동시성 제어에 사용한다.
- `lastSequence`는 마지막으로 반영된 sequence와 일치해야 한다.
- `lastClientMutationId`는 마지막 authoritative mutation과 일치해야 한다.
- deadline kind와 deadline 시각은 현재 pending 단계와 일치해야 한다.
- `gameSeats`는 중복 ID가 없고 coordinator seat를 포함해야 한다.
- state의 게임 설정은 room 설정 변경과 분리된 게임 시작 시점 snapshot이다.

### 빽도 무말 자동 패스와 move readiness

빽도 결과에서 actor의 윷판 위 이동 가능한 말이 0개인 경우에도 자동 패스는 authoritative `move_piece` 처리 경계를 사용한다.

필수 불변식:

- 현재 roll에 대응하는 `rollResultReadyAt` 또는 최신 코드의 동등한 authoritative readiness가 자동 패스 commit의 최소 시작 경계다.
- 빈 `pieceId`로 표현되는 자동 패스는 사용자 수동 말 이동이 아니므로 manual move reservation의 `clientActionStartedAt`을 선점하지 않는다.
- 수동 이동용 시작 시각이 authoritative readiness보다 먼저 기록되어 자동 패스가 reject되는 상태를 만들지 않는다.
- 자동 패스 action은 한 logical identity로 idempotent하게 처리되고 하나의 `move_piece_resolved` sequence로 수렴해야 한다.
- resolved 결과에서 skip을 표현하는 payload가 있다면 `pieceId = ''`, `skipped = true`와 같은 의미가 일관되게 유지되어야 한다. 실제 필드명은 최신 reducer/sequence schema에서 확인한다.
- authoritative 결과는 `turnIndex`를 한 번만 진행시키고 `roll`을 소비하며 실제 말 위치와 `lastMovedPieceIds`를 변경하지 않는다.
- commit callback, state snapshot, sequence subscription/replay, remount가 같은 skip을 다시 소비하지 않는다.

클라이언트의 local piece projection은 사용자-visible 후보 계산에 사용할 수 있지만, authoritative readiness와 다른 시점의 projection만으로 turn advance를 확정하지 않는다.

## 8. actions

대표 action type:

- `roll_yut`
- `move_piece`
- `continue_race`
- `use_item`
- `place_trap`
- `item_pickup_decision`
- `resume_human_control`

공통 구조:

```text
type
actorId
payload
createdAt
processed
```

대표 payload identity:

- `clientActionId`
- timeout 관련 deadline
- coordinator lease token
- piece ID, branch choice, roll stack index
- timing snapshot
- automation source

불변식:

- 동일 logical action은 안정적인 `clientActionId`를 사용한다.
- 권한은 action type과 현재 authoritative state를 함께 보고 판단한다.
- timeout 복구는 현재 actor, stage, deadline과 정확히 일치해야 한다.
- action payload에서 `undefined`는 Firestore 저장 전에 안전하게 정규화한다.

### 빽도 무말 자동 패스 action

자동 패스가 `move_piece`로 표현되는 구현에서는 일반 수동 이동과 구분한다.

```text
type = move_piece
actorId = current authoritative actor
payload.pieceId = ''
payload.clientActionId = stable logical identity
manual move reservation = 없음
```

필수 확인:

- 빈 `pieceId`를 수동 사용자 말 이동으로 분류하지 않는다.
- 동일 자동 패스 요청의 retry/echo는 duplicate로 수렴한다.
- reject가 발생하면 동일 idempotency identity 때문에 영구적으로 턴이 고착되지 않도록 현재 authoritative state와 실패 원인을 확인한다.
- 성공 sequence는 실제 말 이동 없이 roll 소비와 다음 턴 진행만 나타내야 한다.

## 9. sequences

경로:

```text
rooms/{roomId}/sequences/{12자리 zero-padded sequence}
```

문서 ID 예:

```text
000000000001
000000000002
```

대표 필드:

- `sequence`
- `type`
- `actorId`
- `coordinatorSeatId`
- `coordinatorEpoch`
- `payload`
- `schemaVersion`
- `eventSchemaVersion`
- `action`
- `patch`
- `logEntries`
- `stateBefore`
- `stateAfter`
- `expectedPreviousSequence`
- `clientMutationId`
- `clientCreatedAt`
- `createdAt`

대표 sequence type:

- `state_snapshot`
- `game_initialized`
- `turn_order_updated`
- `turn_order_resolved`
- `turn_order_intro_completed`
- `roll_yut`
- `move_piece_resolved`
- `race_continued`
- `item_used`
- `trap_placed`
- `item_pickup_decided`
- `human_control_resumed`
- `game_finished`

불변식:

- sequence 번호는 단조 증가한다.
- 동일 sequence ID에 서로 다른 결과를 덮어쓰지 않는다.
- `clientMutationId`와 action payload identity는 같은 logical action을 가리켜야 한다.
- sequence patch와 최종 state가 일치해야 한다.
- replay는 `afterSequence`보다 큰 항목을 순서대로 적용한다.
- 최근 sequence cache가 state snapshot보다 늦게 준비될 수 있음을 고려한다.

## 10. processedActions

경로:

```text
rooms/{roomId}/processedActions/{firestoreSafeId(clientMutationId)}
```

문서 ID 생성:

- 사람이 읽을 수 있는 prefix
- 안전하지 않은 문자를 `_`로 치환
- 길이 제한
- 원본 ID의 안정 hash 추가

목적:

- 동일 `clientMutationId`의 중복 처리 방지
- commit timeout 후 처리 결과 복구
- retry가 새 action으로 실행되지 않도록 보장

불변식:

- 같은 logical action은 같은 processed action 문서를 조회해야 한다.
- random 또는 현재 시각 기반 identity로 idempotency를 깨지 않는다.
- processed action이 있으면 duplicate 응답으로 수렴한다.
- duplicate 응답에 state payload가 없을 수 있으므로 client는 metadata-only 영수증을 구분한다.

## 11. turnOrderSubmissions

경로:

```text
rooms/{roomId}/turnOrderSubmissions/{roundId}:{seatId}
```

대표 필드:

- `sessionId`
- `roundId`
- `seatId`
- `submissionId`
- `resultName`
- `displayResult`
- `sticks`
- `fallCount`
- `timingZone`
- `source`
- `submittedAt`
- `submittedBy`
- `coordinatorSeatId`
- `coordinatorEpoch`

불변식:

- 한 round와 seat에는 하나의 authoritative submission으로 수렴한다.
- 동일 submission retry는 duplicate로 처리한다.
- coordinator 정보와 현재 lease가 일치해야 한다.
- 결과 표시와 authoritative result가 일치해야 한다.

## 12. transaction 원자성

authoritative action 처리에서 대표적으로 함께 갱신해야 하는 데이터:

```text
현재 state
+ next sequence
+ processedActions identity
+ turnVersion
+ lastSequence
+ lastClientMutationId
```

원자적으로 처리하지 않으면 가능한 실패:

- state는 갱신됐지만 sequence가 없음
- sequence는 생성됐지만 processed action이 없어 retry가 재실행
- processed action은 있지만 state가 이전 상태
- `lastSequence`가 실제 sequence보다 앞섬
- commit callback과 snapshot이 서로 다른 action 결과를 가리킴

새 write를 추가할 때 기존 transaction 경계를 먼저 확인한다.

## 13. snapshot과 sequence 일관성

정상 전달 계약:

```text
sequence N 저장
state.lastSequence = N
client가 recent sequence N을 확보
state snapshot N 전달
sequence replay와 snapshot이 같은 최종 상태로 수렴
```

클라이언트 규칙:

- state snapshot의 `lastSequence`가 아직 cache에 없으면 짧게 전달을 보류한다.
- 초기 state 또는 null state는 즉시 전달할 수 있다.
- subscription teardown에서 room sequence cache를 정리한다.
- metadata-only duplicate ACK로 `lastSequence`를 선점하지 않는다.

## 14. action identity와 alias

### 일반 action

```text
clientActionId = logical action identity
clientMutationId = Firestore idempotency identity
```

가능하면 동일한 logical action을 가리킨다.

### timeout move

```text
local presentation ID = move_piece:...
canonical server ID = timeout:v1:<room>:<actor>:move:<deadline>
```

정상 계약:

- UI는 local ID로 presentation ownership을 확보한다.
- queue 제출 직전 canonical ID로 변환한다.
- canonical ID와 local ID alias를 room 단위 ledger에 저장한다.
- server echo는 local ID로 분류되어 동일 presentation을 재시작하지 않는다.
- lifecycle 경계에서 alias를 정리한다.

## 15. duplicate 결과 계약

대표 status:

- `committed`
- `duplicate`
- `rejected`
- lease mismatch 또는 unavailable 계열

`duplicate`는 두 종류가 있다.

### stateful duplicate

- `stateAfter` 또는 `patch`에 실제 상태 필드가 존재
- local ACK로 소비 가능
- sequence와 fingerprint 정합성 확인 필요

### metadata-only duplicate

- status, sequence, turnVersion 등만 존재
- authoritative state로 적용하지 않음
- apply-wake snapshot 생성 금지
- 실제 sequence subscription/replay에 위임

## 16. 권한 모델

기본 원칙:

- authenticated UID가 actor ID와 같으면 일반 인간 action 가능
- 대체 AI나 수동 AI는 host 또는 유효한 coordinator가 대리 가능
- auto play 상태의 actor action은 허용된 automation source와 coordinator lease가 필요
- `resume_human_control`은 해당 actor 본인이 수행
- coordinator action은 seat ID와 epoch, lease expiry를 검증
- client에서 권한을 숨기는 것만으로 보안을 대신하지 않음

Firestore rules와 transaction 내부 검증을 모두 확인해야 한다.

## 17. timestamp 계약

사용되는 시간 유형:

- `serverTimestamp()`: presence, created/updated metadata
- `Date.now()`: 클라이언트 deadline 계산과 로컬 비교
- authoritative numeric deadline: 모든 클라이언트가 공유하는 상태 전이 기준

주의:

- 같은 invariant에서 state deadline과 action deadline을 별도 `Date.now()` 호출로 만들지 않는다.
- 테스트는 mock clock 또는 하나의 deadline 상수를 공유한다.
- server timestamp와 numeric milliseconds를 비교할 때 명시적으로 변환한다.
- timeout identity에는 현재 호출 시각이 아니라 authoritative deadline을 사용한다.

## 18. presence와 room cleanup

presence 대표 write:

```text
players/{playerId}.lastSeen = serverTimestamp()
rooms/{roomId}.lastHumanSeenAt = serverTimestamp()
rooms/{roomId}.lastActivityAt = serverTimestamp() 또는 numeric timestamp
```

room summary heartbeat는 모든 player heartbeat마다 갱신하지 않고 제한된 주기로 갱신할 수 있다.

cleanup 시 확인:

- 마지막 인간 presence
- room status
- currentPlayers
- createdAt과 max age
- deletion lease 또는 guard
- 게임 중 AI substitute 보존 여부
- pending cleanup queue

## 19. QA emulator 계약

PR/Main browser QA는 production Firebase를 사용하지 않는다.

필수 경로:

```text
write-qa-firebase-env.mjs
→ verify-qa-emulator-config.mjs
→ build:qa
→ firebase emulators:exec
→ qa:emulator-suite
```

각 lane은 고유 project ID와 run ID를 사용한다.

예:

```text
demo-yut-pr-<run>-<attempt>-<lane>
demo-yut-<run>-<attempt>-<lane>
```

QA fixture 규칙:

- production collection을 직접 수정하지 않는다.
- 고유 room title과 QA run ID를 사용한다.
- fixture write도 turnVersion·sequence 계약을 보존한다.
- 테스트 종료와 실패 시 room cleanup을 수행한다.
- cleanup 실패 artifact를 남긴다.
- UI가 제품 action을 수행해야 하는 검증에서 Firestore patch만으로 성공을 만들지 않는다.

## 20. 변경 검토 체크리스트

Firestore 관련 변경 전:

- [ ] 최신 rules 확인
- [ ] 읽기·쓰기 path 확인
- [ ] transaction 경계 확인
- [ ] retry와 duplicate 처리 확인
- [ ] processed action identity 확인
- [ ] state와 sequence 동시 갱신 확인
- [ ] snapshot/replay 소비자 확인
- [ ] reconnect와 teardown 확인
- [ ] QA fixture와 cleanup 확인
- [ ] production/QA config 격리 확인
- [ ] 데이터 손실 또는 권한 확대 위험 확인

## 21. 금지된 변경

- 사용자 승인 없이 collection 구조를 대규모 이전
- 기존 문서를 남긴 채 새 path로 이중 write
- idempotency 문서 없이 retry 가능한 action 추가
- client-only 권한 검사
- metadata-only duplicate에서 synthetic state 생성
- random ID로 timeout action 중복을 회피
- fixture 편의를 위해 production validation 완화
- undefined 필드를 그대로 저장
- cleanup 실패를 무시하고 성공 처리
- current state만 갱신하고 sequence를 누락

## 22. 갱신 규칙

다음 변경 시 이 문서를 갱신한다.

- collection 또는 document path
- room/player/seat 필드
- game state 필드
- action·sequence type
- idempotency identity
- coordinator lease
- presence·cleanup
- Auth 권한
- QA emulator config
- Firestore rules

각 변경에는 migration 필요 여부, backward compatibility, 관련 테스트와 lane을 기록한다.
