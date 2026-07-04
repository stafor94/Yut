import type { ReactNode } from 'react';

type WaitingRoomScreenProps = {
  canManageRoom: boolean;
  children: ReactNode;
};

export function WaitingRoomScreen({ canManageRoom, children }: WaitingRoomScreenProps) {
  return <section data-testid="waiting-room" className={`panel waiting-room compact-waiting-room ${canManageRoom ? 'host-view' : 'player-view'}`} aria-label="방 대기 화면">{children}</section>;
}
