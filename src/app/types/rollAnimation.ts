import type { RollTimingZone, YutResult, YutStick } from '../../game-core/roll';

export type RollAnimation =
  | { id: number; phase: 'primary' | 'extra-spin'; actionKey: string; sticks: YutStick[]; timingZone?: RollTimingZone }
  | { id: number; phase: 'landing' | 'result-hold'; result: YutResult; sticks: YutStick[]; actionKey?: string; fallCount?: number; timingZone?: RollTimingZone }
  | { id: number; phase?: 'resolved'; result: YutResult; sticks: YutStick[]; turnOrder?: boolean; fallCount?: number; timingZone?: RollTimingZone };
