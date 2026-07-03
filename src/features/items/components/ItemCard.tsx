import { ITEM_DEFINITIONS, ITEM_TIMING_LABELS, type ItemType } from '../logic/items';

export function ItemCard({ type }: { type: ItemType }) {
  const item = ITEM_DEFINITIONS[type];
  return <article className="item-card"><div className="item-card-heading"><span className="item-card-icon" aria-hidden="true">{item.icon}</span><strong>{item.name}</strong></div><span className="item-card-description">{item.description}</span><small>{ITEM_TIMING_LABELS[item.timing]}</small></article>;
}
