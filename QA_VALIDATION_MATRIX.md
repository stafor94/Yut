# QA_VALIDATION_MATRIX.md

> 문서 상태: 프로젝트 소스용 초기 기준서
> 작성 기준: GitHub `stafor94/Yut`의 `main` `ca676216ef2c25bac940a7cc0e871d9a520ef2c4`
> 기준일: 2026-08-06
> 저장소 반영 검토 기준: GitHub `stafor94/Yut`의 `main` `58f7ee0b252abfda019efe1da4ec53caac8bfde8` / 2026-08-09
> 적용 원칙: 이 문서는 제품 계약과 판단 근거를 제공한다. 코드·테스트·workflow·Issue·PR·Actions의 실제 상태는 항상 최신 GitHub `main`과 현재 작업 브랜치에서 다시 확인한다.

## 1. 목적

이 문서는 제품 변경과 실제 검증 경로를 연결한다.

계획 단계에서 다음을 답할 수 있어야 한다.

- 어떤 제품 코드가 바뀌는가?
- 직접·간접 테스트는 무엇인가?
- 신규·수정 테스트가 어느 workflow와 lane에서 실제 실행되는가?
- Draft PR, Ready PR, 병합 후 `main`에서 각각 무엇이 검증되는가?
- Safari 또는 특정 viewport가 PR 단계에서 실행되지 않는가?

## 2. 검증 원칙

- 실행하지 않은 검증을 성공으로 표현하지 않는다.
- 신규·수정 테스트는 실제 포함된 job에서 최소 한 번 실행한다.
- UI 변경은 연결된 viewport와 브라우저를 확인한다.
- 공통 helper 변경은 대표 소비 테스트와 후속 assertion·teardown을 확인한다.
- timeout, fixture, action identity 변경은 제품 최종 상태와 sequence를 함께 검증한다.
- 테스트 삭제, skip, assertion 완화, 무조건 성공, 근거 없는 sleep 증가를 사용하지 않는다.
- workflow 변경이나 새 lane은 진단 편의로 만들지 않는다. 동일한 명시적 사용자 목표의 필수 검증 경로가 기존 공식 workflow에 없을 때만 최소 변경하며, credential·secret·privacy·보안 경계 또는 민감 권한 변경이 아니라면 routine 사용자 승인을 새로 요구하지 않는다.

## 3. package script 기준

현재 `package.json`의 대표 명령:

| 명령 | 용도 |
|---|---|
| `npm run build` | TypeScript build, Vite production build, build version 검증 |
| `npm run build:qa` | QA mode build와 version 검증 |
| `npm run test:unit` | TypeScript unit 출력 생성 후 Node unit suite |
| `npm run test:e2e` | production build 후 전체 Playwright 계열 |
| `npm run test:smoke` | Desktop Chromium smoke와 lobby |
| `npm run test:game-flow` | Desktop Chromium online/game-flow/regression |
| `npm run test:mobile` | Mobile Galaxy project의 mobile tests |
| `npm run qa:validate-architecture` | workflow, manifest, performance, failure issue 등 QA 구조 계약 |
| `npm run qa:emulator-suite -- --group <group>` | Firebase Auth·Firestore emulator 기반 특정 QA group |
| `npm run qa:verify-emulator` | emulator runtime 설정 검증 |
| `npm run qa:cleanup-rooms` | QA room 정리 |

환경에 따라 로컬 Firebase emulator나 Playwright browser가 없을 수 있다. 실행하지 못하면 공식 PR/Main QA에서 해당 테스트가 실행되는지 확인하고 미실행 이유를 기록한다.

## 4. PR Required QA

Workflow: `.github/workflows/pr-required-qa.yml`
표시 이름: `PR Required QA`

### 4.1 Draft PR

Draft의 `opened`, `synchronize`, `reopened`에서는 fast gate만 실행한다.

| Job | 실행 | 필수 결과 |
|---|---:|---|
| Build and unit | 실행 | `success` |
| Firebase emulator matrix | `skipped` | Draft에서는 정상 |
| Validate PR | 실행 | build success + emulator skipped |

Draft 단계의 의미:

- build·unit·QA architecture의 기본 건전성 확인
- 전체 browser/emulator 회귀 인증 전 상태
- 병합 가능 상태가 아님
- Ready 전환 전에 전체 diff와 로컬 검증을 완료해야 함

### 4.2 Ready PR

`ready_for_review` 또는 Ready 상태의 후속 commit에서는 다음 5개 emulator lane을 실행한다.

| Group | Code | Browser/Project | 주요 범위 |
|---|---|---|---|
| `online-core` | `core` | Chromium / Desktop | 온라인 턴, timeout, room lifecycle, AI |
| `mobile-galaxy` | `galaxy` | Chromium / Desktop+Galaxy | 모바일 UI와 Galaxy 회귀 |
| `mobile-galaxy-timing` | `galtime` | Chromium / Desktop+Galaxy | roll timing과 deadline |
| `mobile-galaxy-move-ack` | `galack` | Chromium / Desktop+Galaxy | 빠른·느린 ACK 이동 경합 |
| `mobile-galaxy-move-start` | `galstart` | Chromium / Desktop+Galaxy | 출발점 이동 경합 |

Ready PR의 `Validate PR`은 다음을 모두 요구한다.

- Build and unit: `success`
- Firebase emulator matrix: `success`
- Validate PR: `success`

### 4.3 PR 단계의 명시적 공백

Safari/WebKit lane은 현재 PR Required QA에 없다.

따라서 Safari 직접 영향이 있는 변경은:

- PR에서 build·unit 및 가능한 Chromium 소비 경로를 검증한다.
- Safari는 미실행으로 명시한다.
- 병합 후 해당 merge SHA의 Main Branch QA Safari lane을 최종 gate로 확인한다.
- Safari 사전 검증이 병합 필수인데 기존 공식 경로가 없다면 같은 사용자 목표에 필요한 최소 workflow 변경을 검토한다. credential·secret·privacy·보안 경계 또는 민감 권한 변경이 아니면 routine 승인 요청으로 중단하지 않는다.
- 임시 workflow, inspector PR, integration PR을 만들지 않는다.

## 5. Main Branch QA

Workflow: `.github/workflows/qa.yml`
표시 이름: `Main Branch QA`

`main` push의 merge commit을 다음 job이 직접 검증한다.

### 5.1 Build

| Code | Job | 검증 |
|---|---|---|
| `build` | Build and unit tests | architecture, production build, unit |

### 5.2 Firebase emulator browser matrix

| Group | Code | Browser | Workers | 대표 범위 |
|---|---|---|---:|---|
| `online-core` | `core` | Chromium | 2 | basic turn, stacked timeout, move timeout, game start, room lifecycle |
| `desktop-sequence` | `seq` | Chromium | 1 | bug history sequence replay smoke |
| `desktop-regression` | `desk` | Chromium | 2 | AI recovery, finish animation, roll surface, statistics, lobby |
| `mobile-galaxy` | `galaxy` | Chromium | 3 | 412×915 UI, waiting room, game controls, timeout |
| `mobile-galaxy-timing` | `galtime` | Chromium | 3 | pointer timing, overflow, timeout deadline |
| `mobile-galaxy-move-ack` | `galack` | Chromium | 3 | `online-move-single-execution` ACK cases |
| `mobile-galaxy-move-start` | `galstart` | Chromium | 3 | `online-move-single-execution` start cases |
| `safari-visible-mismatch` | `safvis` | WebKit | 1 | visibility·snapshot mismatch 핵심 사례 |
| `safari-timing` | `safari` | WebKit | 1 | Safari pointer timing |

### 5.3 Summary gate

`Summarize QA result`는 다음을 모두 확인한다.

- Build and unit result
- 모든 emulator matrix result
- lane별 duration artifact
- QA performance validation
- structured failure report 생성
- summary artifact 업로드

다음은 성공이 아니다.

- `queued`
- `pending`
- `in_progress`
- `cancelled`
- 상태 없음
- 다른 SHA의 성공
- 일부 lane만 성공
- summary 이전 개별 job 성공

전체 완료 조건은 해당 merge SHA의 Main Branch QA가 `completed/success`인 것이다.

## 6. QA group 상세 매핑

### 6.1 Online core

대표 spec:

- `tests/game-flow/basic-turn.spec.js`
- `tests/game-flow/stacked-roll-timeout.spec.js`
- `tests/game-flow/move-timeout-recovery.spec.js`
- `tests/game-flow/game-start-authority.spec.js`
- `tests/game-flow/turn-order-simultaneous.spec.js`
- `tests/game-flow/ai-substitution.spec.js`
- `tests/game-flow/ai-stacked-strategy.spec.js`
- `tests/game-flow/hard-ai-authoritative-strategy.spec.js`
- `tests/game-flow/online-ai-presentation-stall.spec.js`
- `tests/online/room-lifecycle.spec.js`
- `tests/online/room-leave-ui-race.spec.js`
- `tests/online/room-exit-resume.spec.js`

### 6.2 Desktop sequence

- `tests/regression/bug-history-smoke.spec.js`

### 6.3 Desktop regression

대표 spec:

- `tests/game-flow/ai-presence-recovery.spec.js`
- `tests/game-flow/turn-order-auto-timeout.spec.js`
- `tests/regression/finish-step-animation.spec.js`
- `tests/regression/remote-fall-presentation.spec.js`
- `tests/regression/game-statistics-dialog.spec.js`
- `tests/lobby`

### 6.4 Mobile Galaxy

대표 spec:

- `tests/mobile/mobile-layout.spec.js`
- `tests/mobile/waiting-room-requested-layout.spec.js`
- `tests/mobile/waiting-room-empty-seat-layout.spec.js`
- `tests/mobile/lobby-start-polish.spec.js`
- `tests/mobile/roll-timing-grades.spec.js`
- `tests/mobile/turn-order-layout.spec.js`
- `tests/mobile/stacked-roll-timeout.spec.js`
- `tests/mobile/move-timeout-recovery.spec.js`
- `tests/mobile/online-ai-presentation-stall.spec.js`

### 6.5 Timing 및 move ownership

| Lane | Shared target |
|---|---|
| `galtime` | roll timing pointer, overflow, timeout deadline, roll submit move deadline |
| `galack` | `tests/mobile/online-move-single-execution.spec.js`의 ACK title group |
| `galstart` | 같은 spec의 출발점 title group |
| `safvis` | timing pointer의 Nice snapshot, overflow |
| `safari` | timing pointer에서 Nice snapshot 제외 |

## 7. 제품 영역별 검증 맵

| 변경 영역 | 직접 unit/정적 | PR Ready | Main QA | 필수 추가 확인 |
|---|---|---|---|---|
| authoritative reducer | reducer unit | core, 관련 Galaxy | build, core, seq, desk, 관련 mobile | reject/duplicate/patch |
| action identity | identity unit | core, galack/galstart | 동일 + sequence | ID 안정성, alias |
| local move ACK | localMoveCommitAck unit | core, galack | 동일 + seq | stateful/stateless |
| move presentation | presentation unit 또는 wiring | core, galaxy, galack/start | seq, desk 포함 | node path, DOM 최종 |
| timeout recovery | resolver unit | core, galaxy/galtime | Safari 영향 여부 | deadline·actor 일치 |
| room 생성·입장 | room service unit | core, galaxy | desk/Safari 소비 | ghost room, cleanup |
| waiting room UI | component/wiring | galaxy | desk, galaxy, Safari 영향 | 412×915, scroll |
| roll timing | timing unit | galtime | galtime, safvis, safari | pointer snapshot |
| 공통 QA helper | helper unit | 모든 소비 PR lane | 모든 소비 Main lane | 최초 실패 뒤 teardown |
| suite manifest | architecture validator | Build and unit | Build and unit | 실제 target 포함 |
| workflow | architecture validator | 해당 workflow 이벤트 | merge 후 workflow | 기존 공식 경로 우선, 필수 변경만 최소화 |

## 8. 최근 timeout move 회귀 계약

현재 직접 관련 테스트:

- `tests/unit/timeoutMoveActionIdentity.test.ts`
- `tests/unit/localMoveCommitAck.test.ts`
- `tests/game-flow/move-timeout-recovery.spec.js`
- `tests/mobile/move-timeout-recovery.spec.js`
- `tests/helpers/move-timeout-recovery.js`
- `tests/helpers/move-timeout-stateless-duplicate.js`

필수 검증:

- UI local ID와 canonical timeout ID 분리·alias
- deadline 기준 identity 안정성
- metadata-only duplicate가 cursor 선점하지 않음
- Listen 차단 중 local presentation 1회
- 실제 sequence 수신 후 canonical state 적용
- `n02 → n03 → n04` 단일 경로
- 대기석 복귀 0
- capture 데이터 0
- pending 0
- 다음 AI 턴 진입
- Desktop Online core와 Mobile Galaxy에서 실제 실행

## 8.1 빽도 무말 자동 패스 회귀 계약

재현 조건:

```text
2-player online
현재 actor의 윷판 위 started && !finished 말 = 0
상대 말은 윷판 위에 있어도 됨
non-stacked 기준의 실제 빽도 roll
```

필수 제품 판정:

- 사용자 `이동` 버튼은 활성화되지 않는다.
- 사용자 클릭 없이 자동 패스가 정확히 한 번 제출된다.
- 자동 패스는 수동 말 이동 예약으로 분류되지 않는다.
- authoritative skip/empty-piece sequence는 정확히 1개다.
- `turnIndex`는 정확히 1 증가하고 `roll`은 `null`로 소비된다.
- `lastMovedPieceIds`는 비어 있고 moving/capture presentation은 발생하지 않는다.
- 실행자와 관찰자 클라이언트가 같은 authoritative turn으로 수렴한다.
- 다음 actor가 정상적으로 roll 입력 가능하다.
- reload/remount 이후 동일 자동 패스 sequence가 추가되지 않는다.

검증은 순간 DOM 하나가 아니라 다음을 함께 본다.

```text
server state
+ sequence/action identity
+ debug state
+ 양 클라이언트 DOM/control
+ remount 후 sequence count
```

필수 lane:

- PR Ready: `online-core`, `mobile-galaxy`
- Main QA: 동일 제품 경로를 소비하는 `core`, `galaxy` 및 summary gate
- 신규/수정 spec이 실제 manifest에 포함됐는지 architecture validation으로 확인

## 9. UI 검증 기준

### Desktop

- 주요 control이 겹치지 않음
- modal과 header action 접근 가능
- game board 최종 상태와 debug state 일치
- 불필요한 문서 가로 scroll 없음

### Galaxy

기준 viewport:

```text
412 × 915
```

확인:

- 상단 header와 badges
- 대기실 옵션과 버튼
- 좌석·빈 좌석 정렬
- 게임 control 접근성
- 세로 scroll 최소화
- timing track overflow 없음
- 화면 전환 뒤 scroll reset

### Safari/WebKit

확인:

- page foreground와 visibility
- timer·deadline 진행
- pointerdown snapshot
- room 생성 복구
- intro와 game start 전환
- Chromium과 다른 visible/canonical 상태 mismatch

## 10. 성능 검증

Main QA는 기능 성공과 성능 관찰을 분리한다.

대표 현재 기준:

| Lane | 관찰 목표 | 반복 이슈 후보 | 비상 차단 |
|---|---:|---:|---:|
| `galtime` | 240초 | 300초 | 360초 |
| `galack` | 210초 | 240초 | 360초 |
| `galstart` | 120초 | 150초 | 360초 |

원칙:

- 단일 목표 초과는 경고일 수 있다.
- 반복 이슈 기준은 fingerprint 후보로 기록한다.
- 비상 차단 초과나 timing artifact 누락은 workflow 실패다.
- 기능 실패를 성능 경고로 분류하지 않는다.
- 성능 문제를 timeout·assertion 완화로 해결하지 않는다.

## 11. 변경 유형별 사전 검증

### 문서 전용

- 변경 파일이 요청된 Markdown으로 제한됐는지 확인
- 링크, 중복, 충돌, 상반된 완료 조건 확인
- 제품 build·Playwright를 억지로 실행하지 않음
- 자동 check가 실행되면 결과를 사실대로 기록

### TypeScript 제품 코드

권장:

```bash
npm ci
npm run qa:validate-architecture
npm run build
npm run test:unit
```

영향받는 emulator group을 추가 실행할 수 있으면 실행한다.

### Playwright fixture/helper

- `node --check` 가능한 JS 파일은 구문 검사
- 관련 unit wiring
- fixture가 포함된 실제 `qa:emulator-suite` group
- serial suite의 최초 실패 뒤 assertion과 teardown 검토

### workflow

- 기존 공식 workflow로 목표 검증이 가능한지 먼저 확인
- 같은 사용자 목표에 필수인 변경만 최소화
- credential·secret·privacy·보안 경계 또는 민감 권한 변경이면 사용자 확인
- YAML parse
- architecture validator
- event별 실제 Run
- 권한 확대, matrix 삭제, `continue-on-error`, path filter 검토

## 12. 검증 결과 기록 형식

```text
변경 동작:
제품 파일:
직접 테스트:
간접 테스트:
PR workflow/job/lane:
Main workflow/job/lane:
실행 명령:
실행 결과:
미실행 검증:
미실행 이유:
대체 근거:
잔여 위험:
```

원격 Run은 다음을 함께 기록한다.

```text
Workflow:
Run ID:
Run URL:
Head SHA:
Run attempt:
확인 job:
마지막 status:
Conclusion:
```

## 13. Actions 대기 제한

동일 Run 또는 동일 gate의 상태는 최초 대기 시작 기준 약 1분·5분·9분에 확인한다.

- `queued`/`pending`/`in_progress`이면 해당 Run을 보존하고 terminal 상태를 기다린다.
- 단일 tool/connector error, 빈 응답, malformed response, timeout은 대기 시간을 초기화하지 않으며 그 자체로 9분 차단 조건이 아니다.
- terminal이면 즉시 다음 gate로 진행한다.
- 9분에도 동일 Run/gate가 non-terminal이거나, 9분까지 필요한 상태를 사용 가능한 공식 경로로 직접 확인할 수 없을 때 원격 검증 차단으로 기록한다.
- 새 Push와 새 head SHA에서만 새 대기 시간을 시작한다.
- 차단 시 PR, branch, head SHA, merge SHA, workflow, Run ID, 마지막 상태, 완료 gate와 남은 gate를 기록한다.

## 14. matrix 갱신 규칙

다음 변경 시 이 문서를 갱신한다.

- QA group 추가·삭제·분할
- spec이 다른 group으로 이동
- browser 또는 viewport 변경
- Draft/Ready trigger 변경
- Main QA lane 변경
- performance threshold 변경
- Required Check 이름 변경
- 신규 테스트가 실제 lane에 포함될 때

최신 기준은 항상 다음 파일에서 다시 확인한다.

- `package.json`
- `tests/qa/suite-manifest.mjs`
- `.github/workflows/pr-required-qa.yml`
- `.github/workflows/qa.yml`
- `tests/qa/validate-architecture.mjs`
- `tests/qa/validate-pr-required-qa.mjs`
