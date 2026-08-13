type OptimisticMoveRejectionInput = {
  actionType: string;
  status: string;
  hasPendingMove: boolean;
};

const DEADLINE_AUTO_MOVE_SUPERSEDED_REASON = '자동 입력 대상 제한시간이 현재 상태와 일치하지 않습니다.';

export const shouldResyncRejectedPendingMove = ({
  actionType,
  status,
  hasPendingMove,
}: OptimisticMoveRejectionInput) => (
  actionType === 'move_piece'
  && hasPendingMove
  && (status === 'rejected' || status === 'unsupported')
);

export const shouldReportRejectedPendingMoveResyncAsError = ({
  actionType,
  status,
  hasPendingMove,
  reason,
}: OptimisticMoveRejectionInput & { reason?: string }) => (
  shouldResyncRejectedPendingMove({ actionType, status, hasPendingMove })
  && reason !== DEADLINE_AUTO_MOVE_SUPERSEDED_REASON
);
