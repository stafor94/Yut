import { useContext, type ComponentProps } from 'react';
import { MoveSubmissionPresentationContext } from '../flows/moveSubmissionPresentationContext';
import { GameBoardControls as GameBoardControlsCore } from './GameBoardControlsCore';

type GameBoardControlsProps = ComponentProps<typeof GameBoardControlsCore>;

export function GameBoardControls(props: GameBoardControlsProps) {
  const moveSubmissionPresentationPending = useContext(MoveSubmissionPresentationContext);
  const suppressMoveDeadlinePresentation = Boolean(
    moveSubmissionPresentationPending && props.turnDeadlineKind === 'move',
  );

  return (
    <GameBoardControlsCore
      {...props}
      turnDeadlineKind={suppressMoveDeadlinePresentation ? '' : props.turnDeadlineKind}
    />
  );
}
