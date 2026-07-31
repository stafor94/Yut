type OptimisticMoveRejectionInput = {
  actionType: string;
  status: string;
  hasPendingMove: boolean;
};

export const shouldResyncRejectedPendingMove = ({
  actionType,
  status,
  hasPendingMove,
}: OptimisticMoveRejectionInput) => (
  actionType === 'move_piece'
  && hasPendingMove
  && (status === 'rejected' || status === 'unsupported')
);
