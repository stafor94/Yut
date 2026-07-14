export type TurnOrderPresentationEntry = {
  seatId: string;
  label: string;
  name: string;
  color: string;
};

type TurnOrderEntry = TurnOrderPresentationEntry;

export const TURN_ORDER_PRESENTATION_PREPARE_MS = 3000;
const TURN_ORDER_INITIAL_SLOT_SPIN_MS = 3000;
const TURN_ORDER_SLOT_REVEAL_INTERVAL_MS = 550;
const TURN_ORDER_LAST_SLOT_REVEAL_INTERVAL_MS = 550;

export const getTurnOrderSlotRevealDurationMs = (orderLength: number) => {
  if (orderLength <= 0) return 0;
  if (orderLength === 1) return TURN_ORDER_INITIAL_SLOT_SPIN_MS;
  return TURN_ORDER_INITIAL_SLOT_SPIN_MS + Math.max(0, orderLength - 2) * TURN_ORDER_SLOT_REVEAL_INTERVAL_MS + TURN_ORDER_LAST_SLOT_REVEAL_INTERVAL_MS;
};

export const getTurnOrderStoppedSlotCount = (orderLength: number, elapsedMs: number) => {
  if (orderLength <= 0 || elapsedMs < TURN_ORDER_INITIAL_SLOT_SPIN_MS) return 0;
  if (orderLength === 1) return 1;
  const beforeLastCount = Math.min(orderLength - 1, 1 + Math.floor((elapsedMs - TURN_ORDER_INITIAL_SLOT_SPIN_MS) / TURN_ORDER_SLOT_REVEAL_INTERVAL_MS));
  const lastRevealAt = TURN_ORDER_INITIAL_SLOT_SPIN_MS + Math.max(0, orderLength - 2) * TURN_ORDER_SLOT_REVEAL_INTERVAL_MS + TURN_ORDER_LAST_SLOT_REVEAL_INTERVAL_MS;
  return elapsedMs >= lastRevealAt ? orderLength : beforeLastCount;
};

const hashText = (value: string) => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

const makeSeededRandom = (initialSeed: number) => {
  let seed = initialSeed || 0x6d2b79f5;
  return () => {
    seed += 0x6d2b79f5;
    let value = seed;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
};

const shuffleWithSeed = (entries: TurnOrderEntry[], seed: number) => {
  const shuffled = [...entries];
  const random = makeSeededRandom(seed);
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
};

export function buildTurnOrderSlotReel(order: TurnOrderEntry[], slotIndex: number, cycleCount = 4) {
  if (!order.length) return { rows: [] as TurnOrderEntry[], targetRow: 0 };

  const orderKey = order.map((entry) => `${entry.seatId}:${entry.name}`).join('|');
  const rows = Array.from({ length: Math.max(3, cycleCount) }, (_, cycleIndex) => (
    shuffleWithSeed(order, hashText(`${orderKey}:${slotIndex}:${cycleIndex}`))
  )).flat();
  const targetRow = Math.min(rows.length - 1, Math.max(order.length, rows.length - order.length + slotIndex));
  rows[targetRow] = order[slotIndex] ?? order[0];

  return { rows, targetRow };
}
