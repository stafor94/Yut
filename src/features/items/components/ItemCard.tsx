import { ITEM_DEFINITIONS, ITEM_TIMING_LABELS, type ItemType } from '../logic/items';

export function ItemCard({ type }: { type: ItemType }) {
  const item = ITEM_DEFINITIONS[type];
  return <article className="item-card"><strong>{item.name}</strong><span>{item.description}</span><small>{ITEM_TIMING_LABELS[item.timing]}</small></article>;
}
