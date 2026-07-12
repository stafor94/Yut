# QA cleanup exit validation

- npm ci: 0
- node --check: 0
- unit: 0
- build: 0

## .npm-ci.log
```text

added 115 packages, and audited 116 packages in 5s

12 packages are looking for funding
  run `npm fund` for details

found 0 vulnerabilities
```

## .unit.log
```text
ok 139 - fresh heartbeat는 유지하고 stale human만 정리 대상으로 판정한다
  ---
  duration_ms: 0.232647
  type: 'test'
  ...
# Subtest: 게임 중 stale human은 AI 대체하고 대기실 stale human은 제거한다
ok 140 - 게임 중 stale human은 AI 대체하고 대기실 stale human은 제거한다
  ---
  duration_ms: 0.360318
  type: 'test'
  ...
# Subtest: 좌석이 없는 stale spectator성 데이터는 게임 중에도 제거 경로를 사용한다
ok 141 - 좌석이 없는 stale spectator성 데이터는 게임 중에도 제거 경로를 사용한다
  ---
  duration_ms: 0.195612
  type: 'test'
  ...
# Subtest: 정상 snapshot이 계속 도착하면 sequence query를 실행하지 않는다
ok 142 - 정상 snapshot이 계속 도착하면 sequence query를 실행하지 않는다
  ---
  duration_ms: 1.327992
  type: 'test'
  ...
# Subtest: listener가 멈추면 5초 후 단발 복구 확인을 실행한다
ok 143 - listener가 멈추면 5초 후 단발 복구 확인을 실행한다
  ---
  duration_ms: 0.373688
  type: 'test'
  ...
# Subtest: 예약 중 snapshot이 도착하면 기존 watchdog을 취소하고 5초를 다시 센다
ok 144 - 예약 중 snapshot이 도착하면 기존 watchdog을 취소하고 5초를 다시 센다
  ---
  duration_ms: 0.380878
  type: 'test'
  ...
# Subtest: 변화가 없거나 조회가 실패하면 5초, 10초, 20초 백오프 후 최대 4회에서 멈춘다
ok 145 - 변화가 없거나 조회가 실패하면 5초, 10초, 20초 백오프 후 최대 4회에서 멈춘다
  ---
  duration_ms: 1.148815
  type: 'test'
  ...
# Subtest: 최대 총 복구시간을 넘기는 다음 확인은 예약하지 않는다
ok 146 - 최대 총 복구시간을 넘기는 다음 확인은 예약하지 않는다
  ---
  duration_ms: 0.269632
  type: 'test'
  ...
# Subtest: 페이지 복귀 즉시 확인은 예약 시간을 기다리지 않고 실행한다
ok 147 - 페이지 복귀 즉시 확인은 예약 시간을 기다리지 않고 실행한다
  ---
  duration_ms: 0.351634
  type: 'test'
  ...
# Subtest: 조회 중 snapshot이 도착하면 완료 후 즉시 재조회하지 않고 새 5초 기준으로 재예약한다
ok 148 - 조회 중 snapshot이 도착하면 완료 후 즉시 재조회하지 않고 새 5초 기준으로 재예약한다
  ---
  duration_ms: 0.273097
  type: 'test'
  ...
# Subtest: 다른 복구 흐름 때문에 deferred되면 재시도 횟수를 소모하지 않고 5초 뒤 다시 확인한다
ok 149 - 다른 복구 흐름 때문에 deferred되면 재시도 횟수를 소모하지 않고 5초 뒤 다시 확인한다
  ---
  duration_ms: 0.278676
  type: 'test'
  ...
# Subtest: 기존 replay, 이동, snapshot 적용, 수동 동기화, pending action, deadline 복구와 충돌하면 deferred한다
ok 150 - 기존 replay, 이동, snapshot 적용, 수동 동기화, pending action, deadline 복구와 충돌하면 deferred한다
  ---
  duration_ms: 0.397553
  type: 'test'
  ...
1..150
# tests 150
# suites 0
# pass 150
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 624.215217
```

## .build.log
```text

> build
> tsc -b && vite build

[36mvite v8.1.3 [32mbuilding client environment for production...[36m[39m
[2Ktransforming...✓ 88 modules transformed.
rendering chunks...
computing gzip size...
dist/index.html                     0.24 kB │ gzip:   0.19 kB
dist/assets/index-Dya19wTi.css    115.41 kB │ gzip:  21.62 kB
dist/assets/index-CfHprBrS.js   1,048.78 kB │ gzip: 310.53 kB

[32m✓ built in 392ms[39m
[33m[plugin builtin:vite-reporter] 
(!) Some chunks are larger than 500 kB after minification. Consider:
- Using dynamic import() to code-split the application
- Use build.rolldownOptions.output.codeSplitting to improve chunking: https://rolldown.rs/reference/OutputOptions.codeSplitting
- Adjust chunk size limit for this warning via build.chunkSizeWarningLimit.[39m
```
