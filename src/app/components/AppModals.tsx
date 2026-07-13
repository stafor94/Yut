import type { CSSProperties } from 'react';
import { ItemCard } from '../../features/items/components/ItemCard';
import { NICKNAME_MAX_LENGTH, type PendingItemPickup } from '../appState';
import { splitMessageBySentence } from '../appUtils';

type RoomNoticeDialog = {
  title: string;
  message: string;
};

type AppModalsProps = {
  actionErrorDialog: string;
  diagnosticCopied: boolean;
  diagnosticDialogOpen: boolean;
  diagnosticText: string;
  sequenceExportCopied: boolean;
  sequenceExportDialogOpen: boolean;
  sequenceExportText: string;
  endGameDialogOpen: boolean;
  gameExitDescription: string;
  itemPickupClock: number;
  loadingMessage: string;
  nicknameDialogOpen: boolean;
  nicknameDraft: string;
  pendingItemPickup: PendingItemPickup | null;
  roomNoticeDialog: RoomNoticeDialog | null;
  screen: 'lobby' | 'waitingRoom' | 'game';
  onClearActionErrorDialog: () => void;
  onCloseDiagnosticDialog: () => void;
  onCloseEndGameDialog: () => void;
  onCloseNicknameDialog: () => void;
  onClearRoomNoticeDialog: () => void;
  onCopyDiagnosticState: () => void;
  onCloseSequenceExportDialog: () => void;
  onCopySequenceExportState: () => void;
  onFinishGame: () => void;
  onKeepPendingItemPickup: () => void;
  onNicknameDraftChange: (nextNicknameDraft: string) => void;
  onReplacePendingItemPickup: () => void;
  onSaveNickname: () => void;
};

export function AppModals({ actionErrorDialog, diagnosticCopied, diagnosticDialogOpen, diagnosticText, sequenceExportCopied, sequenceExportDialogOpen, sequenceExportText, endGameDialogOpen, gameExitDescription, itemPickupClock, loadingMessage, nicknameDialogOpen, nicknameDraft, pendingItemPickup, roomNoticeDialog, screen, onClearActionErrorDialog, onCloseDiagnosticDialog, onCloseEndGameDialog, onCloseNicknameDialog, onClearRoomNoticeDialog, onCopyDiagnosticState, onCloseSequenceExportDialog, onCopySequenceExportState, onFinishGame, onKeepPendingItemPickup, onNicknameDraftChange, onReplacePendingItemPickup, onSaveNickname }: AppModalsProps) {
  const resolvedGameExitDescription = gameExitDescription.includes('모든 사람 플레이어가 나가면')
    ? '현재 방에서 나가 로비로 이동합니다. 방장이라면 생성한 방도 함께 종료됩니다.'
    : gameExitDescription;

  return <>
    {loadingMessage && <div className="loading-modal-backdrop" role="presentation"><section className="loading-modal panel" role="status" aria-live="polite" aria-label={loadingMessage}><span className="loading-modal-spinner" aria-hidden="true"></span><p>{splitMessageBySentence(loadingMessage).map((sentence) => <span key={sentence}>{sentence}</span>)}</p></section></div>}

    {actionErrorDialog && <div className="modal-backdrop" role="presentation" onMouseDown={onClearActionErrorDialog}><section className="nickname-modal panel" role="alertdialog" aria-modal="true" aria-label="액션 오류" onMouseDown={(event) => event.stopPropagation()}><p className="section-kicker">오류</p><h2>요청을 처리할 수 없습니다</h2><p>{actionErrorDialog}</p><div className="modal-actions"><button onClick={onClearActionErrorDialog}>확인</button></div></section></div>}
    {roomNoticeDialog && <div className="modal-backdrop" role="presentation" onMouseDown={onClearRoomNoticeDialog}><section className="nickname-modal panel" role="alertdialog" aria-modal="true" aria-label={roomNoticeDialog.title} onMouseDown={(event) => event.stopPropagation()}><p className="section-kicker">방 알림</p><h2>{roomNoticeDialog.title}</h2><p>{roomNoticeDialog.message}</p><div className="modal-actions"><button onClick={onClearRoomNoticeDialog}>확인</button></div></section></div>}
    {sequenceExportDialogOpen && <div className="modal-backdrop" role="presentation" onMouseDown={onCloseSequenceExportDialog}><section className="diagnostic-modal panel" role="dialog" aria-modal="true" aria-label="최신 상태와 전체 sequence" onMouseDown={(event) => event.stopPropagation()}><p className="section-kicker">Sequence Export</p><h2>최신 상태와 전체 sequence</h2><p className="diagnostic-description">Firebase에서 현재 상태와 전체 sequence 배열을 다시 내려받았습니다. 아래 내용을 복사해 전달할 수 있습니다.</p><pre className="diagnostic-raw">{sequenceExportText}</pre><div className="modal-actions"><button onClick={onCopySequenceExportState}>{sequenceExportCopied ? '복사 완료' : '복사'}</button><button className="secondary" onClick={onCloseSequenceExportDialog}>닫기</button></div></section></div>}

    {diagnosticDialogOpen && <div className="modal-backdrop" role="presentation" onMouseDown={onCloseDiagnosticDialog}><section className="diagnostic-modal panel" role="dialog" aria-modal="true" aria-label="게임 상태 분석 요청 데이터" onMouseDown={(event) => event.stopPropagation()}><p className="section-kicker">분석 요청</p><h2>게임 상태 분석 데이터</h2><p className="diagnostic-description">아래 텍스트를 복사해 시스템에 전달하면 에러 원인 분석에 사용할 수 있습니다.</p><pre className="diagnostic-raw">{diagnosticText}</pre><div className="modal-actions"><button onClick={onCopyDiagnosticState}>{diagnosticCopied ? '복사 완료' : '복사'}</button><button className="secondary" onClick={onCloseDiagnosticDialog}>닫기</button></div></section></div>}

    {nicknameDialogOpen && screen === 'lobby' && <div className="modal-backdrop nickname-dialog-backdrop" role="presentation" onMouseDown={onCloseNicknameDialog}><section className="nickname-modal panel" role="dialog" aria-modal="true" aria-label="닉네임 수정" onMouseDown={(event) => event.stopPropagation()}><p className="section-kicker">닉네임</p><h2>닉네임 수정</h2><p>닉네임은 7글자까지 사용할 수 있어요.</p><input value={nicknameDraft} onChange={(event) => onNicknameDraftChange(event.target.value.slice(0, NICKNAME_MAX_LENGTH))} onKeyDown={(event) => { if (event.key === 'Enter') onSaveNickname(); if (event.key === 'Escape') onCloseNicknameDialog(); }} autoFocus maxLength={NICKNAME_MAX_LENGTH} placeholder="닉네임" /><div className="modal-actions"><button onClick={onSaveNickname}>저장</button><button className="secondary" onClick={onCloseNicknameDialog}>취소</button></div></section></div>}

    {pendingItemPickup && <div className="modal-backdrop" role="presentation"><section className="nickname-modal panel" role="dialog" aria-modal="true" aria-label="아이템 교체 선택"><p className="section-kicker">아이템 한도</p><h2>아이템을 교체할까요?</h2><p>같은 사용 조건의 아이템은 1개만 보유할 수 있습니다. 10초 뒤 자동으로 유지합니다.</p><div className="time-limit-bar item-prompt-timer" style={{ '--timer-duration': `${Math.max(0, pendingItemPickup.deadline - itemPickupClock)}ms` } as CSSProperties} aria-hidden="true"><span></span></div><div className="item-replace-preview"><div><strong>기존 아이템</strong><ItemCard type={pendingItemPickup.existingItem} /></div><div><strong>새 아이템</strong><ItemCard type={pendingItemPickup.item} /></div></div><div className="inline-item-actions"><button onClick={onReplacePendingItemPickup}>교체</button><button className="secondary" onClick={onKeepPendingItemPickup}>유지</button></div></section></div>}

    {endGameDialogOpen && screen === 'game' && <div className="modal-backdrop" role="presentation" onMouseDown={onCloseEndGameDialog}><section className="nickname-modal panel" role="dialog" aria-modal="true" aria-label="게임 종료 확인" onMouseDown={(event) => event.stopPropagation()}><p className="section-kicker">게임 종료</p><h2>정말 윷판을 정리할까요?</h2><p>{resolvedGameExitDescription}</p><div className="modal-actions"><button className="danger" onClick={onFinishGame}>게임 종료</button><button className="secondary" onClick={onCloseEndGameDialog}>계속하기</button></div></section></div>}
  </>;
}
