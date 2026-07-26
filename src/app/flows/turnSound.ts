type LocalTurnSoundTransition = {
  currentActiveSeatId: string;
  localSeatId: string;
  actionReady: boolean;
  alreadyPlayed: boolean;
};

export const shouldPlayLocalTurnSound = ({
  currentActiveSeatId,
  localSeatId,
  actionReady,
  alreadyPlayed,
}: LocalTurnSoundTransition) => Boolean(
  actionReady
  && !alreadyPlayed
  && currentActiveSeatId
  && localSeatId
  && currentActiveSeatId === localSeatId
);
