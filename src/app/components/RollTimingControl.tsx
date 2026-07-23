import { useRef } from 'react';

type RollTimingControlProps = {
  disabled?: boolean;
  buttonText: string;
  buttonTestId: string;
  resetKey?: string;
  onRoll: (timingPositionPercent?: number) => void;
};

const clampPercent = (value: number) => Math.max(0, Math.min(100, value));

export function RollTimingControl({ disabled = false, buttonText, buttonTestId, resetKey = '', onRoll }: RollTimingControlProps) {
  const meterRef = useRef<HTMLDivElement | null>(null);
  const orbRef = useRef<HTMLSpanElement | null>(null);

  const getVisibleRollTimingPositionPercent = () => {
    const meter = meterRef.current;
    const orb = orbRef.current;
    if (!meter || !orb) return undefined;
    const meterRect = meter.getBoundingClientRect();
    const orbRect = orb.getBoundingClientRect();
    if (meterRect.width <= 0) return undefined;
    const orbCenterX = orbRect.left + orbRect.width / 2;
    return clampPercent(((orbCenterX - meterRect.left) / meterRect.width) * 100);
  };

  return <>
    <div key={`meter:${resetKey}`} ref={meterRef} className="roll-timing-meter" aria-label="윷 던지기 정확도 막대">
      <span className="roll-timing-good left" aria-hidden="true"></span>
      <span className="roll-timing-perfect" aria-hidden="true"></span>
      <span className="roll-timing-good right" aria-hidden="true"></span>
      <span ref={orbRef} className="roll-timing-orb" aria-hidden="true"></span>
    </div>
    <button type="button" data-testid={buttonTestId} className="roll-button" onClick={() => onRoll(getVisibleRollTimingPositionPercent())} disabled={disabled}>{buttonText}</button>
  </>;
}
