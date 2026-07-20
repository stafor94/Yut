export type RenderTaskBoundaryOptions = {
  now?: () => number;
  schedule?: (callback: () => void) => void;
};

export function waitForNextRenderTask({
  now = Date.now,
  schedule = (callback) => setTimeout(callback, 0),
}: RenderTaskBoundaryOptions = {}) {
  const startedAt = now();
  return new Promise<void>((resolve) => {
    const scheduleCheck = () => {
      schedule(() => {
        if (now() > startedAt) {
          resolve();
          return;
        }
        scheduleCheck();
      });
    };
    scheduleCheck();
  });
}
