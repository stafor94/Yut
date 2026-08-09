# UI_EVIDENCE_CATALOG.md

> 문서 상태: 프로젝트 소스용 초기 기준서
> 작성 기준: GitHub `stafor94/Yut`의 `main` `ca676216ef2c25bac940a7cc0e871d9a520ef2c4`
> 기준일: 2026-08-06
> 저장소 반영 검토 기준: GitHub `stafor94/Yut`의 `main` `58f7ee0b252abfda019efe1da4ec53caac8bfde8` / 2026-08-09
> 적용 원칙: 이 문서는 제품 계약과 판단 근거를 제공한다. 코드·테스트·workflow·Issue·PR·Actions의 실제 상태는 항상 최신 GitHub `main`과 현재 작업 브랜치에서 다시 확인한다.

## 1. 목적

이 문서는 프로젝트 소스에 업로드할 정상 UI, 오류 UI, 재현 영상과 로그 증거를 관리한다.

이미지나 영상을 단순 보관하는 것이 아니라 다음 판단에 사용할 수 있도록 메타데이터를 연결한다.

- 기대 UI와 실제 UI 비교
- Desktop, Galaxy, Safari 차이 확인
- 동일 버그의 재현 여부 판단
- animation 모양과 실제 authoritative 상태 구분
- 수정 전·후 회귀 검증
- 버그 보고의 재현 환경 고정

## 2. 권장 프로젝트 소스 구성

```text
PRODUCT_BEHAVIOR_SPEC.md
SYSTEM_FLOW_MAP.md
QA_VALIDATION_MATRIX.md
FIREBASE_STATE_MODEL.md
UI_EVIDENCE_CATALOG.md

evidence/
├─ expected/
│  ├─ desktop/
│  ├─ galaxy/
│  └─ safari/
├─ defects/
│  ├─ lobby/
│  ├─ waiting-room/
│  ├─ game/
│  ├─ timeout/
│  └─ timing/
└─ resolved/
   └─ <issue-or-pr>/
```

프로젝트 소스가 폴더 구조를 지원하지 않으면 파일명 prefix로 구분한다.

## 3. 파일명 규칙

형식:

```text
<화면>-<환경>-<상태>-<세부내용>-<YYYYMMDD>.<확장자>
```

예:

```text
waiting-room-galaxy-expected-two-column-options-20260806.png
waiting-room-safari-defect-title-overflow-20260806.png
game-galaxy-defect-timeout-move-rewind-20260805.mp4
game-desktop-resolved-timeout-single-move-pr1550-20260806.mp4
lobby-galaxy-expected-header-badges-20260806.png
```

규칙:

- 공백 대신 `-`
- 영문 소문자 권장
- 날짜 포함
- `defect`, `resolved`, `expected` 중 하나 포함
- 관련 Issue 또는 PR이 있으면 파일명에 포함
- 같은 파일명으로 새 증거를 덮어쓰지 않음

## 4. 필수 메타데이터

각 증거는 아래 정보를 catalog에 기록한다.

```text
Evidence ID:
파일명:
분류: expected | defect | resolved | comparison
화면:
기기/브라우저:
viewport:
OS:
build SHA:
배포 URL 또는 실행 환경:
관련 Issue/PR/Run:
재현 절차:
기대 결과:
실제 결과:
판정에 사용할 관찰점:
개인정보 포함 여부:
상태:
```

build SHA를 모르면 `unknown`으로 기록하되 최신 증거로 단정하지 않는다.

## 5. 증거 신뢰도

| 등급 | 조건 | 사용 |
|---|---|---|
| A | SHA, 환경, 재현 절차, 서버/DOM 근거 모두 있음 | 원인·완료 판정 |
| B | SHA와 환경, 명확한 화면 증거 있음 | UI 비교·회귀 판단 |
| C | 날짜 또는 환경 일부 누락 | 가설 제시 |
| D | 출처·시점 불명 | 참고만 가능 |

오래된 스크린샷이 최신 제품 계약보다 우선하지 않는다.

## 6. 초기 expected evidence 목록

아래 파일은 우선 확보할 정상 기준 이미지다.

| Evidence ID | 권장 파일명 | 환경 | 핵심 판정 |
|---|---|---|---|
| EXP-LOBBY-GALAXY-001 | `lobby-galaxy-expected-default-412x915.png` | Galaxy Chromium 412×915 | header, badges, 방 목록, scroll |
| EXP-WAIT-GALAXY-001 | `waiting-room-galaxy-expected-options-412x915.png` | Galaxy Chromium | 옵션 표시, 좌석, 시작 버튼 |
| EXP-WAIT-DESKTOP-001 | `waiting-room-desktop-expected-default.png` | Desktop Chromium | 2열 옵션, 정렬, 버튼 |
| EXP-GAME-GALAXY-001 | `game-galaxy-expected-active-turn-412x915.png` | Galaxy Chromium | board, header, controls 접근 |
| EXP-GAME-DESKTOP-001 | `game-desktop-expected-active-turn.png` | Desktop Chromium | board와 controls 정렬 |
| EXP-TIMING-GALAXY-001 | `roll-timing-galaxy-expected-track.png` | Galaxy Chromium | 0·50·100%, overflow 없음 |
| EXP-TIMING-SAFARI-001 | `roll-timing-safari-expected-visible.png` | Mobile WebKit | visible 상태와 pointer UI |
| EXP-MOVE-001 | `move-expected-n02-n03-n04.mp4` | Desktop 또는 Galaxy | 단일 이동 경로 |
| EXP-BACKDO-PASS-001 | `game-galaxy-expected-backdo-no-piece-auto-pass.mp4` | Galaxy Chromium | move 버튼 비활성, 말 이동 없이 다음 턴 수렴 |

## 7. 초기 defect evidence 목록

| Evidence ID | 권장 파일명 | 증상 | 필수 동반 근거 |
|---|---|---|---|
| DEF-MOVE-REWIND-001 | `game-galaxy-defect-timeout-move-rewind.mp4` | 대기석→n02→n03→대기석 반복 | sequence, piece state, capture 없음 |
| DEF-ACK-001 | `game-galaxy-defect-fast-ack-jump.mp4` | 최종 칸→중간 칸→최종 칸 | ACK status, sequence, node path |
| DEF-WAIT-OVERFLOW-001 | `waiting-room-safari-defect-overflow.png` | title/options overflow | viewport, computed width |
| DEF-ROOM-CREATE-001 | `lobby-safari-defect-room-creating-stuck.png` | 생성 중 문구 고착 | 실제 room 존재·cleanup 기록 |
| DEF-TIMING-001 | `roll-timing-safari-defect-intro-stall.mp4` | game start 전 timer 고착 | visibility, deadline, state |
| DEF-BACKDO-PASS-001 | `game-galaxy-defect-backdo-no-piece-stuck.mp4` | 빽도 후 이동 가능한 말이 없는데 턴 고착 | server turnIndex/roll, sequence count, move button, debug pending |

## 8. resolved evidence 목록

수정 완료 후 같은 재현 조건으로 증거를 다시 수집한다.

| Evidence ID | 권장 파일명 | 완료 판정 |
|---|---|---|
| RES-MOVE-PR1550-001 | `game-galaxy-resolved-timeout-single-move-pr1550.mp4` | 이동 시작 1, 대기석 복귀 0 |
| RES-MOVE-DESKTOP-001 | `game-desktop-resolved-timeout-single-move-pr1550.mp4` | sequence 1, n02→n03→n04 |
| RES-ROOM-SAFARI-001 | `lobby-safari-resolved-room-recovery-pr1548.mp4` | 초기 문구 상태에서도 waiting room 복구 |
| RES-TIMING-SAFARI-001 | `roll-timing-safari-resolved-foreground.png` | visible 확인 후 정상 start |
| RES-BACKDO-PASS-001 | `game-galaxy-resolved-backdo-no-piece-auto-pass.mp4` | 사용자 move 없이 turn +1, roll 소진, move/capture 0, remount 후 중복 0 |

resolved 증거만으로 완료하지 않는다. 관련 Required Check와 merge SHA의 Main Branch QA 성공도 필요하다.

## 8.1 빽도 무말 자동 패스 증거 기준

영상만으로 자동 패스 성공을 확정하지 않는다. 다음 근거를 같은 재현에서 연결한다.

- 시작 시 actor의 윷판 위 `started && !finished` 말 수 = 0
- 실제 빽도 결과 관찰
- move 버튼이 한 번도 활성화되지 않음
- moving piece/capture effect가 한 번도 활성화되지 않음
- authoritative `turnIndex` 정확히 +1
- authoritative `roll = null`
- empty-piece/skip sequence 수 = 1
- `lastMovedPieceIds = []`
- 실행자·관찰자 debug/DOM turn 일치
- 다음 actor roll 가능
- reload/remount 후 sequence 수가 그대로 1

이 항목은 UI evidence와 authoritative evidence를 함께 요구하므로 가능하면 A 등급으로 수집한다.

## 9. 스크린샷 촬영 기준

### 공통

- 브라우저 전체 또는 앱 전체 영역 포함
- 주소창·개인 계정 정보는 필요 시 가림
- 문제 부분만 과도하게 crop하지 않음
- viewport 크기 기록
- zoom 100% 기록
- 스크롤 위치 기록
- modal/keyboard가 있으면 상태 기록
- 가능하면 동일 조건의 expected와 defect를 한 쌍으로 촬영

### UI 배치 문제

함께 보이게 해야 하는 항목:

- 부모 container 경계
- 인접 요소
- 화면 좌우 경계
- header/footer
- scrollbar
- 문제 텍스트 전체

### 상태 문제

스크린샷만으로 부족한 경우:

- debug state
- sequence
- console
- network 또는 Firestore 상태
- 전후 영상

## 10. 영상 촬영 기준

최소 포함 구간:

```text
재현 전 안정 상태 2초
→ 사용자 입력 또는 deadline
→ 오류 발생 전체
→ 오류 후 최종 상태 3초
```

권장:

- 30fps 이상
- 포인터 또는 터치 위치 표시
- 편집으로 중간 구간 삭제하지 않음
- 실제 속도 유지
- 화면 회전 금지
- 소리가 원인과 무관하면 제거 가능
- 파일 용량이 크면 핵심 구간 clip과 원본을 구분

## 11. timeout move 증거 기준

timeout 이동 영상은 애니메이션 모양만으로 잡기 여부를 판단하지 않는다.

필수 관찰:

- timeout 전 대상 말 위치
- 상대 말 위치
- timeout deadline
- moving presentation 시작 횟수
- 실제 node path
- 대기석 복귀 횟수
- capture ghost 존재 여부
- 최종 DOM 위치

동반 데이터:

```text
roomId: 민감하지 않은 QA room만
actorId:
targetPieceId:
turnDeadlineAt:
local clientActionId:
canonical clientMutationId:
sequence 번호:
sequence type:
state final node:
debug final node:
DOM nearest node:
```

## 12. timing 증거 기준

roll timing 문제는 다음을 함께 기록한다.

- pointerdown 시각
- pointerup 시각
- live position
- snapshot position
- authoritative timing zone
- displayed grade
- `document.visibilityState`
- viewport와 scrollLeft
- result hold 상태
- deadline auto fallback 여부

영상만으로 timing 오차를 단정하지 않는다.

## 13. 대기실 증거 기준

확인 항목:

- 방 제목
- 방장 badge
- 참가자/AI 좌석
- 준비 상태
- 옵션 두 열 또는 지정 레이아웃
- 버튼 enable/disable
- 상단 한 줄 구성
- 페이지 세로 scroll
- 텍스트 줄바꿈과 ellipsis
- 빈 좌석 정렬

민감한 사용자 닉네임은 QA nickname으로 대체한다.

## 14. catalog

실제 파일을 프로젝트 소스에 올린 뒤 아래 표를 갱신한다.

| Evidence ID | 파일명 | 등급 | 기준 SHA | 환경 | 관련 이슈/PR | 상태 | 설명 |
|---|---|---|---|---|---|---|---|
| | | | | | | | |

상태 값:

- `planned`
- `captured`
- `verified`
- `superseded`
- `archived`

## 15. 비교 기록 템플릿

```text
Comparison ID:
Expected evidence:
Defect evidence:
Resolved evidence:
동일 조건:
달라진 조건:
사용자-visible 차이:
authoritative 상태 차이:
DOM 차이:
남은 위험:
판정:
```

## 16. 개인정보·보안

업로드 전 제거 또는 가림:

- 실제 사용자 이메일
- Firebase access token
- API key가 포함된 debug 화면
- 개인 nickname 또는 실명
- production room ID가 민감한 경우
- 브라우저 profile 정보
- GitHub secret
- 로컬 파일 경로의 개인 계정명

공개 Firebase config와 secret token을 혼동하지 말고, 판단이 어려우면 보수적으로 가린다.

## 17. 증거 교체 규칙

다음 경우 기존 증거를 `superseded`로 변경한다.

- UI가 의도적으로 변경됨
- 관련 동작 계약이 변경됨
- build SHA가 너무 오래됨
- viewport가 더 이상 지원 대상이 아님
- 재현 절차가 현재 제품과 맞지 않음
- 새 증거가 더 높은 신뢰도 등급을 가짐

기존 파일을 삭제하기보다 교체 사유를 남긴다.

## 18. 작업 활용 절차

```text
1. 요청과 관련된 Evidence ID 검색
2. 기준 SHA와 환경 확인
3. 최신 main의 실제 UI·코드와 비교
4. expected/defect 차이 정리
5. 제품 상태 전이와 authoritative 데이터 확인
6. 수정 후 동일 조건으로 resolved 증거 수집
7. 관련 PR QA와 Main QA 결과 연결
8. catalog 상태를 verified 또는 superseded로 갱신
```

## 19. 금지된 증거 사용

- SHA가 다른 스크린샷을 동일 버전 비교로 사용
- crop된 이미지 하나로 root cause 확정
- 애니메이션 모양만으로 capture 판정
- QA fixture 화면을 production 사용자 동작의 완전한 증명으로 간주
- resolved 이미지가 있다는 이유로 Actions 실패를 무시
- 브라우저·viewport가 다른 비교를 동일 조건이라고 표시
- 사용자 개인정보가 포함된 원본을 그대로 프로젝트 소스에 업로드

## 20. 갱신 규칙

다음 상황에서 catalog를 갱신한다.

- 새로운 주요 화면
- UI 기준 변경
- 반복 defect 발견
- 버그 수정 PR 병합
- 지원 viewport/browser 변경
- 기존 증거가 오래되거나 부정확해짐
- Main QA가 특정 시각적 결함을 새로 검증할 때
