const timeoutPenaltyTitle = 'timeout 벌칙은 오프라인 로컬 timeout에만 적용된다';

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
      'tests/game-flow/game-start-authority.spec.js',
      'tests/game-flow/turn-order-simultaneous.spec.js',
      'tests/game-flow/ai-substitution.spec.js',
      'tests/game-flow/ai-presence-recovery.spec.js',
      'tests/online/room-lifecycle.spec.js',
      'tests/online/room-exit-resume.spec.js',
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
      'tests/regression/bug-history-smoke.spec.js',
      'tests/regression/finish-step-animation.spec.js',
      'tests/regression/roll-mat-surface.spec.js',
      'tests/regression/local-roll-stage-position.spec.js',
      'tests/regression/remote-fall-presentation.spec.js',
      'tests/regression/bonus-roll-result-glow.spec.js',
      'tests/lobby',
    ]),
  }),
  'mobile-galaxy': Object.freeze({
    label: 'Mobile Galaxy + Safari timing',
    code: 'mobile',
    workers: 3,
    browsers: Object.freeze(['chromium', 'webkit']),
    projects: Object.freeze(['desktop-chromium', 'mobile-galaxy', 'mobile-webkit-timing']),
    browserIsolationTest: 'tests/smoke/firebase-emulator-isolation.spec.js',
    tests: Object.freeze([
      'tests/mobile/mobile-layout.spec.js',
      'tests/mobile/waiting-room-requested-layout.spec.js',
      'tests/mobile/waiting-room-empty-seat-layout.spec.js',
      'tests/mobile/lobby-start-polish.spec.js',
      'tests/mobile/lobby-guide-polish.spec.js',
      'tests/mobile/roll-timing-grades.spec.js',
      'tests/mobile/roll-timing-pointer-capture.spec.js',
      'tests/mobile/roll-stage-board-alignment.spec.js',
      'tests/mobile/turn-order-layout.spec.js',
      'tests/mobile/turn-order-roll-placement.spec.js',
      'tests/mobile/mobile-item-log-scroll.spec.js',
      'tests/mobile/game-header-log-alignment.spec.js',
      'tests/mobile/lobby-scroll-reset.spec.js',
      'tests/mobile/lobby-header-badges.spec.js',
    ]),
  }),
});

export const qaSuiteNames = Object.freeze(Object.keys(qaSuiteManifest));

export function getQaSuite(name) {
  const suite = qaSuiteManifest[name];
  if (!suite) throw new Error(`지원하지 않는 QA group입니다: ${name || '없음'} (허용: ${qaSuiteNames.join(', ')})`);
  return suite;
}
