let gameGuideDialogOpenHandler: (() => void) | null = null;

export function publishGameGuideDialogOpenHandler(handler: () => void) {
  gameGuideDialogOpenHandler = handler;
  return () => {
    if (gameGuideDialogOpenHandler === handler) gameGuideDialogOpenHandler = null;
  };
}

export function requestGameGuideDialogOpen() {
  gameGuideDialogOpenHandler?.();
}
