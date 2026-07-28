let gameStatisticsDialogOpenHandler: (() => void) | null = null;

export function publishGameStatisticsDialogOpenHandler(handler: () => void) {
  gameStatisticsDialogOpenHandler = handler;
  return () => {
    if (gameStatisticsDialogOpenHandler === handler) gameStatisticsDialogOpenHandler = null;
  };
}

export function requestGameStatisticsDialogOpen() {
  gameStatisticsDialogOpenHandler?.();
}
