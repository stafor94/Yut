export type GoldenYutPickerPresentationState = {
  dismissed: boolean;
  rollPresentationCompleted: boolean;
};

export const EMPTY_GOLDEN_YUT_PICKER_PRESENTATION_STATE: GoldenYutPickerPresentationState = {
  dismissed: false,
  rollPresentationCompleted: false,
};

export function dismissGoldenYutPicker(): GoldenYutPickerPresentationState {
  return {
    dismissed: true,
    rollPresentationCompleted: false,
  };
}

export function markGoldenYutRollPresentationCompleted(
  state: GoldenYutPickerPresentationState,
): GoldenYutPickerPresentationState {
  if (!state.dismissed || state.rollPresentationCompleted) return state;
  return { ...state, rollPresentationCompleted: true };
}

export function syncGoldenYutPickerOpenState(
  state: GoldenYutPickerPresentationState,
  isOpen: boolean,
): GoldenYutPickerPresentationState {
  if (isOpen || !state.dismissed || !state.rollPresentationCompleted) return state;
  return EMPTY_GOLDEN_YUT_PICKER_PRESENTATION_STATE;
}

export function shouldShowGoldenYutPicker(
  state: GoldenYutPickerPresentationState,
  isOpen: boolean,
) {
  return isOpen && !state.dismissed;
}
