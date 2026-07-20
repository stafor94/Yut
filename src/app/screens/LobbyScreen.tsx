import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { User } from 'firebase/auth';
import { isRoomInGame, type RoomSummary } from '../../features/room/services/roomService';
import { getRoomRuleBadges, normalizeMaxPlayers } from '../appUtils';
import { NICKNAME_MAX_LENGTH, validateNickname } from '../appState';

type LobbyScreenProps = {
  title: string;
  rooms: RoomSummary[];
  isCreatingRoom: boolean;
  isFirebaseConfigured: boolean;
  currentUser: User | null;
  resumableRoomId: string;
  nickname: string;
  soundEnabled: boolean;
  onTitleChange: (title: string) => void;
  onCreateRoom: () => void;
  onOpenWaitingRoom: (room: RoomSummary) => Promise<void>;
  onJoinRoomByCode: (code: string) => Promise<void>;
  onNicknameChange: (nickname: string) => void;
  onSoundEnabledChange: (enabled: boolean) => void;
};

type LobbyDialog = 'create' | 'join' | 'howto' | 'settings' | null;

type LobbyActionIconProps = {
  type: 'create' | 'join' | 'guide' | 'settings';
};

const getErrorMessage = (error: unknown) => error instanceof Error && error.message
  ? error.message
  : '요청을 처리하지 못했습니다. 잠시 뒤 다시 시도해 주세요.';

function LobbyActionIcon({ type }: LobbyActionIconProps) {
  if (type === 'create') {
    return <svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="11" cy="11" r="5" /><circle cx="22" cy="12" r="4" /><path d="M3.5 27c.8-5.3 3.4-8 7.7-8s6.9 2.7 7.7 8M18.3 26.5c.4-3.7 2.2-5.8 5.3-5.8 2.8 0 4.5 1.7 5 5" /></svg>;
  }
  if (type === 'join') {
    return <svg viewBox="0 0 32 32" aria-hidden="true"><path d="M18 6h8v20h-8" /><path d="M4 16h16M14 10l6 6-6 6" /></svg>;
  }
  if (type === 'guide') {
    return <svg viewBox="0 0 32 32" aria-hidden="true"><path d="M4 6.5c5-1.2 8-.3 12 2.2v18c-4-2.5-7-3.4-12-2.2zM28 6.5c-5-1.2-8-.3-12 2.2v18c4-2.5 7-3.4 12-2.2z" /></svg>;
  }
  return <svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="4.5" /><path d="M16 3.5v4M16 24.5v4M3.5 16h4M24.5 16h4M7.2 7.2l2.8 2.8M22 22l2.8 2.8M24.8 7.2 22 10M10 22l-2.8 2.8" /></svg>;
}

function LobbyHeroScene() {
  const routeDots = [
    [151, 388], [205, 388], [259, 388], [313, 388], [367, 388], [421, 388], [475, 388], [529, 388], [583, 388],
    [151, 338], [151, 288], [151, 238], [583, 338], [583, 288], [583, 238],
    [205, 338], [259, 305], [313, 272], [421, 272], [475, 305], [529, 338],
  ];

  return <div className="lobby-scene" data-testid="lobby-hero-art" role="img" aria-label="윷판 위로 네 개의 윷가락이 떠오르는 장면">
    <svg viewBox="0 0 740 500" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="lobby-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#fffaf0" /><stop offset="1" stopColor="#f5e8cd" /></linearGradient>
        <linearGradient id="lobby-table" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#c9823b" /><stop offset="1" stopColor="#8e4b22" /></linearGradient>
        <linearGradient id="lobby-board" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#ffe6a7" /><stop offset=".52" stopColor="#efc778" /><stop offset="1" stopColor="#d59b4d" /></linearGradient>
        <linearGradient id="lobby-stick" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#c97927" /><stop offset=".18" stopColor="#f0ad4c" /><stop offset=".52" stopColor="#ffd17d" /><stop offset=".8" stopColor="#e39735" /><stop offset="1" stopColor="#b9601d" /></linearGradient>
        <linearGradient id="lobby-bag" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#bb7836" /><stop offset="1" stopColor="#74401e" /></linearGradient>
        <radialGradient id="lobby-token-red"><stop offset="0" stopColor="#ef6b4f" /><stop offset="1" stopColor="#a92b24" /></radialGradient>
        <radialGradient id="lobby-token-blue"><stop offset="0" stopColor="#6095e8" /><stop offset="1" stopColor="#2453a6" /></radialGradient>
        <filter id="lobby-soft-shadow" x="-40%" y="-40%" width="180%" height="180%"><feDropShadow dx="0" dy="12" stdDeviation="10" floodColor="#542a12" floodOpacity=".25" /></filter>
        <filter id="lobby-stick-shadow" x="-60%" y="-60%" width="220%" height="220%"><feDropShadow dx="0" dy="12" stdDeviation="9" floodColor="#5b2b10" floodOpacity=".3" /></filter>
      </defs>

      <rect width="740" height="500" rx="42" fill="url(#lobby-sky)" />
      <g className="lobby-scene-clouds" fill="#efe3c8" opacity=".7"><path d="M24 95c7-22 25-34 47-30 10-26 50-25 61 2 24-5 43 8 48 28z" /><path d="M565 120c7-18 22-27 40-24 10-24 45-22 55 3 22-3 38 9 43 26z" /><path d="M-8 214c8-18 25-27 42-22 12-29 52-24 61 4 20-2 34 10 39 25H-8z" /></g>
      <g className="lobby-scene-hills"><path d="M0 402c77-67 123-54 182-17 54-64 118-82 185-21 56-62 123-59 192 1 61-35 114-27 181 31v104H0z" fill="#c8b77b" opacity=".38" /><path d="M0 428c75-37 129-35 194 8 69-58 127-52 189 0 63-51 135-44 183 7 68-32 119-23 174 13v44H0z" fill="#8fa25f" opacity=".57" /></g>
      <path d="M0 352h740v148H0z" fill="url(#lobby-table)" />
      <g opacity=".14" stroke="#4c2410" strokeWidth="2"><path d="M0 378h740M0 411h740M0 447h740M0 481h740" /><path d="M70 352v148M228 352v148M397 352v148M579 352v148" /></g>

      <g className="lobby-scene-board" filter="url(#lobby-soft-shadow)">
        <rect x="117" y="211" width="500" height="209" rx="20" fill="#7b431f" opacity=".35" />
        <rect x="125" y="203" width="500" height="209" rx="20" fill="url(#lobby-board)" stroke="#9a5c29" strokeWidth="7" />
        <rect x="140" y="218" width="470" height="179" rx="14" fill="none" stroke="#b57936" strokeWidth="3" />
        <g fill="none" stroke="#a86b2e" strokeWidth="4" strokeLinecap="round" opacity=".74"><path d="M151 238v150h432V238z" /><path d="M151 238 367 388 583 238M151 388 367 238 583 388" /></g>
        <g fill="#aa6b2e" opacity=".93">{routeDots.map(([cx, cy], index) => <circle key={`${cx}-${cy}-${index}`} cx={cx} cy={cy} r={index % 8 === 0 ? 11 : 7} />)}<circle cx="367" cy="313" r="15" /></g>
        <g fill="#f7d895" opacity=".45"><path d="M162 248h35l-35 31zM572 248h-35l35 31zM162 379h35l-35-31zM572 379h-35l35-31z" /></g>
      </g>

      <g className="lobby-scene-bag" filter="url(#lobby-soft-shadow)"><path d="M43 280c-9 21-11 70 1 104 13 34 82 36 102 4 17-28 11-87-5-110-23 10-76 10-98 2z" fill="url(#lobby-bag)" /><path d="M42 279c15 15 82 15 101-2-12-22-26-31-48-29-24-2-41 8-53 31z" fill="#9c5d2b" /><path d="M53 290c25-11 60-11 81 0" fill="none" stroke="#ddb06b" strokeWidth="8" strokeLinecap="round" /><path d="M66 286c8 18 16 23 29 29M122 286c-8 18-16 23-29 29" fill="none" stroke="#e0b670" strokeWidth="5" strokeLinecap="round" /></g>
      <g className="lobby-scene-tokens" filter="url(#lobby-soft-shadow)"><ellipse cx="662" cy="380" rx="40" ry="13" fill="#6f3218" opacity=".27" /><ellipse cx="660" cy="368" rx="37" ry="16" fill="url(#lobby-token-red)" stroke="#8e2520" strokeWidth="4" /><ellipse cx="691" cy="411" rx="40" ry="13" fill="#532f1f" opacity=".25" /><ellipse cx="688" cy="399" rx="38" ry="17" fill="url(#lobby-token-blue)" stroke="#214b94" strokeWidth="4" /></g>

      <g className="lobby-scene-float lobby-scene-float-one" data-testid="lobby-yut-stick-1" filter="url(#lobby-stick-shadow)"><g transform="translate(235 122) rotate(-36)"><rect x="-25" y="-76" width="50" height="152" rx="24" fill="url(#lobby-stick)" stroke="#ad5d1f" strokeWidth="4" /><path d="M-10-38 10-20M10-38-10-20M-10 5 10 23M10 5-10 23" stroke="#754019" strokeWidth="7" strokeLinecap="round" /></g></g>
      <g className="lobby-scene-float lobby-scene-float-two" data-testid="lobby-yut-stick-2" filter="url(#lobby-stick-shadow)"><g transform="translate(340 117) rotate(-18)"><rect x="-26" y="-82" width="52" height="164" rx="25" fill="url(#lobby-stick)" stroke="#ad5d1f" strokeWidth="4" /><path d="M-11-44 11-22M11-44-11-22M-11 0 11 22M11 0-11 22M-11 42 11 64M11 42-11 64" stroke="#754019" strokeWidth="7" strokeLinecap="round" /></g></g>
      <g className="lobby-scene-float lobby-scene-float-three" data-testid="lobby-yut-stick-3" filter="url(#lobby-stick-shadow)"><g transform="translate(463 117) rotate(18)"><rect x="-26" y="-84" width="52" height="168" rx="25" fill="url(#lobby-stick)" stroke="#ad5d1f" strokeWidth="4" /><path d="M-11-48 11-26M11-48-11-26M-11-3 11 19M11-3-11 19M-11 42 11 64M11 42-11 64" stroke="#754019" strokeWidth="7" strokeLinecap="round" /></g></g>
      <g className="lobby-scene-float lobby-scene-float-four" data-testid="lobby-yut-stick-4" filter="url(#lobby-stick-shadow)"><g transform="translate(548 146) rotate(34)"><rect x="-25" y="-78" width="50" height="156" rx="24" fill="url(#lobby-stick)" stroke="#ad5d1f" strokeWidth="4" /><path d="M-10-38 10-20M10-38-10-20M-10 4 10 22M10 4-10 22M-10 42 10 60M10 42-10 60" stroke="#754019" strokeWidth="7" strokeLinecap="round" /></g></g>
    </svg>
  </div>;
}

export function LobbyScreen({ title, rooms, isCreatingRoom, isFirebaseConfigured, currentUser, resumableRoomId, nickname, soundEnabled, onTitleChange, onCreateRoom, onOpenWaitingRoom, onJoinRoomByCode, onNicknameChange, onSoundEnabledChange }: LobbyScreenProps) {
  const [dialog, setDialog] = useState<LobbyDialog>(null);
  const [waitingOnly, setWaitingOnly] = useState(false);
  const [includeSpectatable, setIncludeSpectatable] = useState(true);
  const [code, setCode] = useState('');
  const [joinPending, setJoinPending] = useState(false);
  const [joiningRoomId, setJoiningRoomId] = useState('');
  const [joinMessage, setJoinMessage] = useState('');
  const [settingsDraft, setSettingsDraft] = useState(nickname);
  const [settingsMessage, setSettingsMessage] = useState('');
  const dialogRef = useRef<HTMLElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const nicknameValidation = validateNickname(settingsDraft);

  const closeDialog = useCallback(() => setDialog(null), []);
  const openDialog = useCallback((nextDialog: Exclude<LobbyDialog, null>) => {
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setJoinMessage('');
    setDialog(nextDialog);
  }, []);
  const openSettings = useCallback(() => {
    setSettingsDraft(nickname);
    setSettingsMessage('');
    openDialog('settings');
  }, [nickname, openDialog]);

  useEffect(() => {
    const handleOpenSettings = () => openSettings();
    window.addEventListener('yut:lobby-settings', handleOpenSettings);
    return () => window.removeEventListener('yut:lobby-settings', handleOpenSettings);
  }, [openSettings]);

  useEffect(() => {
    if (!dialog) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const frame = window.requestAnimationFrame(() => {
      const initialFocus = dialogRef.current?.querySelector<HTMLElement>('[data-dialog-autofocus], input, button, [href], select, textarea');
      initialFocus?.focus();
    });
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeDialog();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), [href], select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previousFocusRef.current?.focus();
    };
  }, [closeDialog, dialog]);

  const visibleRooms = useMemo(() => rooms.filter((room) => (!waitingOnly || !isRoomInGame(room)) && (includeSpectatable || !isRoomInGame(room))), [includeSpectatable, rooms, waitingOnly]);
  const getLobbyRoomBadges = (room: RoomSummary) => getRoomRuleBadges(room.playMode, normalizeMaxPlayers(room.maxPlayers, room.playMode), room.pieceCount ?? 4, room.itemMode, Boolean(room.stackedRollMode));
  const getLobbyRoomOccupancy = (room: RoomSummary) => {
    const maxPlayers = normalizeMaxPlayers(room.maxPlayers, room.playMode);
    const rawCurrentPlayers = Number(room.currentPlayers ?? room.playerIds?.length ?? 0);
    const currentPlayers = Number.isFinite(rawCurrentPlayers) ? Math.min(maxPlayers, Math.max(0, Math.trunc(rawCurrentPlayers))) : 0;
    return { currentPlayers, maxPlayers, label: `${currentPlayers}/${maxPlayers}명` };
  };
  const getRoomActionText = (room: RoomSummary) => {
    if (isFirebaseConfigured && !currentUser) return '준비 중';
    if (!isRoomInGame(room)) return '참가';
    return currentUser && resumableRoomId === room.id && room.playerIds?.includes(currentUser.uid) ? '참가' : '관전';
  };
  const saveSettingsNickname = () => {
    if (!nicknameValidation.valid) return;
    onNicknameChange(nicknameValidation.value);
    setSettingsMessage('닉네임이 저장되었습니다.');
  };
  const submitCode = async () => {
    if (joinPending) return;
    setJoinPending(true);
    setJoinMessage('');
    try {
      await onJoinRoomByCode(code);
    } catch (error) {
      setJoinMessage(getErrorMessage(error));
    } finally {
      setJoinPending(false);
    }
  };
  const openRoom = async (room: RoomSummary) => {
    if (joinPending) return;
    setJoinPending(true);
    setJoiningRoomId(room.id);
    setJoinMessage('');
    try {
      await onOpenWaitingRoom(room);
    } catch (error) {
      setJoinMessage(getErrorMessage(error));
    } finally {
      setJoinPending(false);
      setJoiningRoomId('');
    }
  };

  return <section data-testid="lobby-screen" className="lobby-layout premium-lobby lobby-start" aria-label="윷놀이 시작 화면">
    <section className="lobby-hero-panel">
      <header className="lobby-brand">
        <div className="lobby-brand-title-row"><span className="lobby-brand-stick lobby-brand-stick-left" aria-hidden="true">×××</span><h1>윷놀이</h1><span className="lobby-brand-stick lobby-brand-stick-right" aria-hidden="true">××</span></div>
        <p>친구들과 바로 즐기는 <strong>온라인 윷놀이</strong></p>
      </header>
      <LobbyHeroScene />
      <div className="lobby-primary-actions" aria-label="로비 주요 기능">
        <button className="lobby-main-action lobby-create-action" type="button" aria-label="방 만들기" onClick={() => openDialog('create')}><span className="lobby-action-icon"><LobbyActionIcon type="create" /></span><span className="lobby-action-copy"><strong>방 만들기</strong><small>새 게임을 시작해요</small></span><span className="lobby-action-arrow" aria-hidden="true">›</span></button>
        <button className="lobby-main-action lobby-join-action" type="button" aria-label="게임 참가" onClick={() => openDialog('join')}><span className="lobby-action-icon"><LobbyActionIcon type="join" /></span><span className="lobby-action-copy"><strong>방 코드로 참가</strong><small>초대받은 방에 들어가요</small></span><span className="lobby-action-arrow" aria-hidden="true">›</span></button>
      </div>
      <nav className="lobby-secondary-actions" aria-label="로비 보조 기능"><button type="button" aria-label="게임 방법" onClick={() => openDialog('howto')}><LobbyActionIcon type="guide" /><span>게임 방법 보기</span></button><span className="lobby-action-divider" aria-hidden="true"></span><button type="button" aria-label="설정" onClick={openSettings}><LobbyActionIcon type="settings" /><span>설정</span></button></nav>
    </section>

    {dialog === 'create' && <div className="lobby-sheet-backdrop" role="presentation" onMouseDown={closeDialog}><section ref={dialogRef} className="panel lobby-sheet" role="dialog" aria-modal="true" aria-label="방 만들기" onMouseDown={(event) => event.stopPropagation()}><button className="sheet-close" type="button" onClick={closeDialog} aria-label="닫기">×</button><p className="section-kicker">방 만들기</p><h2>새 방 만들기</h2><div className="form-grid lobby-form"><label htmlFor="room-title-input">방 제목<input id="room-title-input" data-testid="room-title-input" data-dialog-autofocus value={title} onChange={(event) => onTitleChange(event.target.value)} placeholder="친구들과 윷놀이" /></label><button data-testid="create-room-button" className="primary-cta create-room-submit-button" onClick={onCreateRoom} disabled={isCreatingRoom}>{isCreatingRoom ? <span className="button-loading" aria-hidden="true"></span> : null}{isCreatingRoom ? '생성 중...' : '방 생성하기'}</button></div></section></div>}

    {dialog === 'join' && <div className="lobby-sheet-backdrop" role="presentation" onMouseDown={closeDialog}><section ref={dialogRef} className="panel lobby-sheet lobby-join-sheet" role="dialog" aria-modal="true" aria-label="게임 참가" onMouseDown={(event) => event.stopPropagation()}><button className="sheet-close" type="button" onClick={closeDialog} aria-label="닫기">×</button><p className="section-kicker">게임 참가</p><h2>공개 방 찾기</h2><div className="code-join-row"><input data-dialog-autofocus value={code} onChange={(event) => { setCode(event.target.value); setJoinMessage(''); }} onKeyDown={(event) => { if (event.key === 'Enter') void submitCode(); }} placeholder="방 코드 입력" aria-label="방 코드 입력" /><button onClick={() => { void submitCode(); }} disabled={!code.trim() || joinPending}>{joinPending && !joiningRoomId ? '확인 중...' : '참가'}</button></div><div className="lobby-filter-row"><label><input type="checkbox" checked={waitingOnly} onChange={(event) => setWaitingOnly(event.target.checked)} /> 대기 중인 방만</label><label><input type="checkbox" checked={includeSpectatable} onChange={(event) => setIncludeSpectatable(event.target.checked)} /> 관전 가능 포함</label><span className="lobby-live-status" role="status">실시간 자동 갱신</span></div>{joinMessage && <p className="settings-feedback" role="alert">{joinMessage}</p>}<div className="room-list lobby-room-list">{visibleRooms.length ? visibleRooms.map((room) => { const badges = getLobbyRoomBadges(room); const occupancy = getLobbyRoomOccupancy(room); const roomStatus = isRoomInGame(room) ? '게임중' : '대기중'; return <article className="room-card lobby-room-card" key={room.id}><div className="lobby-room-content"><div className="lobby-room-main"><div className="lobby-room-title-row"><span className={`lobby-room-state-dot ${isRoomInGame(room) ? 'in-game' : 'waiting'}`} role="img" aria-label={roomStatus} title={roomStatus}></span><b>{room.title}</b></div><span className="lobby-room-meta" aria-label={`방 옵션: ${badges.map((badge) => badge.label).join(', ')}, 현재 인원 ${occupancy.currentPlayers}/${occupancy.maxPlayers}`}>{roomStatus} · {badges.map((badge) => badge.label).join(' · ')}</span></div><span className="lobby-room-occupancy" aria-label={`현재 인원 ${occupancy.currentPlayers}/${occupancy.maxPlayers}`}>{occupancy.label}</span><button className="lobby-room-action" disabled={(isFirebaseConfigured && !currentUser) || joinPending} onClick={() => { void openRoom(room); }}>{joiningRoomId === room.id ? '입장 중...' : getRoomActionText(room)}</button></div></article>; }) : <div className="empty-lobby-room"><strong>표시할 공개 방이 없습니다</strong><p>방 목록은 실시간으로 갱신됩니다. 직접 방을 만들어 보세요.</p></div>}</div></section></div>}

    {dialog === 'howto' && <div className="lobby-sheet-backdrop" role="presentation" onMouseDown={closeDialog}>
      <section ref={dialogRef} className="panel lobby-sheet lobby-howto-sheet" role="dialog" aria-modal="true" aria-label="게임 방법" onMouseDown={(event) => event.stopPropagation()}>
        <header className="lobby-sheet-heading">
          <span className="lobby-sheet-emblem" aria-hidden="true"><LobbyActionIcon type="guide" /></span>
          <div><p className="section-kicker">처음이어도 쉬워요</p><h2>게임 방법</h2><p className="lobby-sheet-lead">방에 모여 윷을 던지고, 내 말을 먼저 모두 완주시키면 승리합니다.</p></div>
          <button className="sheet-close" type="button" onClick={closeDialog} aria-label="닫기">×</button>
        </header>
        <div className="howto-result-strip" aria-label="윷 결과 이동 칸 수"><span><b>도</b>1칸</span><span><b>개</b>2칸</span><span><b>걸</b>3칸</span><span><b>윷</b>4칸</span><span><b>모</b>5칸</span></div>
        <div className="howto-list">
          <article><span className="howto-step">01</span><div className="howto-icon" role="img" aria-label="방 만들기 도식">＋</div><div><h3>방에 모이기</h3><p>방을 만들거나 방 코드로 참가합니다. 방장은 인원과 규칙을 정한 뒤 게임을 시작합니다.</p></div></article>
          <article><span className="howto-step">02</span><div className="howto-icon howto-yut-icon" role="img" aria-label="윷 결과 도식">도개걸<br />윷모</div><div><h3>윷 던지기</h3><p>결과만큼 이동합니다. 윷·모가 나오거나 상대 말을 잡으면 한 번 더 던질 수 있습니다.</p></div></article>
          <article><span className="howto-step">03</span><div className="howto-icon" role="img" aria-label="말 이동 도식">●→●</div><div><h3>말 이동하기</h3><p>갈림길에서 경로를 고르고, 같은 편 말은 업어서 함께 이동합니다. 낙이면 이동하지 못합니다.</p></div></article>
          <article><span className="howto-step">04</span><div className="howto-icon" role="img" aria-label="재접속 도식">↻</div><div><h3>재접속과 관전</h3><p>잠시 나가도 AI가 이어서 진행하고, 돌아오면 통제권을 복구합니다. 진행 중인 방은 관전할 수 있습니다.</p></div></article>
        </div>
        <aside className="howto-tip"><span aria-hidden="true">✦</span><p><strong>승리 조건</strong> 내 말 전부를 출발점에서 꺼내 윷판을 돌아 완주시키세요.</p></aside>
        <button className="primary-cta howto-confirm-button" type="button" onClick={closeDialog}>확인하고 시작하기</button>
      </section>
    </div>}

    {dialog === 'settings' && <div className="lobby-sheet-backdrop nickname-dialog-backdrop" role="presentation" onMouseDown={closeDialog}>
      <section ref={dialogRef} className="panel lobby-sheet lobby-settings-sheet nickname-modal" role="dialog" aria-modal="true" aria-label="설정" onMouseDown={(event) => event.stopPropagation()}>
        <header className="lobby-sheet-heading">
          <span className="lobby-sheet-emblem" aria-hidden="true"><LobbyActionIcon type="settings" /></span>
          <div><p className="section-kicker">내 게임 환경</p><h2>설정</h2><p className="lobby-sheet-lead">닉네임과 효과음을 한곳에서 관리합니다.</p></div>
          <button className="sheet-close" type="button" onClick={closeDialog} aria-label="취소">×</button>
        </header>
        <div className="settings-card-grid">
          <section className="settings-card settings-profile-card">
            <div className="settings-card-heading"><span aria-hidden="true">👤</span><div><strong>플레이어 정보</strong><small>게임에서 표시할 이름</small></div></div>
            <label className="settings-field" htmlFor="settings-nickname">닉네임<input id="settings-nickname" data-dialog-autofocus value={settingsDraft} maxLength={NICKNAME_MAX_LENGTH} onChange={(event) => { setSettingsDraft(event.target.value); setSettingsMessage(''); }} onKeyDown={(event) => { if (event.key === 'Enter') saveSettingsNickname(); }} aria-invalid={!nicknameValidation.valid} /></label>
            <div className={`settings-validation ${nicknameValidation.valid ? 'valid' : 'invalid'}`}><span aria-hidden="true">{nicknameValidation.valid ? '✓' : '!'}</span><p className="nickname-helper">{nicknameValidation.valid ? '사용 가능한 닉네임입니다.' : nicknameValidation.message}</p><small>{settingsDraft.length}/{NICKNAME_MAX_LENGTH}</small></div>
          </section>
          <section className="settings-card settings-sound-card">
            <div className="settings-card-heading"><span aria-hidden="true">♫</span><div><strong>효과음</strong><small>윷 던지기와 알림 소리</small></div></div>
            <label className="lobby-sound-switch"><span className="sound-switch-copy"><b>게임 효과음</b><small>{soundEnabled ? '생생한 소리와 함께 플레이합니다.' : '모든 게임 효과음을 끕니다.'}</small></span><input type="checkbox" checked={soundEnabled} onChange={(event) => onSoundEnabledChange(event.target.checked)} /><span className="sound-switch-track" aria-hidden="true"><span></span></span><strong>{soundEnabled ? '켜짐' : '꺼짐'}</strong></label>
          </section>
        </div>
        <div className="settings-actions"><button className="primary-cta settings-save-button" type="button" aria-label="닉네임 저장" onClick={saveSettingsNickname} disabled={!nicknameValidation.valid}>변경사항 저장</button>{settingsMessage && <p className="settings-feedback" role="status"><span aria-hidden="true">✓</span>{settingsMessage}</p>}</div>
      </section>
    </div>}
  </section>;
}
