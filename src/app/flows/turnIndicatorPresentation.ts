export type TurnIndicatorNeighborVisibilityInput = {
  showNeighbors: boolean;
  fallPresentationActive: boolean;
  preserveFallNeighborsForDisplayedTurn: boolean;
};

export function shouldRenderTurnIndicatorNeighbors({
  showNeighbors,
  fallPresentationActive,
  preserveFallNeighborsForDisplayedTurn,
}: TurnIndicatorNeighborVisibilityInput) {
  return showNeighbors || fallPresentationActive || preserveFallNeighborsForDisplayedTurn;
}
