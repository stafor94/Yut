type LocalTurnSoundTransition = {
  previousActiveSeatId: string;
  currentActiveSeatId: string;
  localSeatId: string;
};

export const shouldPlayLocalTurnSound = ({
  previousActiveSeatId,
  currentActiveSeatId,
  localSeatId,
}: LocalTurnSoundTransition) => Boolean(
  previousActiveSeatId
  && currentActiveSeatId
  && localSeatId
  && previousActiveSeatId !== currentActiveSeatId
  && previousActiveSeatId !== localSeatId
  && currentActiveSeatId === localSeatId
);
