# Three.js roll QA validation v2

- patch: ok
- npm ci: 0
- unit: 0
- build: 0
- movement QA: 1
- cleanup: 0

## .npm-ci.log
```text

added 115 packages, and audited 116 packages in 6s

12 packages are looking for funding
  run `npm fund` for details

found 0 vulnerabilities
```

## .firebase-env.log
```text
Wrote canonical production Firebase config: project=yut-online, appId=1:925785463331:web:73ac57a5f7f8527455ef96
```

## .unit.log
```text
  duration_ms: 1.868218
  type: 'test'
  ...
# Subtest: turnVersion이 없는 legacy snapshot도 안정적인 payload key로 중복 적용을 막는다
ok 105 - turnVersion이 없는 legacy snapshot도 안정적인 payload key로 중복 적용을 막는다
  ---
  duration_ms: 2.230596
  type: 'test'
  ...
# Subtest: 완주 경로는 출발점에서 끊고 이후 말판 칸을 포함하지 않는다
ok 106 - 완주 경로는 출발점에서 끊고 이후 말판 칸을 포함하지 않는다
  ---
  duration_ms: 1.750938
  type: 'test'
  ...
# Subtest: 출발점에 도착해 있던 말의 다음 양수 이동은 즉시 완주 경로가 된다
ok 107 - 출발점에 도착해 있던 말의 다음 양수 이동은 즉시 완주 경로가 된다
  ---
  duration_ms: 0.218409
  type: 'test'
  ...
# Subtest: 서버 이동 payload는 완주 뒤 말판 칸을 전달하지 않는다
ok 108 - 서버 이동 payload는 완주 뒤 말판 칸을 전달하지 않는다
  ---
  duration_ms: 1.47914
  type: 'test'
  ...
# Subtest: 기존 coordinator가 계속 human이면 재접속한 앞 좌석보다 기존 coordinator를 유지한다
ok 109 - 기존 coordinator가 계속 human이면 재접속한 앞 좌석보다 기존 coordinator를 유지한다
  ---
  duration_ms: 1.882445
  type: 'test'
  ...
# Subtest: 기존 coordinator가 AI로 대체되면 다음 human에게 승계한다
ok 110 - 기존 coordinator가 AI로 대체되면 다음 human에게 승계한다
  ---
  duration_ms: 0.26655
  type: 'test'
  ...
# Subtest: 판 위 말이 있어도 높은 번호 출발 전 말을 누르면 제어 가능한 출발 전 말 전체를 선택 표시한다
ok 111 - 판 위 말이 있어도 높은 번호 출발 전 말을 누르면 제어 가능한 출발 전 말 전체를 선택 표시한다
  ---
  duration_ms: 15.011868
  type: 'test'
  ...
# Subtest: 출발 전 말 그룹의 실제 이동 대상은 항상 label 숫자 오름차순 첫 번째 말이다
ok 112 - 출발 전 말 그룹의 실제 이동 대상은 항상 label 숫자 오름차순 첫 번째 말이다
  ---
  duration_ms: 0.397334
  type: 'test'
  ...
# Subtest: 상대편 말과 완주 말은 출발 전 선택 그룹에서 제외한다
ok 113 - 상대편 말과 완주 말은 출발 전 선택 그룹에서 제외한다
  ---
  duration_ms: 0.423944
  type: 'test'
  ...
# Subtest: 판 위 업힌 말 선택은 같은 위치의 같은 편 전체를 유지하고 빽도는 출발 전 말을 이동 대상으로 고르지 않는다
ok 114 - 판 위 업힌 말 선택은 같은 위치의 같은 편 전체를 유지하고 빽도는 출발 전 말을 이동 대상으로 고르지 않는다
  ---
  duration_ms: 0.361086
  type: 'test'
  ...
# Subtest: AI 대체 세대가 달라지면 복구 요청 key도 달라진다
ok 115 - AI 대체 세대가 달라지면 복구 요청 key도 달라진다
  ---
  duration_ms: 2.102317
  type: 'test'
  ...
# Subtest: 같은 방과 사용자에서 더 새로운 presence epoch로 player 복구된 경우만 결과를 적용한다
ok 116 - 같은 방과 사용자에서 더 새로운 presence epoch로 player 복구된 경우만 결과를 적용한다
  ---
  duration_ms: 0.312205
  type: 'test'
  ...
# Subtest: 윷과 모는 결과가 노출된 뒤 긍정 효과음을 선택한다
ok 117 - 윷과 모는 결과가 노출된 뒤 긍정 효과음을 선택한다
  ---
  duration_ms: 1.739788
  type: 'test'
  ...
# Subtest: 낙은 윷이나 모 결과보다 부정 효과음을 우선한다
ok 118 - 낙은 윷이나 모 결과보다 부정 효과음을 우선한다
  ---
  duration_ms: 0.21932
  type: 'test'
  ...
# Subtest: 회전과 낙하 중에는 결과 효과음을 재생하지 않는다
ok 119 - 회전과 낙하 중에는 결과 효과음을 재생하지 않는다
  ---
  duration_ms: 0.250919
  type: 'test'
  ...
# Subtest: 순서 정하기 굴림에는 게임 결과 전용음을 적용하지 않는다
ok 120 - 순서 정하기 굴림에는 게임 결과 전용음을 적용하지 않는다
  ---
  duration_ms: 0.242684
  type: 'test'
  ...
# Subtest: Perfect는 일반 굴림에서만 최상위 효과음을 사용한다
ok 121 - Perfect는 일반 굴림에서만 최상위 효과음을 사용한다
  ---
  duration_ms: 0.232286
  type: 'test'
  ...
# Subtest: 게임 결과 음성 대상 문구를 정규화한다
ok 122 - 게임 결과 음성 대상 문구를 정규화한다
  ---
  duration_ms: 1.573717
  type: 'test'
  ...
# Subtest: 낙 표시의 느낌표와 공백을 제거한다
ok 123 - 낙 표시의 느낌표와 공백을 제거한다
  ---
  duration_ms: 0.171301
  type: 'test'
  ...
# Subtest: 지원하지 않는 결과 문구는 읽지 않는다
ok 124 - 지원하지 않는 결과 문구는 읽지 않는다
  ---
  duration_ms: 0.218359
  type: 'test'
  ...
# Subtest: 로그인과 방 생성 timeout은 각 작업마다 독립적으로 새로 시작한다
ok 125 - 로그인과 방 생성 timeout은 각 작업마다 독립적으로 새로 시작한다
  ---
  duration_ms: 30.887582
  type: 'test'
  ...
# Subtest: 작업 제한 시간이 지나면 작업 종류가 포함된 timeout 오류를 반환한다
ok 126 - 작업 제한 시간이 지나면 작업 종류가 포함된 timeout 오류를 반환한다
  ---
  duration_ms: 6.012528
  type: 'test'
  ...
# Subtest: 동일 생성 요청은 같은 room id와 create request id를 사용한다
ok 127 - 동일 생성 요청은 같은 room id와 create request id를 사용한다
  ---
  duration_ms: 1.354135
  type: 'test'
  ...
# Subtest: timeout 복구는 정확히 같은 room, host, request만 허용한다
ok 128 - timeout 복구는 정확히 같은 room, host, request만 허용한다
  ---
  duration_ms: 0.305462
  type: 'test'
  ...
# Subtest: 다른 방으로 전환 중인 background cleanup은 새 방 화면 상태를 지우지 않는다
ok 129 - 다른 방으로 전환 중인 background cleanup은 새 방 화면 상태를 지우지 않는다
  ---
  duration_ms: 0.332894
  type: 'test'
  ...
# Subtest: 로비 controller는 start 전에는 구독하지 않고 중복 start에도 한 번만 구독한다
ok 130 - 로비 controller는 start 전에는 구독하지 않고 중복 start에도 한 번만 구독한다
  ---
  duration_ms: 1.114938
  type: 'test'
  ...
# Subtest: 활성 방마다 players listener를 한 번만 만들고 기존 currentPlayers 계산을 유지한다
ok 131 - 활성 방마다 players listener를 한 번만 만들고 기존 currentPlayers 계산을 유지한다
  ---
  duration_ms: 1.143581
  type: 'test'
  ...
# Subtest: 사람 플레이어가 없는 방은 목록에서 숨기지만 listener callback에서 삭제 작업을 만들지 않는다
ok 132 - 사람 플레이어가 없는 방은 목록에서 숨기지만 listener callback에서 삭제 작업을 만들지 않는다
  ---
  duration_ms: 0.189875
  type: 'test'
  ...
# Subtest: 방이 목록에서 사라지면 해당 players listener만 해제하고 늦은 callback은 무시한다
ok 133 - 방이 목록에서 사라지면 해당 players listener만 해제하고 늦은 callback은 무시한다
  ---
  duration_ms: 0.217888
  type: 'test'
  ...
# Subtest: 대기실·게임 전환에 해당하는 stop은 active rooms와 모든 players listener를 즉시 해제한다
ok 134 - 대기실·게임 전환에 해당하는 stop은 active rooms와 모든 players listener를 즉시 해제한다
  ---
  duration_ms: 0.324147
  type: 'test'
  ...
# Subtest: 로비 복귀에 해당하는 재시작은 즉시 새 active rooms listener를 생성한다
ok 135 - 로비 복귀에 해당하는 재시작은 즉시 새 active rooms listener를 생성한다
  ---
  duration_ms: 1.107574
  type: 'test'
  ...
# Subtest: 한 방의 cleanup lease는 한 소유자만 유지하고 만료 뒤 다른 사용자가 인계한다
ok 136 - 한 방의 cleanup lease는 한 소유자만 유지하고 만료 뒤 다른 사용자가 인계한다
  ---
  duration_ms: 1.660579
  type: 'test'
  ...
# Subtest: 종료된 방과 빈 후보는 cleanup lease를 획득하지 않는다
ok 137 - 종료된 방과 빈 후보는 cleanup lease를 획득하지 않는다
  ---
  duration_ms: 0.281887
  type: 'test'
  ...
# Subtest: spectator와 AI는 cleanup 주체와 stale human 대상에서 제외한다
ok 138 - spectator와 AI는 cleanup 주체와 stale human 대상에서 제외한다
  ---
  duration_ms: 0.226504
  type: 'test'
  ...
# Subtest: fresh heartbeat는 유지하고 stale human만 정리 대상으로 판정한다
ok 139 - fresh heartbeat는 유지하고 stale human만 정리 대상으로 판정한다
  ---
  duration_ms: 0.194654
  type: 'test'
  ...
# Subtest: 게임 중 stale human은 AI 대체하고 대기실 stale human은 제거한다
ok 140 - 게임 중 stale human은 AI 대체하고 대기실 stale human은 제거한다
  ---
  duration_ms: 0.294732
  type: 'test'
  ...
# Subtest: 좌석이 없는 stale spectator성 데이터는 게임 중에도 제거 경로를 사용한다
ok 141 - 좌석이 없는 stale spectator성 데이터는 게임 중에도 제거 경로를 사용한다
  ---
  duration_ms: 0.236463
  type: 'test'
  ...
# Subtest: 정상 snapshot이 계속 도착하면 sequence query를 실행하지 않는다
ok 142 - 정상 snapshot이 계속 도착하면 sequence query를 실행하지 않는다
  ---
  duration_ms: 2.1949
  type: 'test'
  ...
# Subtest: listener가 멈추면 5초 후 단발 복구 확인을 실행한다
ok 143 - listener가 멈추면 5초 후 단발 복구 확인을 실행한다
  ---
  duration_ms: 0.602168
  type: 'test'
  ...
# Subtest: 예약 중 snapshot이 도착하면 기존 watchdog을 취소하고 5초를 다시 센다
ok 144 - 예약 중 snapshot이 도착하면 기존 watchdog을 취소하고 5초를 다시 센다
  ---
  duration_ms: 0.578643
  type: 'test'
  ...
# Subtest: 변화가 없거나 조회가 실패하면 5초, 10초, 20초 백오프 후 최대 4회에서 멈춘다
ok 145 - 변화가 없거나 조회가 실패하면 5초, 10초, 20초 백오프 후 최대 4회에서 멈춘다
  ---
  duration_ms: 1.637686
  type: 'test'
  ...
# Subtest: 최대 총 복구시간을 넘기는 다음 확인은 예약하지 않는다
ok 146 - 최대 총 복구시간을 넘기는 다음 확인은 예약하지 않는다
  ---
  duration_ms: 0.440354
  type: 'test'
  ...
# Subtest: 페이지 복귀 즉시 확인은 예약 시간을 기다리지 않고 실행한다
ok 147 - 페이지 복귀 즉시 확인은 예약 시간을 기다리지 않고 실행한다
  ---
  duration_ms: 0.520224
  type: 'test'
  ...
# Subtest: 조회 중 snapshot이 도착하면 완료 후 즉시 재조회하지 않고 새 5초 기준으로 재예약한다
ok 148 - 조회 중 snapshot이 도착하면 완료 후 즉시 재조회하지 않고 새 5초 기준으로 재예약한다
  ---
  duration_ms: 0.482083
  type: 'test'
  ...
# Subtest: 다른 복구 흐름 때문에 deferred되면 재시도 횟수를 소모하지 않고 5초 뒤 다시 확인한다
ok 149 - 다른 복구 흐름 때문에 deferred되면 재시도 횟수를 소모하지 않고 5초 뒤 다시 확인한다
  ---
  duration_ms: 0.541784
  type: 'test'
  ...
# Subtest: 기존 replay, 이동, snapshot 적용, 수동 동기화, pending action, deadline 복구와 충돌하면 deferred한다
ok 150 - 기존 replay, 이동, snapshot 적용, 수동 동기화, pending action, deadline 복구와 충돌하면 deferred한다
  ---
  duration_ms: 0.621674
  type: 'test'
  ...
# Subtest: local player roll keeps the pre-result animation one second longer
ok 151 - local player roll keeps the pre-result animation one second longer
  ---
  duration_ms: 1.617048
  type: 'test'
  ...
# Subtest: pending phases use the local timeline and resolved rolls use the remote timeline
ok 152 - pending phases use the local timeline and resolved rolls use the remote timeline
  ---
  duration_ms: 0.248946
  type: 'test'
  ...
1..152
# tests 152
# suites 0
# pass 152
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 599.796873
```

## .build.log
```text

> build
> tsc -b && vite build

[36mvite v8.1.3 [32mbuilding client environment for production...[36m[39m
[2Ktransforming...✓ 91 modules transformed.
rendering chunks...
computing gzip size...
dist/index.html                     0.24 kB │ gzip:   0.19 kB
dist/assets/index-D81AoqKR.css    116.60 kB │ gzip:  21.91 kB
dist/assets/index-DJHFMedx.js   1,058.39 kB │ gzip: 314.34 kB

[32m✓ built in 473ms[39m
[33m[plugin builtin:vite-reporter] 
(!) Some chunks are larger than 500 kB after minification. Consider:
- Using dynamic import() to code-split the application
- Use build.rolldownOptions.output.codeSplitting to improve chunking: https://rolldown.rs/reference/OutputOptions.codeSplitting
- Adjust chunk size limit for this warning via build.chunkSizeWarningLimit.[39m
```

## .qa.log
```text

> test:qa-online-turn-recovery
> playwright test --workers=1 --project=desktop-chromium tests/regression/bug-history-smoke.spec.js tests/regression/roll-mat-surface.spec.js --output=test-results/threejs-roll-regression-v2


Running 5 tests using 1 worker

  ✓  1 [desktop-chromium] › tests/regression/bug-history-smoke.spec.js:14:7 › BUG_HISTORY regression smoke › 게임 시작 직후 윷 던지기/대기 버튼 상태가 고착되지 않는다 (11.9s)
  ✘  2 [desktop-chromium] › tests/regression/bug-history-smoke.spec.js:42:7 › BUG_HISTORY regression smoke › 온라인 윷 던지기는 sequence replay 애니메이션을 표시하고 이동 직후 경로 preview를 숨긴다 (24.0s)
  ✘  3 [desktop-chromium] › tests/regression/bug-history-smoke.spec.js:252:7 › BUG_HISTORY regression smoke › host가 대리 제출한 AI 이동은 sequence 경로로 칸별 재생되고 내 이동은 중복 재생되지 않는다 (36.6s)
  ✓  4 [desktop-chromium] › tests/regression/bug-history-smoke.spec.js:477:7 › BUG_HISTORY regression smoke › timeout 벌칙은 오프라인 로컬 timeout에만 적용된다 (384ms)
  ✓  5 [desktop-chromium] › tests/regression/roll-mat-surface.spec.js:13:7 › roll mat surface regression › pending부터 결과 유지까지 같은 2D 매트 표면을 계속 표시한다 (19.4s)


  1) [desktop-chromium] › tests/regression/bug-history-smoke.spec.js:42:7 › BUG_HISTORY regression smoke › 온라인 윷 던지기는 sequence replay 애니메이션을 표시하고 이동 직후 경로 preview를 숨긴다 

    Error: result-hold의 실제 시작·종료 시각이 브라우저에서 기록되어야 합니다.

    result-hold의 실제 시작·종료 시각이 브라우저에서 기록되어야 합니다.

    expect(received).toBeGreaterThan(expected)

    Expected: > 0
    Received:   0

    Call Log:
    - Timeout 500ms exceeded while waiting on the predicate

      205 |         timeout: 500,
      206 |         message: 'result-hold의 실제 시작·종료 시각이 브라우저에서 기록되어야 합니다.',
    > 207 |       }).toBeGreaterThan(0);
          |          ^
      208 |       const resultHoldTiming = await page.evaluate(() => {
      209 |         window.__YUT_QA_RESULT_HOLD_OBSERVER__?.disconnect();
      210 |         return window.__YUT_QA_RESULT_HOLD_TIMING__ ?? { startedAt: 0, endedAt: 0 };
        at /__w/Yut/Yut/tests/regression/bug-history-smoke.spec.js:207:10
        at actionWithLogging (/__w/Yut/Yut/tests/helpers/ui.js:19:20)
        at runQaStep (/__w/Yut/Yut/tests/helpers/ui.js:14:28)
        at /__w/Yut/Yut/tests/regression/bug-history-smoke.spec.js:90:5

    attachment #1: screenshot (image/png) ──────────────────────────────────────────────────────────
    test-results/threejs-roll-regression-v2/regression-bug-history-smo-61972--표시하고-이동-직후-경로-preview를-숨긴다-desktop-chromium/test-failed-1.png
    ────────────────────────────────────────────────────────────────────────────────────────────────

    Error Context: test-results/threejs-roll-regression-v2/regression-bug-history-smo-61972--표시하고-이동-직후-경로-preview를-숨긴다-desktop-chromium/error-context.md

    attachment #3: trace (application/zip) ─────────────────────────────────────────────────────────
    test-results/threejs-roll-regression-v2/regression-bug-history-smo-61972--표시하고-이동-직후-경로-preview를-숨긴다-desktop-chromium/trace.zip
    Usage:

        npx playwright show-trace test-results/threejs-roll-regression-v2/regression-bug-history-smo-61972--표시하고-이동-직후-경로-preview를-숨긴다-desktop-chromium/trace.zip

    ────────────────────────────────────────────────────────────────────────────────────────────────

  2) [desktop-chromium] › tests/regression/bug-history-smoke.spec.js:252:7 › BUG_HISTORY regression smoke › host가 대리 제출한 AI 이동은 sequence 경로로 칸별 재생되고 내 이동은 중복 재생되지 않는다 

    Error: 본인 optimistic 이동 애니메이션이 시작되어야 합니다.

    본인 optimistic 이동 애니메이션이 시작되어야 합니다.

    expect(received).toBeGreaterThan(expected)

    Expected: > 0
    Received:   0

    Call Log:
    - Timeout 8000ms exceeded while waiting on the predicate

      405 |       }
      406 |       expect(localMoveReady, 'Perfect 구간에서 반복 던진 뒤 활성화된 본인 말 이동 버튼을 실제로 클릭해야 합니다.').toBe(true);
    > 407 |       await expect.poll(async () => (await getMovingPieces()).length, { timeout: 8_000, message: '본인 optimistic 이동 애니메이션이 시작되어야 합니다.' }).toBeGreaterThan(0);
          |                                                                                                                                          ^
      408 |       await expect.poll(async () => (await getMovingPieces()).length, { timeout: 12_000, message: '본인 optimistic 이동 애니메이션이 종료되어야 합니다.' }).toBe(0);
      409 |       await page.waitForTimeout(1_200);
      410 |       expect(await getMovingPieces(), '서버 sequence 확정 후 본인 말 이동이 다시 재생되면 안 됩니다.').toEqual([]);
        at /__w/Yut/Yut/tests/regression/bug-history-smoke.spec.js:407:138
        at actionWithLogging (/__w/Yut/Yut/tests/helpers/ui.js:19:20)
        at runQaStep (/__w/Yut/Yut/tests/helpers/ui.js:14:28)
        at /__w/Yut/Yut/tests/regression/bug-history-smoke.spec.js:380:5

    attachment #1: screenshot (image/png) ──────────────────────────────────────────────────────────
    test-results/threejs-roll-regression-v2/regression-bug-history-smo-2a1df-로-칸별-재생되고-내-이동은-중복-재생되지-않는다-desktop-chromium/test-failed-1.png
    ────────────────────────────────────────────────────────────────────────────────────────────────

    Error Context: test-results/threejs-roll-regression-v2/regression-bug-history-smo-2a1df-로-칸별-재생되고-내-이동은-중복-재생되지-않는다-desktop-chromium/error-context.md

    attachment #3: trace (application/zip) ─────────────────────────────────────────────────────────
    test-results/threejs-roll-regression-v2/regression-bug-history-smo-2a1df-로-칸별-재생되고-내-이동은-중복-재생되지-않는다-desktop-chromium/trace.zip
    Usage:

        npx playwright show-trace test-results/threejs-roll-regression-v2/regression-bug-history-smo-2a1df-로-칸별-재생되고-내-이동은-중복-재생되지-않는다-desktop-chromium/trace.zip

    ────────────────────────────────────────────────────────────────────────────────────────────────

  2 failed
    [desktop-chromium] › tests/regression/bug-history-smoke.spec.js:42:7 › BUG_HISTORY regression smoke › 온라인 윷 던지기는 sequence replay 애니메이션을 표시하고 이동 직후 경로 preview를 숨긴다 
    [desktop-chromium] › tests/regression/bug-history-smoke.spec.js:252:7 › BUG_HISTORY regression smoke › host가 대리 제출한 AI 이동은 sequence 경로로 칸별 재생되고 내 이동은 중복 재생되지 않는다 
  3 passed (1.6m)
```

## .cleanup.log
```text

> qa:cleanup-rooms
> node tests/helpers/cleanup-qa-rooms.js

(node:762) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///__w/Yut/Yut/tests/helpers/cleanup-qa-rooms.js is not specified and it doesn't parse as CommonJS.
Reparsing as ES module because module syntax was detected. This incurs a performance overhead.
To eliminate this warning, add "type": "module" to /__w/Yut/Yut/package.json.
(Use `node --trace-warnings ...` to show where the warning was created)
QA cleanup mode=current-run, namespace=gh-29213114380-1-threejs-roll-regression-v2, workflowPrefix=없음, rooms=0
cleanup-after mode=current-run, remaining=0
```
