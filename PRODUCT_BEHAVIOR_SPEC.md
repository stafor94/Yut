# PRODUCT_BEHAVIOR_SPEC.md

> 문서 상태: 프로젝트 소스용 초기 기준서
> 작성 기준: GitHub `stafor94/Yut`의 `main` `ca676216ef2c25bac940a7cc0e871d9a520ef2c4`
> 기준일: 2026-08-06
> 저장소 반영 검토 기준: GitHub `stafor94/Yut`의 `main` `58f7ee0b252abfda019efe1da4ec53caac8bfde8` / 2026-08-09
> 적용 원칙: 이 문서는 제품 계약과 판단 근거를 제공한다. 코드·테스트·workflow·Issue·PR·Actions의 실제 상태는 항상 최신 GitHub `main`과 현재 작업 브랜치에서 다시 확인한다.

## 1. 목적

이 문서는 Yut 제품이 사용자에게 제공해야 하는 핵심 동작과 온라인 게임의 상태 불변식을 정의한다.

현재 코드의 구현 방식을 그대로 설명하는 문서가 아니라 다음 판단의 기준으로 사용한다.

- 정상 동작은 무엇인가?
- 동일한 사용자 행동이나 timeout 사건은 몇 번 처리되어야 하는가?
- 서버 상태와 화면 연출이 충돌할 때 무엇을 우선해야 하는가?
- 재접속, snapshot echo, sequence replay가 발생해도 유지해야 하는 계약은 무엇인가?
- 수정 후 어떤 사용자-visible 최종 상태가 관찰되어야 하는가?

## 2. 기준 우선순위

충돌이 발생하면 다음 순서로 판단한다.

1. 현재 사용자가 명시적으로 승인한 이번 작업 범위
2. 최신 `main`의 `AGENTS.md`, `DEVELOPMENT_PLAYBOOK.md`, `BUG_HISTORY.md`
3. 이 문서의 제품 계약
4. 최신 `main`의 제품 코드와 테스트
5. 과거 대화, 이전 계획, 오래된 화면 자료

이 문서와 최신 코드가 충돌하면 임의로 한쪽을 선택하지 않는다. 다음을 확인해 충돌을 기록한다.

- 문서와 코드의 마지막 갱신 시점
- 실제 사용자에게 보이는 현재 동작
- 관련 테스트가 검증하는 계약
- `BUG_HISTORY.md`의 과거 실패와 금지된 접근
- 안전한 최소 수정 또는 문서 정정 방향

## 3. 핵심 용어

| 용어 | 정의 |
|---|---|
| authoritative state | Firestore를 통해 확정된 온라인 게임의 기준 상태 |
| action | 윷 던지기, 말 이동, 아이템 사용 등 상태 변경 요청 |
| sequence | authoritative action 처리 결과를 순서대로 기록한 이벤트 |
| local presentation | action 제출 클라이언트가 즉시 시작하는 애니메이션과 화면 전이 |
| server echo | 로컬에서 제출한 결과가 commit 응답, snapshot, subscription 또는 replay로 다시 도착하는 현상 |
| action identity | 동일한 논리적 action을 식별하는 `clientActionId` 또는 `clientMutationId` |
| canonical timeout identity | room, actor, stage, authoritative deadline으로 결정되는 timeout action ID |
| coordinator | 온라인 게임의 자동 진행, AI 또는 timeout 복구를 수행할 권한을 가진 좌석 |
| terminal state | 특정 action이나 workflow가 더 이상 진행 중이 아닌 최종 상태 |

## 4. 제품 모드별 계약

### 4.1 로비

필수 동작:

- 비활성·삭제 예정·유효하지 않은 방은 정상 활성 방처럼 노출하지 않는다.
- 방 생성 요청이 서버에서 성공했지만 UI 응답이 지연된 경우, 동일한 고유 방 제목으로 생성된 방을 복구할 수 있어야 한다.
- 사용자는 동시에 여러 활성 방의 실제 참여자로 남지 않아야 한다.
- 생성·입장 실패가 발생하면 잘못된 로컬 room ID나 host 상태를 남기지 않는다.
- 방 목록은 최근 활동을 기준으로 안정적으로 정렬한다.

### 4.2 대기실

필수 동작:

- 방장과 참가자의 권한을 구분한다.
- 방 설정은 게임 시작 전에 일관되게 확정되어야 한다.
- 플레이어·좌석 정보가 불완전한 상태에서는 authoritative 게임 상태를 초기화하지 않는다.
- 시작 요청, 카운트다운, 취소, 실제 게임 진입을 서로 다른 상태로 구분한다.
- 재접속한 사용자가 동일 좌석과 권한을 복구할 수 있어야 한다.
- 수동 AI 좌석과 연결이 끊겨 AI로 대체된 인간 좌석을 구분한다.
- 모바일에서는 방 제목, 옵션, 좌석, 준비 상태, 시작 버튼이 서로 겹치지 않아야 한다.

### 4.3 게임 화면

필수 동작:

- 동일 action의 게임 규칙 처리는 한 번만 발생한다.
- 동일 action의 사용자-visible 이동 연출도 한 번만 시작한다.
- 화면은 최종적으로 authoritative state와 일치해야 한다.
- 중간 연출 상태가 authoritative 최종 상태에 의해 조기에 덮어써져 되감기처럼 보여서는 안 된다.
- authoritative 상태 적용이 늦어져도 사용자 입력이 무제한 중복 제출되어서는 안 된다.
- 현재 actor와 단계에 허용된 입력만 활성화한다.

## 5. 온라인 authoritative 처리 계약

### 5.1 단일 처리

동일한 논리적 action은 다음 모든 전달 경로를 합쳐 한 번만 처리한다.

- commit 응답
- Firestore state snapshot
- sequence subscription
- sequence replay
- apply-wake 또는 재진입 복구
- coordinator 복구

동일 identity가 다시 도착한 경우 새 action으로 실행하지 않고 기존 처리의 ACK 또는 replay로 분류한다.

### 5.2 순서 보존

- `lastSequence`는 authoritative sequence 적용 순서를 나타낸다.
- 이전 sequence가 필요한 상태에서 더 뒤의 snapshot을 먼저 화면에 적용해 중간 action을 누락해서는 안 된다.
- state snapshot과 sequence cache가 경합하면 필요한 sequence가 준비된 뒤 상태를 전달하는 것을 우선한다.
- metadata-only 응답만으로 sequence cursor를 앞당겨 실제 sequence를 stale 처리해서는 안 된다.
- 같은 sequence를 commit callback과 subscription이 각각 새 action처럼 적용해서는 안 된다.

### 5.3 상태 소유권

온라인 action 처리에는 다음 두 소유권이 존재한다.

1. 규칙과 최종 상태의 소유권: authoritative reducer와 Firestore
2. 실행 클라이언트의 화면 연출 소유권: 최초 local presentation

두 소유권을 혼합하지 않는다.

- reducer의 최종 `pieces`는 서버 결과와 비교에는 필요하다.
- 실행 클라이언트가 이미 동일 이동을 재생 중이면 같은 `pieces`를 중간에 다시 적용하지 않는다.
- local presentation 완료 뒤 최종 화면은 authoritative state와 같아야 한다.

## 6. 턴 상태 전이

대표적인 턴 단계:

```text
턴 시작
→ roll 입력 가능
→ roll 결과 확정 및 연출
→ 필요한 경우 추가 선택
→ move 입력 가능
→ 말 이동 및 효과 연출
→ 추가 던지기 또는 다음 턴
```

온라인 상태는 상황에 따라 다음 deadline kind를 사용할 수 있다.

- `roll`
- `move`
- `item_prompt`
- `trap_placement`
- deadline 없음

각 deadline action은 현재 상태의 actor, stage, deadline과 정확히 일치해야 한다. 과거 deadline이나 다른 actor를 대상으로 한 복구 action은 거부한다.

### 6.1 빽도 무말 자동 패스 계약

빽도(`steps = -1`)가 확정됐지만 현재 actor의 **윷판 위 이동 가능한 말이 0개**이면 사용자가 선택할 수 있는 합법적 이동이 없다.

필수 제품 동작:

- 대기석의 새 말을 빽도로 출발시키지 않는다.
- 말 선택이나 `이동` 버튼 입력을 기다리지 않는다.
- 현재 roll의 authoritative action-ready 경계가 충족된 뒤 자동 패스를 정확히 한 번 제출한다.
- 자동 패스는 빈 `pieceId`의 이동/skip 의미를 사용하더라도 일반 수동 말 이동으로 예약하거나 조기 시작 시각을 만들지 않는다.
- authoritative 결과는 현재 roll을 소비하고 `turnIndex`를 다음 유효 actor로 정확히 한 번 진행시킨다.
- `lastMovedPieceIds`는 비어 있어야 하고 이동 presentation, capture sequence/effect/ghost가 생기지 않아야 한다.
- 실행 클라이언트와 관찰 클라이언트 모두 같은 `turnIndex`, `roll = null`, pending 0 상태로 수렴해야 한다.
- reload/remount, commit echo, snapshot, sequence replay가 발생해도 같은 자동 패스를 다시 제출하거나 다시 소비하지 않는다.
- 사용자에게 보이던 빽도 결과/대기 메시지는 다음 턴 상태가 확정되면 사라지고 다음 actor의 정상 입력이 가능해야 한다.

판정 우선순위:

1. 현재 roll과 actor에 대응하는 authoritative turn/action-ready 상태
2. 같은 authoritative snapshot의 `pieces`와 이동 가능성
3. local projection 또는 아직 동기화되지 않은 화면 상태

따라서 local `canSelectPiece()`나 projected piece geometry만 보고 authoritative 준비 이전에 턴을 넘기지 않는다. 반대로 authoritative 준비가 충족되고 실제 합법적 이동이 0개임이 확인되면 UI 입력을 기다리며 턴을 붙잡아 두지 않는다.

## 7. 윷 던지기 계약

- 수동 입력과 deadline 자동 입력을 구분한다.
- 같은 roll action이 commit, snapshot, replay로 여러 번 도착해도 결과는 한 번만 확정한다.
- roll 연출이 끝나기 전에 다음 단계가 사용자에게 잘못 노출되지 않아야 한다.
- roll timing 판정은 pointer 입력 시점의 snapshot을 기준으로 고정되어야 한다.
- 화면의 timing 표시와 authoritative 판정이 서로 달라서는 안 된다.
- timeout 누적 정책은 온라인 authoritative 정책과 일치해야 한다.
- pointerdown 이후 페이지 visibility 변화가 있더라도 확정된 입력 snapshot을 임의 변경하지 않는다.

## 8. 말 이동 계약

### 8.1 수동 이동

- 사용자가 선택한 말과 경로를 한 번만 제출한다.
- action pending 중 동일한 이동 요청이 다시 생성되지 않아야 한다.
- local presentation은 선택한 말의 실제 경로를 순서대로 보여준다.
- 서버 결과가 빨리 도착해도 local presentation을 출발점이나 최종 칸으로 갑자기 덮어쓰지 않는다.
- 같은 말 ID라는 사실만으로 전체 이동 경로가 완료됐다고 판단하지 않는다.

### 8.2 timeout 자동 이동

이동 선택 deadline 만료 시 다음 계약을 따른다.

- UI deadline 자동 이동, stalled-turn 복구, coordinator 복구는 동일 timeout 사건으로 취급한다.
- canonical identity는 room, actor, `move` stage, authoritative deadline으로 결정한다.
- `Date.now()`, 렌더 횟수, 최신 로그, `movingPieceId`, 임의 UUID를 identity 재료로 사용하지 않는다.
- 최초 로컬 `move_piece:*` identity는 optimistic presentation 소유권으로 유지할 수 있다.
- 서버 제출 직전에는 canonical timeout identity로 정규화한다.
- canonical commit, subscription, replay echo는 최초 로컬 presentation identity의 alias로 처리한다.
- 동일 말은 대기석으로 되돌아갔다가 다시 이동해서는 안 된다.
- 동일 경로 연출은 한 번만 재생한다.
- 상대 말이 없으면 capture sequence, capture effect, capture ghost가 생기지 않아야 한다.

### 8.3 timeout 후 자동 플레이

- timeout 누적 결과로 자동 플레이가 활성화되면 authoritative state의 timeout count와 `autoPlayBySeatId`가 함께 일관되게 갱신되어야 한다.
- 다음 AI 또는 coordinator action은 이전 이동 sequence보다 뒤에 생성되어야 한다.
- timeout 복구 완료 뒤 UI가 이동 버튼만 잠긴 상태로 고착되어서는 안 된다.
- 이전 timeout의 callback이 다음 턴에 다시 소비되어서는 안 된다.

## 9. ACK와 duplicate 계약

commit 결과는 최소 다음 세 유형으로 구분한다.

| 분류 | 조건 | 처리 |
|---|---|---|
| stateful | 성공 또는 duplicate이며 실제 `stateAfter`나 `patch`가 있음 | local ACK 또는 authoritative 적용 가능 |
| stateless duplicate | duplicate지만 sequence·turnVersion 같은 metadata만 있음 | 영수증으로만 취급하고 state/cursor를 선점하지 않음 |
| passthrough | 소유하지 않은 action, 실패, 다른 action type 등 | 기존 callback·subscription 경로 유지 |

metadata-only duplicate의 필수 계약:

- apply-wake snapshot을 만들지 않는다.
- `lastSequence` 또는 fingerprint를 먼저 갱신하지 않는다.
- 실제 Firestore sequence가 도착할 때 기존 sequence pipeline으로 처리한다.
- local pending은 presentation, sequence ACK, fingerprint 조건이 모두 충족되기 전에 해제하지 않는다.

## 10. 잡기와 일반 이동의 분리

잡기 여부는 애니메이션 모양이 아니라 authoritative 데이터로 판단한다.

확인 항목:

- 목적지에 상대 말이 실제 존재했는가?
- sequence에 captured piece ID가 있는가?
- `captureEffect`가 생성됐는가?
- `.capture-ghost`가 생성됐는가?
- 상대 말의 최종 위치가 대기석으로 변경됐는가?

일반 timeout 이동 반복 문제를 잡기 효과, capture CSS 또는 잡기 애니메이션에서 우회 차단하지 않는다.

## 11. 아이템과 추가 선택

- item prompt, trap placement, item pickup은 각각 독립된 pending 상태와 deadline을 가진다.
- timeout 복구 action은 authoritative pending owner와 deadline에 정확히 일치해야 한다.
- 아이템 선택 취소나 자동 skip은 다음 게임 단계로 실제 진입해야 한다.
- 이미 처리된 선택을 snapshot echo로 다시 노출하지 않는다.
- pending UI와 authoritative pending state가 최종적으로 일치해야 한다.
- 아이템 처리 실패가 일반 roll·move pending을 잘못 해제해서는 안 된다.

## 12. coordinator 계약

- coordinator 권한은 현재 lease와 epoch에 의해 검증되어야 한다.
- 만료되거나 다른 epoch의 coordinator action을 허용하지 않는다.
- 인간 사용자의 일반 action과 AI·timeout 자동 action의 권한을 구분한다.
- coordinator가 처리한 action과 UI가 동시에 제출한 동일 canonical timeout action은 duplicate로 수렴해야 한다.
- coordinator 교체가 동일 action 재실행의 근거가 되어서는 안 된다.
- coordinator action이 실패하면 현재 authoritative state를 다시 확인한 뒤 안전하게 복구한다.

## 13. 재접속과 replay

재접속 또는 컴포넌트 재마운트 시:

- 현재 room과 player identity를 복구한다.
- 필요한 sequence를 `lastSequence` 이후부터 적용한다.
- 이미 표시한 local presentation을 무조건 다시 시작하지 않는다.
- 실제 lifecycle 경계 전에는 action alias ledger를 transient render나 snapshot echo만으로 정리하지 않는다.
- 방 이탈, 새 게임, room 변경은 ledger와 cache를 정리할 수 있는 실제 경계다.
- 연결 복구 후 화면 상태, authoritative state, DOM 위치가 일치해야 한다.

## 14. 방 이탈과 정리

- 사용자가 방을 나가면 player·seat·room summary가 일관되게 갱신되어야 한다.
- 게임 중 연결 이탈은 필요 시 동일 좌석의 AI 대체로 전환한다.
- 수동 AI 좌석과 인간 대체 AI를 삭제·복구할 때 서로 다른 규칙을 적용한다.
- 빈 방, 오래된 방, 완료된 방은 안전한 guard를 거쳐 정리한다.
- 방 정리 실패는 다른 활성 방 참여나 새 방 생성을 영구 차단해서는 안 된다.
- cleanup retry가 현재 사용자의 새 room을 삭제해서는 안 된다.

## 15. 모바일·브라우저 UX 계약

### Galaxy 기준

대표 viewport:

```text
412 × 915
```

확인 대상:

- 로비 header와 badge
- 대기실 제목, 옵션, 좌석, 버튼
- 게임 board와 control 접근성
- timing track 가로 overflow
- 화면 전환 후 scroll 위치
- modal과 키보드 표시 상태

### Safari/WebKit 기준

확인 대상:

- `document.visibilityState`
- timer와 deadline 진행
- room 생성 후 화면 진입
- turn-order intro와 game start
- pointer timing snapshot
- Chromium과 다른 visible/canonical state mismatch

## 16. 사용자-visible 최종 상태 검증

온라인 동작 수정은 내부 변수 하나가 아니라 다음 최종 상태를 검증한다.

- authoritative room state
- 해당 action sequence
- debug state
- 실제 DOM
- 사용자 입력 가능 여부
- 다음 턴 또는 다음 단계 진입
- 중복 action·중복 연출 부재
- console blocking error 부재

빽도 무말 자동 패스의 대표 검증:

```text
현재 actor의 started && !finished 말 = 0
roll = 빽도
이동 버튼 enable = 0회
local 자동 패스 mutation = 1
authoritative empty-piece/skip sequence = 1
turnIndex 증가 = 정확히 1
roll = null
lastMovedPieceIds = []
moving presentation = 0
capture 관련 데이터 = 0
server turnIndex = debug turnIndex = 양 클라이언트 표시 turn
reload/remount 후 동일 pass sequence 수 = 1
다음 actor 입력 가능 = 성공
```

말 이동의 대표 검증:

```text
sequence 수 = 1
moving presentation 시작 = 1
대기석 복귀 = 0
예상 경로의 각 노드 표시 = 각 1회
capture 관련 데이터 = 없음 또는 기대값
서버 최종 위치 = debug 최종 위치 = DOM 최종 위치
다음 턴 진행 = 성공
```

## 17. 금지된 우회

다음 방식으로 제품 결함을 숨기지 않는다.

- timeout 또는 sleep을 근거 없이 증가
- assertion 삭제·완화
- 테스트 skip
- animation 속도만 변경
- capture UI에서 일반 이동 중복을 차단
- 같은 action에 호출 시점마다 다른 ID 부여
- metadata-only ACK를 authoritative state로 취급
- local presentation이 끝나기 전에 pending action을 해제
- 순간 DOM만 확인하고 최종 authoritative 상태를 검증하지 않음
- 재현이 어렵다는 이유로 fixture가 제품 경로를 우회하게 변경

## 18. 문서 갱신 규칙

다음 중 하나가 바뀌면 이 문서를 검토한다.

- 새로운 action type
- 새로운 deadline kind
- action identity 규칙
- local presentation 소유권
- duplicate·replay 처리
- coordinator 권한
- room lifecycle
- 재접속 복구
- 게임 규칙 또는 사용자-visible UX 계약

갱신 시 기준 SHA, 변경 이유, 관련 테스트와 실제 QA lane을 함께 기록한다.
