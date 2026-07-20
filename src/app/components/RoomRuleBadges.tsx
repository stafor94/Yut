import type { PieceCount, PlayMode } from '../appState';
import { formatRoomRuleText, getRoomRuleBadges } from '../appUtils';

type RoomRuleBadgesProps = {
  mode: PlayMode;
  players: 2 | 3 | 4;
  pieces: PieceCount;
  itemsEnabled: boolean;
  stackedRollEnabled?: boolean;
  className?: string;
  as?: 'p' | 'span';
};

export function RoomRuleBadges({
  mode,
  players,
  pieces,
  itemsEnabled,
  stackedRollEnabled = false,
  className = '',
  as = 'span',
}: RoomRuleBadgesProps) {
  const roomRuleText = formatRoomRuleText(mode, players, pieces, itemsEnabled, stackedRollEnabled);
  const roomRuleBadges = getRoomRuleBadges(mode, players, pieces, itemsEnabled, stackedRollEnabled);
  const Component = as;

  return <Component className={`room-rule-badges ${className}`.trim()} aria-label={`방 옵션: ${roomRuleText}`}>
    {roomRuleBadges.map((badge) => <span key={badge.key} className={`room-rule-badge ${badge.tone}`}>{badge.label}</span>)}
  </Component>;
}
