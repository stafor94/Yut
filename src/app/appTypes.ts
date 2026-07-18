export type PlayMode = 'individual' | 'team';
export type Team = '청팀' | '홍팀';
export type PieceCount = 1 | 2 | 3 | 4;

export type Seat = {
  id: string;
  label: string;
  name: string;
  color: string;
  ready: boolean;
  isHost?: boolean;
  isAI?: boolean;
  isSubstitutedByAI?: boolean;
  isEmpty?: boolean;
  isSpectator?: boolean;
  enteredGameAt?: number;
  enteredStartVersion?: number;
  team: Team;
};
