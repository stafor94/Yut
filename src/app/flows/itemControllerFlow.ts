import type { ItemTiming } from '../../features/items/logic/items';

export type SkipItemPromptPayload =
  | { skipBeforeRollItem: true }
  | { skipAfterRollItem: true; rollStackIndex: number | null }
  | { skipAfterMoveItem: true };

export function buildSkipItemPromptPayload(timing: ItemTiming, rollStackIndex: number | null): SkipItemPromptPayload {
  if (timing === 'before_roll') return { skipBeforeRollItem: true };
  if (timing === 'after_roll') return { skipAfterRollItem: true, rollStackIndex };
  return { skipAfterMoveItem: true };
}

export function getSkippedItemPromptNextDeadlineKind(timing: ItemTiming): 'roll' | 'move' | 'after_move_turn_advance' {
  if (timing === 'before_roll') return 'roll';
  if (timing === 'after_roll') return 'move';
  return 'after_move_turn_advance';
}

export function isCurrentItemPromptRequestRoom(requestRoomId: string, currentRoomId: string): boolean {
  return Boolean(requestRoomId && requestRoomId === currentRoomId);
}
