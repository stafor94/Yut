export const qaProjectTestMatches = Object.freeze({
  'desktop-chromium': Object.freeze([
    /smoke\/.*\.spec\.js$/u,
    /lobby\/.*\.spec\.js$/u,
    /online\/.*\.spec\.js$/u,
    /game-flow\/.*\.spec\.js$/u,
    /regression\/.*\.spec\.js$/u,
  ]),
  'mobile-galaxy': Object.freeze([/mobile\/.*\.spec\.js$/u]),
  'mobile-webkit-timing': Object.freeze([
    /smoke\/firebase-emulator-isolation\.spec\.js$/u,
    /mobile\/roll-timing-pointer-capture\.spec\.js$/u,
  ]),
});

export const qaProjectExecutionOptions = Object.freeze({
  'desktop-chromium': Object.freeze({ fullyParallel: false }),
  'mobile-galaxy': Object.freeze({ fullyParallel: false }),
  'mobile-webkit-timing': Object.freeze({ fullyParallel: true }),
});

export const qaProjectNames = Object.freeze(Object.keys(qaProjectTestMatches));
