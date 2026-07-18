import type { Team } from '../appTypes';

export const PLAYER_COLORS = ['#d94a38', '#3a78c2', '#2f9e6f', '#d6a11d'];
export const PLAYER_COLOR_LABELS = ['빨강', '파랑', '초록', '노랑'];
export const TEAM_COLORS: Record<Team, string> = { 청팀: '#3a78c2', 홍팀: '#d94a38' };
export const ROOM_COLOR_LABELS: Record<string, string> = {
  red: '빨강',
  blue: '파랑',
  green: '초록',
  yellow: '노랑',
};

export const AI_NAME_PREFIXES = [
  '씩씩한',
  '재빠른',
  '느긋한',
  '영리한',
  '용감한',
  '유쾌한',
  '차분한',
  '반짝이는',
  '든든한',
  '행운의',
];
export const AI_NAME_BASES = ['쥐', '소', '호랑이', '토끼', '용', '뱀', '말', '양', '원숭이', '닭', '개', '돼지'];
