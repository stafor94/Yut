export const qaPerformanceBudget = Object.freeze({
  workflow: Object.freeze({
    targetSeconds: 300,
    hardLimitSeconds: 315,
  }),
  lanes: Object.freeze({
    'online-core': Object.freeze({ targetSeconds: 210 }),
    'desktop-sequence': Object.freeze({ targetSeconds: 150 }),
    'desktop-regression': Object.freeze({ targetSeconds: 180 }),
    'mobile-galaxy': Object.freeze({ targetSeconds: 210 }),
    'safari-timing': Object.freeze({ targetSeconds: 180 }),
  }),
});
