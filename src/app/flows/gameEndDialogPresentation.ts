let gameEndDialogOpenHandler: (() => void) | null = null;

export function publishGameEndDialogOpenHandler(handler: () => void) {
  gameEndDialogOpenHandler = handler;
  return () => {
    if (gameEndDialogOpenHandler === handler) gameEndDialogOpenHandler = null;
  };
}

export function requestGameEndDialogOpen() {
  gameEndDialogOpenHandler?.();
}
