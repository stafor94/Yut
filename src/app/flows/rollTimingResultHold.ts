export const ROLL_TIMING_RESULT_HOLD_MS = 1000;

type RollTimingMeterRect = {
  top: number;
  left: number;
  width: number;
  height: number;
};

export const getRollTimingResultHoldStyle = (rect: RollTimingMeterRect) => ({
  position: 'fixed',
  top: `${rect.top}px`,
  left: `${rect.left}px`,
  width: `${rect.width}px`,
  height: `${rect.height}px`,
  margin: '0',
  pointerEvents: 'none',
  zIndex: '1000',
} as const);
