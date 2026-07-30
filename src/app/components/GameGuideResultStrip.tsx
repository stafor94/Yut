import { getYutResultProbabilitiesForTiming } from '../../game-core/roll';

const NICE_YUT_RESULT_PROBABILITIES = getYutResultProbabilitiesForTiming('nice');
const YUT_RESULT_STEPS = {
  '빽도': -1,
  '도': 1,
  '개': 2,
  '걸': 3,
  '윷': 4,
  '모': 5,
} as const;

const formatProbability = (probability: number) => `${Number((probability * 100).toFixed(2))}%`;

export function GameGuideResultStrip() {
  return <div className="howto-result-strip" aria-label="윷 결과 이동 칸 수와 확률">
    {NICE_YUT_RESULT_PROBABILITIES.map(({ name, probability }) => {
      const steps = YUT_RESULT_STEPS[name];
      const probabilityText = formatProbability(probability);
      return <span key={name} aria-label={`${name} ${steps}칸 확률 ${probabilityText}`}>
        <b>{name}</b>
        <em className="howto-result-steps">{steps}칸</em>
        <small className="howto-result-probability">{probabilityText}</small>
      </span>;
    })}
  </div>;
}
