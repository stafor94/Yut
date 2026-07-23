import type { YutResult } from '../../game-core/roll';

export type RollResultTone = 'standard' | 'bonus' | 'backdo' | 'fall';

type RollResultPresentationInput = {
  result: YutResult;
  fallCount: number;
  turnOrder?: boolean;
};

export type RollResultPresentation = {
  label: string;
  description: string;
  tone: RollResultTone;
  leadingSymbol: string;
  trailingSymbol: string;
};

const MOVE_DESCRIPTIONS: Partial<Record<YutResult['name'], string>> = {
  도: '1칸 이동',
  개: '2칸 이동',
  걸: '3칸 이동',
  윷: '4칸 이동 · 한 번 더',
  모: '5칸 이동 · 한 번 더',
  빽도: '1칸 뒤로',
  '황금 윷': '원하는 결과 선택',
};

export const getRollResultPresentation = ({ result, fallCount, turnOrder }: RollResultPresentationInput): RollResultPresentation => {
  if (fallCount > 0) {
    return {
      label: '낙',
      description: '던지기 실패',
      tone: 'fall',
      leadingSymbol: '',
      trailingSymbol: '',
    };
  }

  const isBackDo = result.name === '빽도';
  const isBonus = result.name === '윷' || result.name === '모' || result.name === '황금 윷';
  const fallbackDescription = result.steps < 0 ? `${Math.abs(result.steps)}칸 뒤로` : `${result.steps}칸 이동`;

  return {
    label: result.name,
    description: turnOrder ? '순서 결정' : MOVE_DESCRIPTIONS[result.name] ?? fallbackDescription,
    tone: isBackDo ? 'backdo' : isBonus ? 'bonus' : 'standard',
    leadingSymbol: isBackDo ? '↶' : '',
    trailingSymbol: isBonus ? '✦' : '',
  };
};