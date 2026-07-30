const timeoutPenaltyTitle = '오프라인 timeout 누적 정책은 온라인 서버 정책과 동일하다';
const timingPointerSpec = 'tests/mobile/roll-timing-pointer-capture.spec.js';
const timingOverflowSpec = 'tests/mobile/roll-timing-overflow.spec.js';
const firebaseIsolationTitle = 'QA browser app uses only the isolated Firebase emulators';
const timingNiceSnapshotTitle = 'pointerdown Nice snapshot은 오래 눌러도 live freeze·result hold·authoritative 판정이 Nice로 유지된다';
const timingOverflowTitle = '오브는 고정 트랙 안에서 0·50·100%를 표시하며 이동 중 문서 가로 폭과 scrollLeft를 바꾸지 않는다';

export const qaSuiteManifest = Object.freeze({
  'online-core': Object.freeze({
    label: 'Online core',
    code: 'core',
    workers: 2,
    browsers: Object.freeze(['chromium']),
    projects: Object.freeze(['desktop-chromium']),
    browserIsolationTest: 'tests/smoke/firebase-emulator-isolation.spec.js',
    grepInvert: timeoutPenaltyTitle,
    tests: Object.freeze([
      'tests/game-flow/basic-turn.spec.js',
      'tests/game-flow/stacked-roll-timeout.spec.js',
      'tests/game-flow/move-timeout-recovery.spec.js',
      'tests/game-flow/game-start-authority.spec.js',
      'tests/game-flow/turn-order-simultaneous.spec.js',
      'tests/game-flow/ai-substitution.spec.js',
      'tests/game-flow/ai-stacked-strategy.spec.js',
      'tests/game-flow/hard-ai-authoritative-strategy.spec.js',
      'tests/game-flow/online-ai-presentation-stall.spec.js',
      'tests/online/room-lifecycle.spec.js',
      'tests/online/room-leave-ui-race.spec.js',
      'tests/online/room-exit-resume.spec.js',
    ]),
  }),
  'desktop-sequence': Object.freeze({
    label: 'Desktop sequence replay',
    code: 'seq',
    workers: 1,
    browsers: Object.freeze(['chromium']),
    timeoutMs: 150_000,
    projects: Object.freeze(['desktop-chromium']),
    browserIsolationTest: 'tests/smoke/firebase-emulator-isolation.spec.js',
    grepInvert: timeoutPenaltyTitle,
    tests: Object.freeze([
      'tests/regression/bug-history-smoke.spec.js',
    ]),
  }),
  'desktop-regression': Object.freeze({
    label: 'Desktop regression',
    code: 'desk',
    workers: 2,
    browsers: Object.freeze(['chromium']),
    timeoutMs: 150_000,
    projects: Object.freeze(['desktop-chromium']),
    browserIsolationTest: 'tests/smoke/firebase-emulator-isolation.spec.js',
    grepInvert: timeoutPenaltyTitle,
    tests: Object.freeze([
      'tests/game-flow/ai-presence-recovery.spec.js',
      'tests/game-flow/turn-order-auto-timeout.spec.js',
      'tests/regression/finish-step-animation.spec.js',
      'tests/regression/roll-mat-surface.spec.js',
      'tests/regression/local-roll-stage-position.spec.js',
      'tests/regression/remote-fall-presentation.spec.js',
      'tests/regression/roll-landing-profiles.spec.js',
      'tests/regression/bonus-roll-result-glow.spec.js',
      'tests/regression/game-statistics-dialog.spec.js',
      'tests/regression/game-header-actions.spec.js',
      'tests/lobby',
    ]),
  }),
  'mobile-galaxy': Object.freeze({
    label: 'Mobile Galaxy',
    code: 'galaxy',
    workers: 3,
    browsers: Object.freeze(['chromium']),
    projects: Object.freeze(['desktop-chromium', 'mobile-galaxy']),
    browserIsolationTest: 'tests/smoke/firebase-emulator-isolation.spec.js',
    tests: Object.freeze([
      'tests/mobile/mobile-layout.spec.js',
      'tests/mobile/waiting-room-requested-layout.spec.js',
      'tests/mobile/waiting-room-empty-seat-layout.spec.js',
      'tests/mobile/lobby-start-polish.spec.js',
      'tests/mobile/lobby-guide-polish.spec.js',
      'tests/mobile/lobby-app-version-auto-reload.spec.js',
      'tests/mobile/roll-timing-grades.spec.js',
      'tests/mobile/roll-landing-profiles-fallback.spec.js',
      'tests/mobile/roll-stage-board-alignment.spec.js',
      'tests/mobile/turn-order-layout.spec.js',
      'tests/mobile/turn-order-final-alignment.spec.js',
      'tests/mobile/turn-order-roll-placement.spec.js',
      'tests/mobile/mobile-item-log-scroll.spec.js',
      'tests/mobile/item-skip-pending.spec.js',
      'tests/mobile/auto-play-controls-scroll.spec.js',
      'tests/mobile/game-header-log-alignment.spec.js',
      'tests/mobile/lobby-scroll-reset.spec.js',
      'tests/mobile/lobby-header-badges.spec.js',
      'tests/mobile/game-statistics-dialog.spec.js',
      'tests/mobile/game-guide-dialog.spec.js',
      'tests/mobile/stacked-roll-timeout.spec.js',
      'tests/mobile/move-timeout-recovery.spec.js',
      'tests/mobile/ai-stacked-strategy.spec.js',
      'tests/mobile/hard-ai-authoritative-strategy.spec.js',
      'tests/mobile/online-ai-presentation-stall.spec.js',
    ]),
  }),
  'mobile-galaxy-timing': Object.freeze({
    label: 'Mobile Galaxy timing',
    code: 'galtime',
    workers: 3,
    browsers: Object.freeze(['chromium']),
    projects: Object.freeze(['desktop-chromium', 'mobile-galaxy']),
    browserIsolationTest: 'tests/smoke/firebase-emulator-isolation.spec.js',
    sharedTargets: Object.freeze([timingPointerSpec, timingOverflowSpec]),
    tests: Object.freeze([timingPointerSpec, timingOverflowSpec]),
  }),
  'safari-visible-mismatch': Object.freeze({
    label: 'Safari visible mismatch',
    code: 'safvis',
    workers: 1,
    browsers: Object.freeze(['webkit']),
    projects: Object.freeze(['mobile-webkit-timing']),
    browserIsolationTest: 'tests/smoke/firebase-emulator-isolation.spec.js',
    grep: `${firebaseIsolationTitle}|${timingNiceSnapshotTitle}|${timingOverflowTitle}`,
    sharedTargets: Object.freeze([timingPointerSpec, timingOverflowSpec]),
    tests: Object.freeze([timingPointerSpec, timingOverflowSpec]),
  }),
  'safari-timing': Object.freeze({
    label: 'Safari timing',
    code: 'safari',
    workers: 1,
    browsers: Object.freeze(['webkit']),
    projects: Object.freeze(['mobile-webkit-timing']),
    browserIsolationTest: 'tests/smoke/firebase-emulator-isolation.spec.js',
    grepInvert: timingNiceSnapshotTitle,
    sharedTargets: Object.freeze([timingPointerSpec]),
    tests: Object.freeze([timingPointerSpec]),
  }),
});

export const qaSuiteNames = Object.freeze(Object.keys(qaSuiteManifest));

export function getQaSuite(name) {
  const suite = qaSuiteManifest[name];
  if (!suite) throw new Error(`지원하지 않는 QA group입니다: ${name || '없음'} (허용: ${qaSuiteNames.join(', ')})`);
  return suite;
}
